import makeWASocket, {
  DisconnectReason, fetchLatestBaileysVersion,
  normalizeMessageContent, Browsers
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcodeTerminal from 'qrcode-terminal';
import { readdirSync } from 'fs';
import { join } from 'path';
import { config } from './config.js';
import { digits, sleep, pick, toInt } from './utils.js';
import { saveMessage, recentMessages, getUser, updateUser } from './firestore.js';
import { askGemini } from './gemini.js';
import {
  MOODS, ACTION_TYPES, REFUSAL_NO_MANA, REFUSAL_NOT_ADMIN,
  buildSystemPrompt, buildNarratePrompt
} from './personality.js';
import { runAction } from './actions.js';
import { useFirestoreAuthState, clearAuth } from './authStore.js';

const logger = pino({ level: 'silent' });

export const status = { state: 'disconnected', qr: null, number: null, name: null };
let sock = null;
let stopping = false;
const lastMood = new Map(); // chatId -> dernière humeur

// ---------- stickers ----------
function stickerFor(mood) {
  const dir = join('stickers', MOODS.includes(mood) ? mood : 'blase');
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith('.webp'));
    return files.length ? join(dir, pick(files)) : null;
  } catch { return null; }
}

async function sendReply(jid, quoted, text, mood) {
  await sock.sendPresenceUpdate('composing', jid).catch(() => {});
  await sleep(Math.min(2500, 400 + text.length * 25));
  await sock.sendMessage(jid, { text }, quoted ? { quoted } : undefined);
  const file = stickerFor(mood);
  if (file) await sock.sendMessage(jid, { sticker: { url: file } }); // sticker envoyé juste après le texte
  await sock.sendPresenceUpdate('paused', jid).catch(() => {});
  lastMood.set(jid, mood);
}

// ---------- identités ----------
const botIds = () => new Set([digits(sock?.user?.id), digits(sock?.user?.lid)].filter(Boolean));

async function senderNumber(msg) {
  const k = msg.key;
  const cands = [k.participantPn, k.participantAlt, k.remoteJidAlt, k.participant, k.remoteJid];
  const pn = cands.find((j) => j && j.endsWith('@s.whatsapp.net'));
  if (pn) return digits(pn);
  const lid = cands.find((j) => j && j.endsWith('@lid'));
  try {
    const mapped = await sock.signalRepository?.lidMapping?.getPNForLID?.(lid);
    if (mapped) return digits(mapped);
  } catch { /* ignore */ }
  return digits(lid || '');
}

const matches = (p, n) => [p.id, p.phoneNumber, p.lid].some((v) => digits(v) === n);

// ---------- traitement d'un message ----------
async function handle(msg) {
  const jid = msg.key.remoteJid;
  if (!jid || jid === 'status@broadcast' || msg.key.fromMe || jid.endsWith('@newsletter')) return;
  const content = normalizeMessageContent(msg.message);
  if (!content) return;
  const text = content.conversation || content.extendedTextMessage?.text ||
    content.imageMessage?.caption || content.videoMessage?.caption || '';
  if (!text.trim()) return;

  const isGroup = jid.endsWith('@g.us');
  const sender = await senderNumber(msg);
  const name = msg.pushName || sender;
  const ci = (content.extendedTextMessage || content.imageMessage || content.videoMessage || {}).contextInfo;

  await saveMessage(jid, { from: sender, name, text, fromBot: false }).catch((e) => console.error('[fs]', e.message));

  const me = botIds();
  const mentioned = (ci?.mentionedJid || []).some((j) => me.has(digits(j)));
  const replied = ci?.participant && me.has(digits(ci.participant));
  const named = /\banby\b/i.test(text);
  if (isGroup && !(mentioned || replied || named)) return;

  // contexte du groupe
  let meta = null;
  let isAdmin = false;
  let botAdmin = false;
  if (isGroup) {
    meta = await sock.groupMetadata(jid).catch(() => null);
    const parts = meta?.participants || [];
    isAdmin = parts.some((p) => p.admin && matches(p, sender));
    botAdmin = parts.some((p) => p.admin && [...me].some((b) => matches(p, b)));
  }
  const isMother = sender === config.mother;
  const isOwner = config.owners.includes(sender);
  const role = isMother ? 'ta mère (Maman/Boss)' : isOwner ? 'second owner' : isAdmin ? 'admin du groupe' : 'membre';

  const user = await getUser(sender);
  const history = await recentMessages(jid, 14);
  const transcript = history.map((m) => `${m.fromBot ? 'Anby' : m.name}: ${m.text}`).join('\n');
  const quotedText = ci?.quotedMessage ? (ci.quotedMessage.conversation || ci.quotedMessage.extendedTextMessage?.text || '') : '';

  const system = buildSystemPrompt({
    name, sender, role, isGroup, groupName: meta?.subject,
    affinity: user.affinity ?? 50, notes: user.notes || [], lastMood: lastMood.get(jid)
  });
  const prompt = `Historique récent :\n${transcript}\n\n${quotedText ? `(${name} répond à : "${quotedText}")\n` : ''}Message à traiter de ${name} : ${text}`;

  let out;
  try {
    out = await askGemini(system, prompt);
  } catch (e) {
    console.error('[gemini]', e?.message);
    return sendReply(jid, msg, 'Eh bah... j\'ai la tête ailleurs là, reviens plus tard', 'fatiguee');
  }

  let reply = String(out.reply || '...').slice(0, 800);
  let mood = MOODS.includes(out.mood) ? out.mood : 'blase';

  // actions
  const actions = (Array.isArray(out.actions) ? out.actions : []).filter((a) => ACTION_TYPES.includes(a?.type)).slice(0, 25);
  const extra = [];
  if (actions.length) {
    const quotedKey = ci?.stanzaId ? { remoteJid: jid, id: ci.stanzaId, participant: ci.participant, fromMe: false } : null;
    const c = { sock, jid, isGroup, meta, sender, isOwner, isMother, isAdmin, botAdmin, quotedKey, extra };
    const results = [];
    for (const a of actions) results.push(await runAction(a, c));

    const refusals = results.filter((r) => r.code === 'forbidden' || r.code === 'bot_not_admin');
    if (refusals.length === results.length) {
      // refus 100 % déterministes
      const botNotAdmin = refusals.some((r) => r.code === 'bot_not_admin');
      reply = botNotAdmin ? REFUSAL_NOT_ADMIN : REFUSAL_NO_MANA;
      mood = botNotAdmin ? 'blase' : 'irritee';
    } else {
      try {
        const n = await askGemini(system, buildNarratePrompt(text, results));
        if (n.reply) reply = String(n.reply).slice(0, 800);
        if (MOODS.includes(n.mood)) mood = n.mood;
      } catch {
        reply = results.every((r) => r.ok) ? 'Eh bah... c\'est fait' : 'Ahan... ça a pas marché complètement';
      }
      if (refusals.length) reply += `\n${refusals.some((r) => r.code === 'bot_not_admin') ? REFUSAL_NOT_ADMIN : REFUSAL_NO_MANA}`;
    }
  }

  await sendReply(jid, msg, reply, mood);
  for (const f of extra) { await sleep(900); await sock.sendMessage(jid, { text: f }); }

  await saveMessage(jid, { from: 'anby', name: 'Anby', text: reply, mood, fromBot: true }).catch(() => {});

  // relation / mémoire
  const affinity = Math.max(0, Math.min(100, (user.affinity ?? 50) + Math.max(-3, Math.min(3, toInt(out.affinity_delta)))));
  const notes = [...(user.notes || [])];
  if (out.memory_note && typeof out.memory_note === 'string') notes.push(out.memory_note.slice(0, 160));
  await updateUser(sender, { name, affinity, notes: notes.slice(-8), msgCount: (user.msgCount || 0) + 1 }).catch(() => {});
}

// ---------- connexion ----------
export async function start() {
  stopping = false;
  const { state, saveCreds } = await useFirestoreAuthState();
  const { version } = await fetchLatestBaileysVersion();
  status.state = 'connecting';

  sock = makeWASocket({
    version, logger, auth: state,
    browser: Browsers.ubuntu('Anby'),
    markOnlineOnConnect: false,
    syncFullHistory: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      status.state = 'waiting_qr';
      status.qr = qr;
      qrcodeTerminal.generate(qr, { small: true });
    }
    if (connection === 'open') {
      status.state = 'connected';
      status.qr = null;
      status.number = digits(sock.user?.id);
      status.name = sock.user?.name || null;
      console.log('[wa] connecté :', status.number);
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      status.state = 'disconnected';
      status.qr = null;
      if (stopping) return;
      if (code === DisconnectReason.loggedOut) {
        console.log('[wa] session déconnectée, nouveau QR…');
        await clearAuth();
      }
      setTimeout(() => start().catch((e) => console.error('[wa]', e)), 3000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      try { await handle(m); } catch (e) { console.error('[handle]', e); }
    }
  });
}

export async function restart() {
  stopping = true;
  try { sock?.end(undefined); } catch { /* ignore */ }
  await sleep(1000);
  return start();
}

export async function logoutAndReset() {
  stopping = true;
  try { await sock?.logout(); } catch { /* ignore */ }
  try { sock?.end(undefined); } catch { /* ignore */ }
  await sleep(1000);
  await clearAuth();
  Object.assign(status, { state: 'disconnected', qr: null, number: null, name: null });
  await sleep(1000);
  return start();
}

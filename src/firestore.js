import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { config } from './config.js';

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON; // JSON brut OU encodé en base64
  if (raw) {
    const txt = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const sa = JSON.parse(txt);
    if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
    return sa;
  }
  return JSON.parse(readFileSync(config.firebaseSA, 'utf8')); // sinon fichier (Secret File sur Render)
}
const sa = loadServiceAccount();
admin.initializeApp({ credential: admin.credential.cert(sa) });

export const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

export async function saveMessage(chatId, data) {
  const ts = Date.now();
  await db.collection('chats').doc(chatId).set({ lastActivity: ts }, { merge: true });
  await db.collection('chats').doc(chatId).collection('messages').add({ ...data, ts });
}

export async function recentMessages(chatId, n = 14) {
  const snap = await db
    .collection('chats').doc(chatId).collection('messages')
    .orderBy('ts', 'desc').limit(n).get();
  return snap.docs.map((d) => d.data()).reverse();
}

export async function getUser(number) {
  const ref = db.collection('users').doc(number);
  const doc = await ref.get();
  if (doc.exists) return doc.data();
  const fresh = { number, name: '', affinity: 50, msgCount: 0, notes: [], firstSeen: Date.now() };
  await ref.set(fresh);
  return fresh;
}

export async function updateUser(number, patch) {
  await db.collection('users').doc(number).set({ ...patch, lastSeen: Date.now() }, { merge: true });
}

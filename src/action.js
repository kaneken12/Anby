import { config } from './config.js';
import { digits, toInt } from './utils.js';
import * as W from './wallet.js';

const R = (type, ok, detail, code) => ({ type, ok, detail, code });
const FORBIDDEN = (type) => R(type, false, 'refus: pas la permission', 'forbidden');
const NOT_ADMIN = (type) => R(type, false, 'le bot n\'est pas admin du groupe', 'bot_not_admin');
const toJid = (n) => `${digits(n)}@s.whatsapp.net`;

/** c = { sock, jid, isGroup, meta, sender, isOwner, isMother, isAdmin, botAdmin, quotedKey, extra[] } */
export async function runAction(a, c) {
  const type = a?.type;
  const p = a?.params || {};
  try {
    switch (type) {
      // ---------- FICHES ----------
      case 'wallet_create': {
        if (!c.isOwner) return FORBIDDEN(type);
        const id = digits(p.id);
        if (!p.nom || !p.pseudo || !p.classe || id.length < 8) return R(type, false, 'infos manquantes (nom, pseudo, classe, numéro)', 'invalid');
        const r = await W.createWallet({ nom: p.nom, pseudo: p.pseudo, classe: p.classe, id, gem: Math.max(0, toInt(p.gem)), ac: Math.max(0, toInt(p.ac)) });
        if (!r.ok) return R(type, false, `une fiche existe déjà pour ${id}`, r.code);
        return R(type, true, `fiche créée pour ${r.wallet.pseudo} (${id}) : ${r.wallet.gem} gem, ${r.wallet.ac} abyss coins`);
      }
      case 'wallet_adjust': {
        // Réservé aux owners. Un joueur ne peut PAS se créditer lui-même : il passe par wallet_transfer.
        if (!c.isOwner) return FORBIDDEN(type);
        const id = digits(p.id);
        const g = toInt(p.gem_delta);
        const ac = toInt(p.ac_delta);
        if (!id) return R(type, false, 'numéro du joueur manquant', 'invalid');
        if (!g && !ac) return R(type, false, 'aucun montant', 'invalid');
        const r = await W.adjustWallet(id, g, ac);
        if (!r.ok) return R(type, false, r.code === 'not_found' ? `aucune fiche pour ${id}` : `solde insuffisant (${r.wallet.gem} gem, ${r.wallet.ac} ac)`, r.code);
        return R(type, true, `${r.wallet.pseudo} : variation ${g} gem / ${ac} ac, nouveau solde ${r.wallet.gem} gem, ${r.wallet.ac} abyss coins`);
      }
      case 'wallet_delete': {
        if (!c.isOwner) return FORBIDDEN(type);
        const id = digits(p.id);
        const r = await W.deleteWallet(id);
        return r.ok ? R(type, true, `fiche ${id} supprimée`) : R(type, false, `aucune fiche pour ${id}`, r.code);
      }
      case 'wallet_show': {
        const id = digits(p.id) || c.sender;
        if (!c.isOwner && id !== c.sender) return FORBIDDEN(type);
        const w = await W.getWallet(id);
        if (!w) return R(type, false, `aucune fiche pour ${id}`, 'not_found');
        c.extra.push(W.formatWallet(w));
        return R(type, true, `fiche de ${w.pseudo} envoyée`);
      }
      case 'wallet_update_all': {
        if (!c.isOwner) return FORBIDDEN(type);
        const all = await W.allWallets();
        if (!all.length) return R(type, false, 'aucune fiche enregistrée', 'empty');
        all.forEach((w) => c.extra.push(W.formatWallet(w)));
        return R(type, true, `mise à jour générale : ${all.length} fiche(s) envoyée(s)`);
      }
      case 'wallet_transfer': {
        const to = digits(p.to);
        const gem = Math.max(0, toInt(p.gem));
        const ac = Math.max(0, toInt(p.ac));
        if (!to || (!gem && !ac)) return R(type, false, 'destinataire ou montant manquant', 'invalid');
        if (to === c.sender) return R(type, false, 'impossible de s\'envoyer de l\'argent à soi-même', 'invalid');
        const r = await W.transfer(c.sender, to, gem, ac);
        if (r.code === 'sender_not_found') return R(type, false, 'l\'expéditeur n\'a pas de fiche', r.code);
        if (r.code === 'dest_not_found') return R(type, false, `l'id ${to} n'existe pas`, r.code);
        if (r.code === 'insufficient') return R(type, false, `solde insuffisant : il veut déposer ${gem} gem et ${ac} ac mais n'a que ${r.wallet.gem} gem et ${r.wallet.ac} ac`, r.code);
        return R(type, true, `${gem} gem et ${ac} ac envoyés à ${r.to.pseudo}; nouveau solde de l'expéditeur : ${r.from.gem} gem, ${r.from.ac} ac`);
      }

      // ---------- GROUPES : réservé à la mère ----------
      case 'group_create': {
        if (!c.isMother) return FORBIDDEN(type);
        const nums = (p.numbers || []).map(digits).filter(Boolean);
        const meta = await c.sock.groupCreate(p.name || 'Nouveau groupe', nums.map(toJid));
        return R(type, true, `groupe "${meta.subject}" créé`);
      }
      case 'group_join': {
        if (!c.isMother) return FORBIDDEN(type);
        const m = String(p.link || '').match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/);
        if (!m) return R(type, false, 'lien invalide', 'invalid');
        await c.sock.groupAcceptInvite(m[1]);
        return R(type, true, 'groupe rejoint');
      }
      case 'group_leave': {
        if (!c.isMother) return FORBIDDEN(type);
        if (!c.isGroup) return R(type, false, 'pas dans un groupe', 'not_group');
        await c.sock.groupLeave(c.jid);
        return R(type, true, 'groupe quitté');
      }
    }

    // ---------- GROUPES : admin demandeur + bot admin ----------
    if (!type?.startsWith('group_')) return R(type, false, 'action inconnue', 'unknown');
    if (!c.isGroup) return R(type, false, 'cette commande ne marche que dans un groupe', 'not_group');
    if (!c.isOwner && !c.isAdmin) return FORBIDDEN(type);
    if (!c.botAdmin) return NOT_ADMIN(type);

    const sock = c.sock;
    const participants = c.meta?.participants || [];
    const findP = (n) => participants.find((x) => [x.id, x.phoneNumber, x.lid].some((v) => digits(v) === n));

    switch (type) {
      case 'group_add': {
        const nums = (p.numbers || []).map(digits).filter(Boolean);
        await sock.groupParticipantsUpdate(c.jid, nums.map(toJid), 'add');
        return R(type, true, `ajout demandé pour ${nums.length} numéro(s)`);
      }
      case 'group_remove': {
        const nums = (p.numbers || []).map(digits).filter((n) => n && !config.owners.includes(n));
        const ids = nums.map((n) => findP(n)?.id).filter(Boolean);
        if (!ids.length) return R(type, false, 'personne à retirer (introuvable ou intouchable)', 'not_found');
        await sock.groupParticipantsUpdate(c.jid, ids, 'remove');
        return R(type, true, `${ids.length} membre(s) retiré(s)`);
      }
      case 'group_close':
        await sock.groupSettingUpdate(c.jid, 'announcement');
        return R(type, true, 'groupe fermé (seuls les admins écrivent)');
      case 'group_open':
        await sock.groupSettingUpdate(c.jid, 'not_announcement');
        return R(type, true, 'groupe ouvert à tous');
      case 'group_tagall': {
        const ids = participants.map((x) => x.id);
        const text = `${p.text ? p.text + '\n\n' : ''}${ids.map((i) => `@${digits(i)}`).join(' ')}`;
        await sock.sendMessage(c.jid, { text, mentions: ids });
        return R(type, true, `${ids.length} membres taggés`);
      }
      case 'group_set': {
        const f = p.field;
        if (f === 'subject' && p.value) await sock.groupUpdateSubject(c.jid, String(p.value));
        else if (f === 'description') await sock.groupUpdateDescription(c.jid, String(p.value || ''));
        else if (f === 'locked') await sock.groupSettingUpdate(c.jid, 'locked');
        else if (f === 'unlocked') await sock.groupSettingUpdate(c.jid, 'unlocked');
        else return R(type, false, 'paramètre inconnu', 'invalid');
        return R(type, true, `paramètre "${f}" modifié`);
      }
      case 'group_delete_message': {
        if (!c.quotedKey) return R(type, false, 'aucun message ciblé (il faut répondre au message à supprimer)', 'invalid');
        await sock.sendMessage(c.jid, { delete: c.quotedKey });
        return R(type, true, 'message supprimé');
      }
    }
    return R(type, false, 'action inconnue', 'unknown');
  } catch (e) {
    console.error('[action]', type, e?.message);
    return R(type, false, `erreur technique: ${e?.message || e}`, 'error');
  }
}

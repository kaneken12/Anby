import { db } from './firestore.js';
import { today } from './utils.js';
import { config } from './config.js';

const col = () => db.collection('wallets');

export async function getWallet(id) {
  const d = await col().doc(id).get();
  return d.exists ? d.data() : null;
}

export async function createWallet({ nom, pseudo, classe, id, gem = 0, ac = 0 }) {
  const ref = col().doc(id);
  if ((await ref.get()).exists) return { ok: false, code: 'exists' };
  const w = { nom, pseudo, classe, id, gem, ac, updatedBy: config.updateBy, updatedAt: today() };
  await ref.set(w);
  return { ok: true, wallet: w };
}

/** Ajoute/retire. gemDelta et acDelta peuvent être négatifs. */
export async function adjustWallet(id, gemDelta = 0, acDelta = 0) {
  const ref = col().doc(id);
  return db.runTransaction(async (t) => {
    const d = await t.get(ref);
    if (!d.exists) return { ok: false, code: 'not_found' };
    const w = d.data();
    const gem = w.gem + gemDelta;
    const ac = w.ac + acDelta;
    if (gem < 0 || ac < 0) return { ok: false, code: 'insufficient', wallet: w };
    const nw = { ...w, gem, ac, updatedBy: config.updateBy, updatedAt: today() };
    t.set(ref, nw);
    return { ok: true, wallet: nw };
  });
}

export async function deleteWallet(id) {
  const ref = col().doc(id);
  if (!(await ref.get()).exists) return { ok: false, code: 'not_found' };
  await ref.delete();
  return { ok: true };
}

export async function transfer(fromId, toId, gem, ac) {
  const a = col().doc(fromId);
  const b = col().doc(toId);
  return db.runTransaction(async (t) => {
    const [da, dbb] = await Promise.all([t.get(a), t.get(b)]);
    if (!da.exists) return { ok: false, code: 'sender_not_found' };
    if (!dbb.exists) return { ok: false, code: 'dest_not_found' };
    const wa = da.data();
    const wb = dbb.data();
    if (wa.gem < gem || wa.ac < ac) return { ok: false, code: 'insufficient', wallet: wa };
    const stamp = { updatedBy: config.updateBy, updatedAt: today() };
    const na = { ...wa, gem: wa.gem - gem, ac: wa.ac - ac, ...stamp };
    const nb = { ...wb, gem: wb.gem + gem, ac: wb.ac + ac, ...stamp };
    t.set(a, na);
    t.set(b, nb);
    return { ok: true, from: na, to: nb };
  });
}

export async function allWallets() {
  const snap = await col().get();
  return snap.docs.map((d) => d.data());
}

export function formatWallet(w) {
  return `↤♖︎𝗟𝗢𝗪𝗘𝗥 𝗧𝗢𝗪𝗘𝗥♖︎↦
-- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
> 𝘞𝘢𝘭𝘭𝘦𝘵 𝘱𝘭𝘢𝘺𝘦𝘳𝘴💳
══════════════════
|• ℕ𝕠𝕞: *${w.nom}*
|• ℙ𝕤𝕖𝕦𝕕𝕠: *${w.pseudo}*
|• ℂ𝕝𝕒𝕤𝕤𝕖: *${w.classe}*
|•𝕚𝕕: +${w.id}
-- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
|• 𝔾𝕖𝕞: *${w.gem}💎*
|• 𝔸𝕓𝕪𝕤𝕤 𝕔𝕠𝕚𝕟𝕤: *${w.ac}🪙*
══════════════════ 
𝕌𝕡𝕕𝕒𝕥𝕖 𝕓𝕪: _*${w.updatedBy}*_

𝔻𝕒𝕥𝕖 𝕦𝕡𝕕𝕒𝕥𝕖: \`${w.updatedAt}\`
══════════════════
-                 𝙻𝙾𝚆𝙴𝚁 𝚃𝙾𝚆𝙴𝚁`;
}

export const digits = (jid = '') => String(jid).split('@')[0].split(':')[0].replace(/\D/g, '');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const today = () =>
  new Date().toLocaleDateString('fr-FR', { timeZone: 'Africa/Douala' });
export const toInt = (v, d = 0) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : d;
};
export function safeJson(text) {
  if (!text) return null;
  const clean = String(text).replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    const m = clean.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { /* ignore */ }
    }
    return null;
  }
}

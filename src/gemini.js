import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';
import { safeJson } from './utils.js';

const clients = config.geminiKeys.map((apiKey) => new GoogleGenAI({ apiKey }));
const cooldown = new Map(); // index de clé -> timestamp de fin de pause
let next = 0;

const isRotatable = (e) => {
  const st = Number(e?.status ?? e?.code);
  return [401, 403, 429, 500, 503].includes(st) ||
    /quota|RESOURCE_EXHAUSTED|overloaded|unavailable|API key/i.test(String(e?.message));
};

/** Appelle Gemini en faisant tourner les clés. Retourne l'objet JSON parsé. */
export async function askGemini(system, userText) {
  let lastErr;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < clients.length; i++) {
      const k = (next + i) % clients.length;
      if ((cooldown.get(k) || 0) > Date.now()) continue;
      try {
        const res = await clients[k].models.generateContent({
          model: config.geminiModel,
          contents: userText,
          config: {
            systemInstruction: system,
            responseMimeType: 'application/json',
            temperature: 1.0
          }
        });
        next = (k + 1) % clients.length; // répartit la charge sur les 6 clés
        const parsed = safeJson(res.text);
        if (parsed) return parsed;
        lastErr = new Error('Réponse Gemini non JSON');
      } catch (e) {
        lastErr = e;
        if (!isRotatable(e)) throw e;
        const quota = Number(e?.status ?? e?.code) === 429;
        cooldown.set(k, Date.now() + (quota ? 60_000 : 5 * 60_000));
        console.warn(`[gemini] clé #${k + 1} en pause (${e?.status ?? e?.message})`);
      }
    }
    cooldown.clear(); // toutes en pause : on retente une fois à zéro
  }
  throw lastErr || new Error('Toutes les clés Gemini ont échoué');
}

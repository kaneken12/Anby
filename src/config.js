import 'dotenv/config';
import { digits } from './utils.js';

const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

const mother = digits(process.env.MOTHER_NUMBER);
const second = digits(process.env.SECOND_OWNER_NUMBER);

export const config = {
  mother,
  owners: [mother, second].filter(Boolean),
  updateBy: process.env.UPDATE_BY || 'L. Lycoris',
  geminiKeys: list(process.env.GEMINI_API_KEYS),
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  firebaseSA: process.env.FIREBASE_SERVICE_ACCOUNT || './serviceAccount.json',
  port: Number(process.env.PORT || 3000),
  frontendOrigin: process.env.FRONTEND_ORIGIN || '',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  jwtSecret: process.env.JWT_SECRET || ''
};

if (!config.mother) throw new Error('MOTHER_NUMBER manquant dans .env');
if (!config.geminiKeys.length) throw new Error('GEMINI_API_KEYS manquant dans .env');
if (!config.adminPassword || !config.jwtSecret) throw new Error('ADMIN_PASSWORD et JWT_SECRET requis dans .env');

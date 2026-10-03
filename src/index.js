import { start } from './whatsapp.js';
import { startApi } from './api.js';

process.on('unhandledRejection', (e) => console.error('[unhandled]', e));
startApi();
start().catch((e) => { console.error(e); process.exit(1); });

import { initAuthCreds, BufferJSON, proto } from '@whiskeysockets/baileys';
import { db } from './firestore.js';

// Session WhatsApp stockée dans Firestore : aucun disque nécessaire, elle survit aux redéploiements.
const col = () => db.collection('wa_auth');
const safe = (id) => String(id).replace(/\//g, '__');

const read = async (id) => {
  const d = await col().doc(safe(id)).get();
  return d.exists ? JSON.parse(d.data().v, BufferJSON.reviver) : null;
};
const write = (id, data) => col().doc(safe(id)).set({ v: JSON.stringify(data, BufferJSON.replacer) });
const remove = (id) => col().doc(safe(id)).delete();

export async function useFirestoreAuthState() {
  const creds = (await read('creds')) || initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(ids.map(async (id) => {
            let v = await read(`${type}-${id}`);
            if (type === 'app-state-sync-key' && v) v = proto.Message.AppStateSyncKeyData.fromObject(v);
            data[id] = v;
          }));
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const type of Object.keys(data)) {
            for (const id of Object.keys(data[type])) {
              const v = data[type][id];
              tasks.push(v ? write(`${type}-${id}`, v) : remove(`${type}-${id}`));
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: () => write('creds', creds)
  };
}

export async function clearAuth() {
  const snap = await col().get();
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db.batch();
    snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

# Anby — bot WhatsApp (Baileys + Gemini + Firestore)

Baileys est utilisé (pas whatsapp-web.js) : connexion directe par WebSocket, sans Chromium, bien plus léger sur un VPS.

## 1. Préparer
1. Firebase : crée un projet, active Firestore, génère une clé de compte de service → `serviceAccount.json` à la racine (jamais sur GitHub).
2. `cp .env.example .env` et remplis (numéros, 6 clés Gemini séparées par des virgules, mot de passe admin, JWT_SECRET).
3. Stickers : mets 3 fichiers `.webp` (512x512) dans chaque dossier de `stickers/` :
   blase, indifferente, irritee, fatiguee, flemmarde, reflexive, contente, surprise.

## 2. Lancer sur le VPS (Ubuntu, Node 20+)
```bash
git clone <ton-depot> anby && cd anby
npm install
npm i -g pm2
pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
```
Le QR s'affiche aussi dans `pm2 logs anby`.

## 3. Site de connexion QR
Il est inclus (dossier `public/`) et servi par le bot : ouvre simplement l'adresse du bot, entre `ADMIN_PASSWORD`, scanne le QR. Rien d'autre à configurer. Sur un VPS, ajoute le `Caddyfile` pour avoir le HTTPS et un nom de domaine (et mets `HOST=127.0.0.1`).

## 4. Commandes de fiches (en langage naturel à Anby)
Création, ajout/retrait de gems/abyss coins, suppression, affichage, mise à jour générale, transferts par numéro, plusieurs fiches par message. Owners = tout. Joueur = voit sa propre fiche et peut déposer (transférer) de son solde vers un autre joueur ; il ne peut pas se créditer lui-même.

## Render (un seul service pour tout)
New > Web Service > ton dépôt. Build `npm install`, Start `npm start`. Variables : `MOTHER_NUMBER`, `GEMINI_API_KEYS`, `ADMIN_PASSWORD`, `JWT_SECRET`, `FIREBASE_SERVICE_ACCOUNT_JSON` (base64). La session WhatsApp est stockée dans Firestore : aucun disque à payer, le QR ne se rescanne pas après un redéploiement.

### Garder le plan gratuit éveillé
Crée un monitor HTTP(s) sur UptimeRobot vers `https://TON-SERVICE.onrender.com/health`, toutes les 5 minutes.

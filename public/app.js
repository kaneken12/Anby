(() => {
  const API = (window.ANBY_API_URL || '').replace(/\/$/, '');
  const $ = (id) => document.getElementById(id);
  let token = sessionStorage.getItem('anby_token');
  let fails = 0, lockUntil = 0, timer = null, busy = false;

  const STATES = {
    disconnected: ['Déconnectée', "Ahan... elle n'est pas connectée."],
    waiting_qr:   ['En attente du scan', "Scanne vite, j'ai pas toute la journée."],
    connecting:   ['Connexion…', 'Wait un peu...'],
    connected:    ['Connectée', "Eh bah... c'est connecté."]
  };

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(API + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 401 && token) { logout(); throw new Error('unauthorized'); }
    return res;
  }

  function show(view) {
    $('login').hidden = view !== 'login';
    $('dash').hidden = view !== 'dash';
  }

  function logout() {
    token = null; sessionStorage.removeItem('anby_token');
    clearInterval(timer); timer = null;
    show('login');
  }

  async function login() {
    const err = $('login-error');
    err.hidden = true;
    if (Date.now() < lockUntil) {
      err.textContent = `Trop d'essais. Réessaie dans ${Math.ceil((lockUntil - Date.now()) / 1000)} s.`;
      err.hidden = false; return;
    }
    try {
      const res = await api('/api/login', { method: 'POST', body: { password: $('password').value } });
      if (res.ok) {
        token = (await res.json()).token;
        sessionStorage.setItem('anby_token', token);
        $('password').value = ''; fails = 0;
        start(); return;
      }
      fails++;
      if (fails >= 5) { lockUntil = Date.now() + 60000; fails = 0; err.textContent = 'Trop d\'essais. Attends 60 secondes.'; }
      else err.textContent = 'Lep, mauvais mot de passe.';
    } catch {
      err.textContent = "Ahan... l'API répond pas. Vérifie l'adresse et réessaie.";
    }
    err.hidden = false;
  }

  function render(s) {
    const [label, text] = STATES[s.state] || STATES.disconnected;
    $('badge').dataset.state = s.state;
    $('badge-text').textContent = label;
    $('status-text').textContent = text;
    $('retry-btn').hidden = true;
    const acc = $('account');
    acc.hidden = !(s.state === 'connected' && (s.number || s.name));
    acc.textContent = [s.name, s.number && '+' + s.number].filter(Boolean).join(' · ');
    $('logout-btn').hidden = s.state !== 'connected';
    if (s.state !== 'waiting_qr') $('qr-card').hidden = true;
  }

  function renderError() {
    $('badge').dataset.state = 'disconnected';
    $('badge-text').textContent = 'API injoignable';
    $('status-text').textContent = "Ahan... l'API répond pas.";
    $('account').hidden = true;
    $('qr-card').hidden = true;
    $('retry-btn').hidden = false;
  }

  async function tick() {
    if (busy || !token || document.hidden) return;
    busy = true;
    try {
      const s = await (await api('/api/status')).json();
      render(s);
      if (s.state === 'waiting_qr') {
        const r = await api('/api/qr');
        if (r.ok) {
          const q = await r.json();
          if (typeof q.image === 'string' && q.image.startsWith('data:image/png;base64,')) {
            $('qr-img').src = q.image;
            $('qr-card').hidden = false;
          }
        }
      }
    } catch (e) {
      if (e.message !== 'unauthorized') renderError();
    } finally { busy = false; }
  }

  function start() {
    show('dash');
    tick();
    clearInterval(timer);
    timer = setInterval(tick, 3000);
  }

  async function post(path) {
    try { await api(path, { method: 'POST' }); } catch { /* le tick signalera l'erreur */ }
    setTimeout(tick, 1500);
  }

  $('login-btn').addEventListener('click', login);
  $('password').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  $('retry-btn').addEventListener('click', tick);
  $('restart-btn').addEventListener('click', () => post('/api/restart'));
  $('exit-btn').addEventListener('click', logout);
  $('logout-btn').addEventListener('click', () => $('confirm').showModal());
  $('confirm').addEventListener('close', () => { if ($('confirm').returnValue === 'ok') post('/api/logout'); });
  document.addEventListener('visibilitychange', tick);

  if (token) start();
  else show('login');
})();

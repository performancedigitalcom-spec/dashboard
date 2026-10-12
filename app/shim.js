/* Standalone runtime for the PD Client Performance page (outside Claude).
   - Provides the small `dash` API the page code uses.
   - Sign-in: personal logins (email + password, forgot/change password) through Firebase Authentication when
     app/auth-config.js sets window.PD_AUTH; otherwise the shared team password.
   - The data files are encrypted (AES-256-GCM). A signed-in user receives the data key from Firestore, which
     only allows the listed emails to read it; the team password unwraps the same key from data/meta.json. */
(function () {
  var NAMES = ['campaigns', 'meta_daily', 'google_daily', 'tiktok_daily', 'programmatic_daily', 'ga4_daily', 'monthly', 'ads_monthly', 'meta_pixels'];
  var calcs = {}, raw = {}, cache = {}, cbs = [], loaded = false, failed = false;
  var params = { client: 'All clients', period: 'last30', spend: true };
  try {
    var h = decodeURIComponent(location.hash.slice(1));
    if (h) Object.assign(params, JSON.parse(h));
  } catch (e) {}
  function fire() { cbs.forEach(function (cb) { try { cb(); } catch (e) { console.error(e); } }); }
  window.dash = {
    colors: ['#1B75BC', '#E8833A', '#111827', '#2E9E6B', '#8B5CF6', '#E5484D'],
    calc: function (id, o) { calcs[id] = o; },
    data: function (id) {
      if (failed) return { status: 'error' };
      if (!loaded) return { status: 'loading' };
      if (id in cache) return { status: 'ok', data: cache[id] };
      if (id in raw) return { status: 'ok', data: (cache[id] = raw[id]) };
      var c = calcs[id];
      if (!c) return { status: 'error' };
      var ins = [];
      for (var i = 0; i < c.inputs.length; i++) {
        var r = window.dash.data(c.inputs[i]);
        if (r.status !== 'ok') return r;
        ins.push(r.data);
      }
      try { cache[id] = c.fn.apply(null, ins); } catch (e) { console.error(id, e); return { status: 'error' }; }
      return { status: 'ok', data: cache[id] };
    },
    onData: function (cb) { cbs.push(cb); setTimeout(cb, 0); },
    params: function () { return params; },
    setParams: function (p) {
      Object.assign(params, p);
      try { history.replaceState(null, '', '#' + encodeURIComponent(JSON.stringify(params))); } catch (e) {}
      fire();
    },
  };

  // ---------- crypto ----------
  var b64 = function (s) { var bin = atob(s), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  async function pwKey(pw, meta) {
    var base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(meta.salt), iterations: meta.iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  }
  async function rawKey(bytes) { return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['decrypt']); }
  async function dec(key, u) { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, key, u.slice(12))); }
  async function openFile(key, buf) {
    var plain = await dec(key, new Uint8Array(buf));
    var stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }
  var META = null;
  async function meta() { return META || (META = await (await fetch('data/meta.json', { cache: 'no-cache' })).json()); }
  async function loadWith(dataKey) {
    var m = await meta();
    var check = await fetch('data/check.enc?v=' + m.version, { cache: 'no-cache' });
    await openFile(dataKey, await check.arrayBuffer()); // throws if the key is wrong
    hide('pd-gate');
    var loaderEl = document.getElementById('pd-loader');
    if (loaderEl) loaderEl.classList.remove('done');
    var files = await Promise.all(NAMES.map(function (n) { return fetch('data/' + n + '.enc?v=' + m.version, { cache: 'no-cache' }).then(function (r) { return r.arrayBuffer(); }); }));
    for (var i = 0; i < NAMES.length; i++) raw[NAMES[i]] = await openFile(dataKey, files[i]);
    loaded = true;
    window.PD_UPDATED = m.updated;
    fire();
  }
  async function keyFromTeamPassword(pw) {
    var m = await meta();
    return rawKey(await dec(await pwKey(pw, m), b64(m.wrapped)));
  }

  // ---------- Firebase Authentication (REST) ----------
  var A = window.PD_AUTH || null; // { apiKey, projectId }
  var session = null; // { idToken, refreshToken, email, expires }
  var IDT = 'https://identitytoolkit.googleapis.com/v1/accounts:';
  async function post(url, body) {
    var r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) { var e = new Error((j.error && j.error.message) || 'REQUEST_FAILED'); e.code = e.message; throw e; }
    return j;
  }
  function keep(j, remember) {
    session = { idToken: j.idToken || j.id_token, refreshToken: j.refreshToken || j.refresh_token, email: j.email || (session && session.email), expires: Date.now() + 50 * 60 * 1000 };
    if (remember) try { localStorage.setItem('pd-dash-session', JSON.stringify({ r: session.refreshToken, e: session.email })); } catch (e) {}
  }
  async function refresh(rt, email) {
    var r = await fetch('https://securetoken.googleapis.com/v1/token?key=' + A.apiKey, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(rt) });
    if (!r.ok) throw new Error('SESSION_EXPIRED');
    var j = await r.json();
    j.email = email;
    keep(j, true);
  }
  async function keyFromAccount() {
    var r = await fetch('https://firestore.googleapis.com/v1/projects/' + A.projectId + '/databases/(default)/documents/access/key', { headers: { Authorization: 'Bearer ' + session.idToken } });
    if (r.status === 403 || r.status === 401) { var e = new Error('NOT_ALLOWED'); e.code = 'NOT_ALLOWED'; throw e; }
    if (!r.ok) throw new Error('KEY_UNAVAILABLE');
    var j = await r.json();
    return rawKey(b64(j.fields.k.stringValue));
  }
  var MSG = {
    EMAIL_NOT_FOUND: 'That email and password don’t match.', INVALID_PASSWORD: 'That email and password don’t match.', INVALID_LOGIN_CREDENTIALS: 'That email and password don’t match.',
    USER_DISABLED: 'This login has been turned off. Ask Paulo for access.', NOT_ALLOWED: 'This email doesn’t have access to the dashboard yet. Ask Paulo.',
    TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many tries. Wait a few minutes or reset your password.', WEAK_PASSWORD: 'Use at least 8 characters.',
    CREDENTIAL_TOO_OLD_LOGIN_AGAIN: 'Please sign in again, then change your password.', INVALID_EMAIL: 'Enter a valid email address.',
  };
  var say = function (e) { var c = (e && (e.code || e.message) || '').split(' ')[0].replace(/ :.*/, ''); return MSG[c] || MSG[(c.split(':')[0] || '').trim()] || 'Something went wrong. Try again.'; };

  // ---------- UI ----------
  function $(id) { return document.getElementById(id); }
  function show(id) { var el = $(id); if (el) el.hidden = false; }
  function hide(id) { var el = $(id); if (el) el.hidden = true; }
  function view(name) {
    ['pd-v-login', 'pd-v-forgot', 'pd-v-change'].forEach(function (v) { $(v).hidden = v !== 'pd-v-' + name; });
    $('pd-gate-err').textContent = '';
    $('pd-gate-ok').textContent = '';
    show('pd-gate');
    var loaderEl = $('pd-loader');
    if (loaderEl && !loaded) loaderEl.classList.add('done');
    setTimeout(function () { var f = $('pd-v-' + name).querySelector('input:not([hidden])'); if (f) f.focus(); }, 50);
  }
  function busy(form, on) { var b = form.querySelector('button[type=submit]'); if (b) b.disabled = on; }
  function err(t) { $('pd-gate-err').textContent = t; }
  function ok(t) { $('pd-gate-ok').textContent = t; }

  document.addEventListener('DOMContentLoaded', function () {
    var accounts = !!(A && A.apiKey);
    document.body.classList.toggle('pd-accounts', accounts);
    // login
    $('pd-v-login').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      err('');
      busy(this, true);
      var remember = $('pd-gate-remember').checked;
      try {
        if (accounts) {
          var email = $('pd-gate-email').value.trim().toLowerCase();
          var j = await post(IDT + 'signInWithPassword?key=' + A.apiKey, { email: email, password: $('pd-gate-pw').value, returnSecureToken: true });
          keep(j, remember);
          await loadWith(await keyFromAccount());
          if (!remember) try { localStorage.removeItem('pd-dash-session'); } catch (e) {}
        } else {
          var pw = $('pd-gate-pw').value.trim();
          await loadWith(await keyFromTeamPassword(pw));
          if (remember) try { localStorage.setItem('pd-dash-key', pw); } catch (e) {}
        }
      } catch (e) {
        err(accounts ? say(e) : 'That password didn’t work. Try again.');
      }
      busy(this, false);
    });
    // forgot
    var tl = $('pd-link-team');
    if (tl) tl.addEventListener('click', function (e) { e.preventDefault(); accounts = false; document.body.classList.remove('pd-accounts'); view('login'); });
    meta().then(function (m) { if (!m.wrapped && tl) tl.remove(); }).catch(function () {});
    $('pd-link-forgot').addEventListener('click', function (e) { e.preventDefault(); $('pd-forgot-email').value = $('pd-gate-email').value; view('forgot'); });
    $('pd-link-back').addEventListener('click', function (e) { e.preventDefault(); view('login'); });
    $('pd-v-forgot').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      err('');
      busy(this, true);
      try {
        await post(IDT + 'sendOobCode?key=' + A.apiKey, { requestType: 'PASSWORD_RESET', email: $('pd-forgot-email').value.trim().toLowerCase() });
      } catch (e) {}
      ok('If that email has access, a reset link is on its way. Check your inbox (and spam).');
      busy(this, false);
    });
    // change password
    $('pd-v-change').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      err('');
      var n1 = $('pd-new-pw').value, n2 = $('pd-new-pw2').value;
      if (n1.length < 8) return err('Use at least 8 characters.');
      if (n1 !== n2) return err('The two new passwords don’t match.');
      busy(this, true);
      try {
        var j = await post(IDT + 'signInWithPassword?key=' + A.apiKey, { email: session.email, password: $('pd-cur-pw').value, returnSecureToken: true });
        keep(j, true);
        var u = await post(IDT + 'update?key=' + A.apiKey, { idToken: session.idToken, password: n1, returnSecureToken: true });
        u.email = session.email;
        keep(u, true);
        ok('Password changed.');
        setTimeout(function () { hide('pd-gate'); }, 900);
      } catch (e) {
        err(say(e) === 'That email and password don’t match.' ? 'Your current password isn’t right.' : say(e));
      }
      busy(this, false);
    });
    $('pd-link-cancel').addEventListener('click', function (e) { e.preventDefault(); hide('pd-gate'); });
    var cp = $('pd-change');
    if (cp) cp.addEventListener('click', function (e) { e.preventDefault(); $('pd-cur-pw').value = ''; $('pd-new-pw').value = ''; $('pd-new-pw2').value = ''; view('change'); });
    var so = $('pd-signout');
    if (so) so.addEventListener('click', function (e) {
      e.preventDefault();
      try { localStorage.removeItem('pd-dash-key'); localStorage.removeItem('pd-dash-session'); } catch (x) {}
      location.reload();
    });
    // automatic sign-in on a remembered device
    (async function () {
      try {
        if (accounts) {
          var s = JSON.parse(localStorage.getItem('pd-dash-session') || 'null');
          if (s && s.r) {
            hide('pd-gate');
            await refresh(s.r, s.e);
            await loadWith(await keyFromAccount());
            return;
          }
        } else {
          var saved = localStorage.getItem('pd-dash-key');
          if (saved) {
            hide('pd-gate');
            await loadWith(await keyFromTeamPassword(saved));
            return;
          }
        }
      } catch (e) {
        try { localStorage.removeItem('pd-dash-session'); localStorage.removeItem('pd-dash-key'); } catch (x) {}
      }
      view('login');
      var q = new URLSearchParams(location.search);
      if (q.get('mode') === 'resetDone') ok('Password updated. Sign in with your new password.');
    })();
  });
  window.PD_SESSION = function () { return session; };
})();

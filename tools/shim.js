/* Standalone runtime for the PD Client Performance page (outside Claude).
   Provides the small `dash` API the page code uses, unlocks the encrypted data with the team password,
   and remembers the password on this browser. */
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

  var b64 = function (s) { var bin = atob(s), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  async function keyFor(pw, meta) {
    var base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(meta.salt), iterations: meta.iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  }
  async function openFile(key, buf) {
    var u = new Uint8Array(buf);
    var plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, key, u.slice(12));
    var stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }
  async function unlock(pw) {
    var meta = await (await fetch('data/meta.json', { cache: 'no-cache' })).json();
    var key = await keyFor(pw, meta);
    var check = await fetch('data/check.enc?v=' + meta.version, { cache: 'no-cache' });
    await openFile(key, await check.arrayBuffer()); // throws on a wrong password
    var gate = document.getElementById('pd-gate');
    if (gate) gate.hidden = true;
    var loaderEl = document.getElementById('pd-loader');
    if (loaderEl) loaderEl.classList.remove('done');
    var files = await Promise.all(NAMES.map(function (n) { return fetch('data/' + n + '.enc?v=' + meta.version, { cache: 'no-cache' }).then(function (r) { return r.arrayBuffer(); }); }));
    for (var i = 0; i < NAMES.length; i++) raw[NAMES[i]] = await openFile(key, files[i]);
    loaded = true;
    window.PD_UPDATED = meta.updated;
    fire();
  }
  window.PD_UNLOCK = async function (pw, remember) {
    try {
      await unlock(pw);
      if (remember) try { localStorage.setItem('pd-dash-key', pw); } catch (e) {}
      return true;
    } catch (e) {
      try { localStorage.removeItem('pd-dash-key'); } catch (e2) {}
      return false;
    }
  };
  document.addEventListener('DOMContentLoaded', function () {
    var saved = null;
    try { saved = localStorage.getItem('pd-dash-key'); } catch (e) {}
    var gate = document.getElementById('pd-gate');
    var form = document.getElementById('pd-gate-form');
    var input = document.getElementById('pd-gate-pw');
    var err = document.getElementById('pd-gate-err');
    var loaderEl = document.getElementById('pd-loader');
    function showGate() { gate.hidden = false; if (loaderEl) loaderEl.classList.add('done'); setTimeout(function () { input.focus(); }, 50); }
    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      err.textContent = '';
      form.querySelector('button').disabled = true;
      var ok = await window.PD_UNLOCK(input.value.trim(), document.getElementById('pd-gate-remember').checked);
      form.querySelector('button').disabled = false;
      if (!ok) { err.textContent = 'That password didn’t work. Try again.'; showGate(); }
    });
    if (saved) {
      gate.hidden = true;
      window.PD_UNLOCK(saved, true).then(function (ok) { if (!ok) showGate(); });
    } else showGate();
  });
})();

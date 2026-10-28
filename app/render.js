(function () {
  const root = document.getElementById('report');
  const PLATS = ['Meta', 'Google Ads', 'TikTok', 'Programmatic'];
  const SECT = { Meta: 'meta', 'Google Ads': 'google', TikTok: 'tiktok', Programmatic: 'programmatic' };
  const nf = d3.format(',');
  const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
  const money = (v) => (v == null ? '—' : '$' + d3.format(',.2f')(v));
  const money0 = (v) => (v == null ? '—' : '$' + d3.format(',.0f')(v));
  const pct = (v) => (v == null ? '—' : d3.format('.2%')(v));
  const num = (v) => (v == null ? '—' : Math.abs(v) >= 10000 ? compact.format(v) : d3.format(',.0f')(v));
  const dec = (v) => (v == null ? '—' : Number.isInteger(v) ? nf(v) : d3.format(',.1f')(v));
  const dayFmt = d3.utcFormat('%b %-d, %Y');
  const shortDay = d3.utcFormat('%b %-d');
  const parse = (s) => new Date(s + 'T00:00:00Z');
  const enc = (v) => String(v).replace(/%/g, '%25').replace(/&/g, '%26').replace(/=/g, '%3D');
  const FMT = { pconv: dec, imp: num, clk: num, ctr: pct, conv: dec, spend: money0, lpv: num, vv: num, tp: num, plays: num, p100: num, cpc: money, cpa: money };
  const CELL = { res: dec, p25: (v) => nf(v), pconv: dec, vcr: (v) => (v == null ? '—' : d3.format('.1%')(v)), cpm: money, sessions: (v) => nf(v), engaged: (v) => nf(v), users: (v) => nf(v), new_users: (v) => nf(v), page_views: (v) => nf(v), key_events: (v) => nf(v), engagement_rate: (v) => (v == null ? '—' : d3.format('.1%')(v)), share: (v) => (v == null ? '—' : d3.format('.0%')(v)), d_sessions: (v) => chgText(v), imp: (v) => nf(v), clk: (v) => nf(v), ctr: pct, conv: dec, spend: money0, lpv: (v) => nf(v), vv: (v) => nf(v), tp: (v) => nf(v), plays: (v) => nf(v), p100: (v) => nf(v), cpc: money, cpa: money, share_imp: (v) => (v == null ? '—' : d3.format('.0%')(v)), campaigns: (v) => nf(v), d_imp: (v) => chgText(v) };

  function chgText(v) {
    if (v == null || !isFinite(v)) return '—';
    if (Math.abs(v) < 0.0005) return '0%';
    return (v > 0 ? '+' : '−') + d3.format('.1%')(Math.abs(v));
  }

  const PD = (window.PD = { metric: 'imp' });
  // every tactic gets its own color, used in the channel mix labels, bar and PDF
  PD.TACTICS = [
    { name: 'Meta', platform: 'Meta', channel: null, color: '#1B75BC' },
    { name: 'Google Search', platform: 'Google Ads', channel: 'Search', color: '#E37400' },
    { name: 'Google Display', platform: 'Google Ads', channel: 'Display', color: '#F2B200' },
    { name: 'YouTube', platform: 'Google Ads', channel: 'YouTube', color: '#D93025' },
    { name: 'Google App', platform: 'Google Ads', channel: 'App', color: '#8D6E63' },
    { name: 'TikTok', platform: 'TikTok', channel: null, color: '#111827' },
    { name: 'CTV', platform: 'Programmatic', channel: 'CTV', color: '#7B3FC4' },
    { name: 'Programmatic display', platform: 'Programmatic', channel: 'Display', color: '#2E8B57' },
    { name: 'Native', platform: 'Programmatic', channel: 'Native', color: '#0EA5A4' },
    { name: 'Streaming audio', platform: 'Programmatic', channel: 'Audio', color: '#D6336C' },
    { name: 'DOOH', platform: 'Programmatic', channel: 'DOOH', color: '#5B6BD8' },
  ];
  const state = () => {
    const p = dash.params();
    return { client: p.client || 'All clients', period: p.period || 'last30', spend: p.spend !== false, from: p.from || null, to: p.to || null };
  };
  PD.state = state;

  // ---------- custom date range ----------
  const CUSTOM_IDS = ['totals', 'camps', 'gtypes', 'audience', 'video', 'creatives', 'psizes', 'ga4', 'insights', 'ctvmix', 'ttdeep'];
  const DAY = 864e5;
  const iso = (d) => d.toISOString().slice(0, 10);
  let customMemo = { key: null, res: null };
  function customPeriod(from, to) {
    const s = parse(from), e = parse(to);
    const n = Math.round((e - s) / DAY) + 1;
    return { period: 'custom', label: 'Custom range', start: from, end: to, prev_start: iso(new Date(+s - n * DAY)), prev_end: iso(new Date(+s - DAY)) };
  }
  PD.customOk = () => !!(window.PD_SPECS && CUSTOM_IDS.every((id) => window.PD_SPECS[id]));
  function customData(id, st) {
    const key = st.from + '|' + st.to;
    if (customMemo.key !== key) customMemo = { key, res: {}, per: [customPeriod(st.from, st.to)] };
    const memo = customMemo;
    const get = (x) => {
      if (x === 'periods') return { status: 'ok', data: memo.per };
      if (!CUSTOM_IDS.includes(x)) return dash.data(x);
      if (memo.res[x]) return { status: 'ok', data: memo.res[x] };
      const spec = window.PD_SPECS[x];
      const ins = [];
      for (const i of spec.inputs) {
        const r = get(i);
        if (r.status !== 'ok') return r;
        ins.push(r.data);
      }
      try {
        memo.res[x] = spec.fn(...ins);
      } catch (e) {
        console.error(x, e);
        return { status: 'error' };
      }
      return { status: 'ok', data: memo.res[x] };
    };
    return get(id);
  }
  PD.data = (id) => {
    const st = state();
    if (st.period === 'custom' && st.from && st.to && PD.customOk() && (CUSTOM_IDS.includes(id) || id === 'periods_custom')) return customData(id, st);
    return dash.data(id);
  };

  // ---------- controls ----------
  const selClient = document.getElementById('pd-client');
  const selPeriod = document.getElementById('pd-period');
  const chkSpend = document.getElementById('pd-spend');
  selClient.addEventListener('change', () => dash.setParams({ client: selClient.value }));
  selPeriod.addEventListener('change', () => {
    if (selPeriod.value === '__pick') {
      const st = state();
      selPeriod.value = st.period === 'custom' && st.from ? 'custom' : st.period;
      openCalendar();
      return;
    }
    if (selPeriod.value === 'custom') return;
    dash.setParams({ period: selPeriod.value });
  });
  chkSpend.addEventListener('change', () => dash.setParams({ spend: chkSpend.checked }));
  document.getElementById('trend-metric').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-m]');
    if (!b) return;
    PD.metric = b.dataset.m;
    draw();
  });

  function fillSelect(sel, items, value) {
    const sig = items.map((i) => i.value + ':' + i.label).join('|');
    if (sel.dataset.sig !== sig) {
      sel.replaceChildren(...items.map((i) => new Option(i.label, i.value)));
      sel.dataset.sig = sig;
    }
    sel.value = value;
  }

  // ---------- marks ----------
  function mark(el, source, field, key) {
    el.setAttribute('data-source', source);
    el.setAttribute('data-field', field);
    el.setAttribute('data-where', 'k=' + enc(key));
  }
  function unmark(el) {
    el.removeAttribute('data-source');
    el.removeAttribute('data-field');
    el.removeAttribute('data-where');
  }
  function setChange(el, row, field) {
    el.className = 'chg';
    el.replaceChildren();
    if (!row) return unmark(el);
    const v = row[field];
    if (v == null || !isFinite(v)) {
      unmark(el);
      el.classList.add('flat');
      el.textContent = 'No delivery in the prior period';
      return;
    }
    mark(el, 'totals', field, row.k);
    el.classList.add(Math.abs(v) < 0.0005 ? 'flat' : v > 0 ? 'up' : 'down');
    const s = document.createElement('span');
    s.textContent = chgText(v);
    const c = document.createElement('span');
    c.className = 'ctx';
    c.textContent = ' vs prior period';
    el.append(s, c);
  }


  // ---------- calendar ----------
  const calEl = document.getElementById('pd-cal');
  let calView = null, calSel = { a: null, b: null };
  function openCalendar() {
    const st = state();
    const latest = PD.latest || iso(new Date());
    calSel = st.period === 'custom' && st.from ? { a: st.from, b: st.to } : { a: PD.period ? PD.period.start : null, b: PD.period ? PD.period.end : null };
    const base = parse(calSel.b || latest);
    calView = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - 1, 1));
    calEl.hidden = false;
    renderCal();
  }
  PD.openCalendar = openCalendar;
  function closeCal() { calEl.hidden = true; }
  function renderCal() {
    const latest = PD.latest || iso(new Date());
    const min = '2026-01-01';
    const grid = calEl.querySelector('.pd-cal-months');
    grid.replaceChildren();
    for (let k = 0; k < 2; k++) {
      const m0 = new Date(Date.UTC(calView.getUTCFullYear(), calView.getUTCMonth() + k, 1));
      const box = document.createElement('div');
      box.className = 'pd-cal-month';
      const h = document.createElement('div');
      h.className = 'pd-cal-title';
      h.textContent = d3.utcFormat('%B %Y')(m0);
      box.append(h);
      const g = document.createElement('div');
      g.className = 'pd-cal-grid';
      for (const w of ['S', 'M', 'T', 'W', 'T', 'F', 'S']) {
        const x = document.createElement('span');
        x.className = 'dow';
        x.textContent = w;
        g.append(x);
      }
      for (let i = 0; i < m0.getUTCDay(); i++) g.append(document.createElement('span'));
      const days = new Date(Date.UTC(m0.getUTCFullYear(), m0.getUTCMonth() + 1, 0)).getUTCDate();
      for (let d = 1; d <= days; d++) {
        const ds = iso(new Date(Date.UTC(m0.getUTCFullYear(), m0.getUTCMonth(), d)));
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = d;
        b.dataset.d = ds;
        const off = ds < min || ds > latest;
        b.disabled = off;
        const lo = calSel.a && calSel.b ? (calSel.a < calSel.b ? calSel.a : calSel.b) : calSel.a;
        const hi = calSel.a && calSel.b ? (calSel.a < calSel.b ? calSel.b : calSel.a) : calSel.a;
        if (lo && hi && ds >= lo && ds <= hi) b.classList.add('in');
        if (ds === lo) b.classList.add('start');
        if (ds === hi) b.classList.add('end');
        if (ds === latest) b.classList.add('today');
        g.append(b);
      }
      box.append(g);
      grid.append(box);
    }
    const sum = calEl.querySelector('.pd-cal-sum');
    if (calSel.a && calSel.b) {
      const lo = calSel.a < calSel.b ? calSel.a : calSel.b, hi = calSel.a < calSel.b ? calSel.b : calSel.a;
      const n = Math.round((parse(hi) - parse(lo)) / DAY) + 1;
      sum.textContent = `${dayFmt(parse(lo))} – ${dayFmt(parse(hi))} · ${n} day${n === 1 ? '' : 's'}`;
    } else sum.textContent = calSel.a ? 'Now pick the last day' : 'Pick the first day';
    calEl.querySelector('[data-cal=apply]').disabled = !(calSel.a && calSel.b);
    calEl.querySelector('[data-cal=prev]').disabled = iso(calView) <= min;
    const next = new Date(Date.UTC(calView.getUTCFullYear(), calView.getUTCMonth() + 2, 1));
    calEl.querySelector('[data-cal=next]').disabled = iso(next) > latest;
  }
  if (calEl) {
    calEl.addEventListener('click', (ev) => {
      const t = ev.target.closest('button');
      if (!t) {
        if (ev.target === calEl) closeCal();
        return;
      }
      if (t.dataset.d) {
        if (!calSel.a || calSel.b) calSel = { a: t.dataset.d, b: null };
        else calSel.b = t.dataset.d;
        renderCal();
      } else if (t.dataset.cal === 'prev' || t.dataset.cal === 'next') {
        calView = new Date(Date.UTC(calView.getUTCFullYear(), calView.getUTCMonth() + (t.dataset.cal === 'prev' ? -1 : 1), 1));
        renderCal();
      } else if (t.dataset.cal === 'apply') {
        const lo = calSel.a < calSel.b ? calSel.a : calSel.b, hi = calSel.a < calSel.b ? calSel.b : calSel.a;
        closeCal();
        dash.setParams({ period: 'custom', from: lo, to: hi });
      } else if (t.dataset.cal === 'cancel') closeCal();
      else if (t.dataset.preset) {
        const latest = PD.latest;
        const n = +t.dataset.preset;
        calSel = { a: iso(new Date(+parse(latest) - (n - 1) * DAY)), b: latest };
        renderCal();
      }
    });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !calEl.hidden) closeCal(); });
  }

  // ---------- main draw ----------
  function ready(ids) {
    const out = {};
    let status = 'ok';
    for (const id of ids) {
      const r = PD.data(id);
      out[id] = r.status === 'ok' ? r.data : null;
      if (r.status === 'error' || r.status === 'declined' || r.status === 'connect') status = 'error';
      else if (r.status !== 'ok' && status === 'ok') status = 'loading';
    }
    return { status, data: out };
  }

  const MSGS = ['Pulling the latest numbers', 'Asking Meta how it went', 'Checking in with Google Ads', 'Counting TikTok views', 'Tuning in to CTV and audio', 'Reading the website analytics', 'Writing the campaign story'];
  let msgTimer = null, msgI = 0;
  function loader(state) {
    const el = document.getElementById('pd-loader');
    if (!el) return;
    const msg = document.getElementById('pd-loader-msg');
    el.classList.toggle('done', state === 'ok');
    el.classList.toggle('fail', state === 'error');
    if (state === 'loading' && !msgTimer) {
      msgTimer = setInterval(() => {
        msgI = (msgI + 1) % MSGS.length;
        msg.textContent = MSGS[msgI];
      }, 1600);
    }
    if (state !== 'loading' && msgTimer) {
      clearInterval(msgTimer);
      msgTimer = null;
    }
    if (state === 'error') msg.textContent = 'Some data didn’t load. Try refreshing the page.';
  }
  PD.loader = loader;

  function draw() {
    const st = state();
    root.classList.toggle('nospend', !st.spend);
    chkSpend.checked = st.spend;
    dash.colors.forEach((c, i) => root.style.setProperty('--pd-c' + i, c));
    document.querySelectorAll('#trend-metric button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === PD.metric)));
    if (!st.spend && PD.metric === 'spend') PD.metric = 'imp';

    const camps = dash.data('campaigns');
    if (camps.status === 'ok') {
      const clients = [...new Set(camps.data.map((c) => c.client))].sort((a, b) => a.localeCompare(b));
      fillSelect(selClient, [{ value: 'All clients', label: 'All clients' }, ...clients.map((c) => ({ value: c, label: c }))], st.client);
    }
    const per = dash.data('periods');
    let period = null;
    if (per.status === 'ok') {
      const opts = per.data.map((p) => ({ value: p.period, label: p.label }));
      const custom = st.period === 'custom' && st.from && st.to && PD.customOk();
      if (custom) opts.push({ value: 'custom', label: `${shortDay(parse(st.from))} – ${shortDay(parse(st.to))}${st.from.slice(0, 4) !== st.to.slice(0, 4) ? ', ' + st.to.slice(0, 4) : ''}` });
      if (PD.customOk()) opts.push({ value: '__pick', label: 'Choose dates…' });
      fillSelect(selPeriod, opts, custom ? 'custom' : st.period);
      period = custom ? customPeriod(st.from, st.to) : per.data.find((p) => p.period === st.period) || per.data[1];
      PD.period = period;
      PD.latest = per.data[0].end;
    }
    document.getElementById('pd-title').textContent = st.client === 'All clients' ? 'All clients' : st.client;
    const sub = document.getElementById('pd-sub');
    if (period) {
      sub.textContent = `${period.label} · ${dayFmt(parse(period.start))} – ${dayFmt(parse(period.end))} · Data through ${dayFmt(parse(PD.latest))}`;
    }

    const R = ready(['totals', 'daily', 'camps', 'gtypes', 'periods']);
    PD.ready = R.status === 'ok';
    loader(R.status);
    const kpiEls = document.querySelectorAll('[data-kpi]');
    if (R.status !== 'ok' || !period) {
      const fail = R.status === 'error';
      kpiEls.forEach((el) => {
        el.classList.toggle('dash-skeleton', !fail);
        el.textContent = fail ? '' : '—';
      });
      const tk = document.getElementById('pd-takeaway');
      tk.classList.toggle('dash-skeleton', !fail);
      tk.textContent = fail ? 'Failed to load' : '—';
      return;
    }
    const { totals, daily, camps: cmp, gtypes } = R.data;
    const key = (plat) => `${period.period}|${st.client}|${plat}`;
    const tot = new Map(totals.map((r) => [r.k, r]));
    PD.tot = tot;
    const all = tot.get(key('All'));

    // headline tiles
    kpiEls.forEach((el) => {
      el.classList.remove('dash-skeleton');
      const f = el.dataset.kpi;
      if (all) {
        mark(el, 'totals', f, all.k);
        el.textContent = f === 'spend' ? money0(all[f]) : FMT[f](all[f]);
      } else {
        unmark(el);
        el.textContent = '—';
      }
    });
    document.querySelectorAll('[data-chg]').forEach((el) => setChange(el, all, el.dataset.chg));

    // takeaway
    const tk = document.getElementById('pd-takeaway');
    tk.classList.remove('dash-skeleton');
    tk.replaceChildren();
    const plats = PLATS.filter((p) => (tot.get(key(p)) || {}).imp > 0);
    const span = (row, f, text) => {
      const s = document.createElement('b');
      mark(s, 'totals', f, row.k);
      s.textContent = text;
      return s;
    };
    if (!all || !all.imp) {
      tk.textContent = `${st.client} had no paid delivery on Meta, Google Ads, TikTok or programmatic in this time frame.`;
    } else {
      const who = st.client === 'All clients' ? 'Across all clients, campaigns' : `${st.client}’s campaigns`;
      tk.append(`${who} delivered `, span(all, 'imp', nf(all.imp)), ' impressions and ', span(all, 'clk', nf(all.clk)), ` clicks on ${plats.join(', ').replace(/, ([^,]*)$/, ' and $1')}`);
      if (all.d_imp != null && isFinite(all.d_imp)) {
        tk.append(', impressions ', span(all, 'd_imp', chgText(all.d_imp)), ' on the period before');
      }
      tk.append('.');
    }

    // channel mix
    const mixRows = PLATS.map((p) => tot.get(key(p))).filter((r) => r && (r.imp || r.spend));
    const gmap = new Map(gtypes.filter((r) => r.period === period.period && r.client === st.client).map((r) => [r.platform + '|' + r.channel, r]));
    const tacRows = PD.TACTICS.map((t) => {
      const r = t.channel ? gmap.get(t.platform + '|' + t.channel) : tot.get(key(t.platform));
      return r && r.imp ? { ...t, imp: r.imp, clk: r.clk, spend: r.spend } : null;
    }).filter(Boolean);
    const tacImp = tacRows.reduce((a, r) => a + r.imp, 0) || 1;
    tacRows.forEach((r) => (r.share = r.imp / tacImp));
    PD.tacRows = tacRows;
    drawTactics(tacRows);
    fillTable(document.querySelector('#mix-table tbody'), mixRows, ['platform', 'imp', 'share_imp', 'clk', 'ctr', 'conv', 'spend', 'd_imp']);

    // trend
    drawTrend(daily, st, period);

    // platform sections
    for (const p of PLATS) {
      const sec = document.getElementById(SECT[p]);
      const row = tot.get(key(p));
      sec.hidden = !(row && (row.imp || row.spend));
      if (sec.hidden) continue;
      sec.querySelectorAll('[data-f]').forEach((el) => {
        const f = el.dataset.f;
        mark(el, 'totals', f, row.k);
        el.textContent = FMT[f](row[f]);
      });
      const t = sec.querySelector(`table[data-camps="${p}"]`);
      const cols = [...t.querySelectorAll('th')].map((th) => th.dataset.field);
      const rows = cmp.filter((r) => r.period === period.period && r.platform === p && (st.client === 'All clients' || r.client === st.client)).sort((a, b) => b.imp - a.imp);
      fillTable(t.querySelector('tbody'), rows, cols, st.client === 'All clients');
    }
    const gRows = gtypes.filter((r) => r.period === period.period && r.client === st.client && r.platform === 'Google Ads').sort((a, b) => b.imp - a.imp);
    fillTable(document.querySelector('#gtype-table tbody'), gRows, ['channel', 'campaigns', 'imp', 'clk', 'ctr', 'conv', 'spend']);
    const pRows = gtypes.filter((r) => r.period === period.period && r.client === st.client && r.platform === 'Programmatic').sort((a, b) => b.imp - a.imp);
    fillTable(document.querySelector('#ptype-table tbody'), pRows, ['channel', 'campaigns', 'imp', 'clk', 'ctr', 'vcr', 'pconv', 'cpm', 'spend']);
    document.getElementById('gtype-table').closest('.pd-card').hidden = gRows.length < 2;
    PD.views = { st, period, tot, daily, cmp, gtypes, all, plats, mixRows, gRows, pRows, tacRows };
    if (PD.extras) PD.extras(st, period);
  }

  function fillTable(tbody, rows, cols, showClient) {
    const table = tbody.closest('table');
    tbody.replaceChildren();
    const SP = ['spend', 'cpc', 'cpm'];
    const ths = [...table.querySelectorAll('th')];
    table.querySelectorAll('th').forEach((th, i) => th.classList.toggle('sp', SP.includes(cols[i])));
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = cols.length;
      td.className = 'pd-empty';
      td.textContent = 'No delivery in this time frame.';
      tr.append(td);
      tbody.append(tr);
      return;
    }
    for (const r of rows) {
      const tr = document.createElement('tr');
      tr.dataset.key = r.k;
      for (const c of cols) {
        const td = document.createElement('td');
        if (SP.includes(c)) td.className = 'sp';
        if ((c === 'channel' && cols[0] !== 'channel') || (ths[cols.indexOf(c)] && ths[cols.indexOf(c)].classList.contains('txt'))) td.classList.add('txt');
        if (c === 'name' && showClient && !cols.includes('campaign')) { td.textContent = `${r.name} · ${r.client}`; tr.append(td); continue; }
        let v = r[c];
        if (c === 'campaign' && showClient) td.textContent = `${v} · ${r.client}`;
        else if (c === 'conv' && r.platform === 'Programmatic' && !r.campaign) td.textContent = '—';
        else td.textContent = CELL[c] ? CELL[c](v) : v == null ? '—' : String(v);
        tr.append(td);
      }
      tbody.append(tr);
    }
    // optional columns (class "opt") are hidden when every row is zero
    ths.forEach((th, i) => {
      if (!th.classList.contains('opt') && !th.classList.contains('uniq')) return;
      const f = cols[i];
      const empty = th.classList.contains('uniq') ? new Set(rows.map((x) => x[f])).size < 2 : rows.every((x) => !x[f]);
      th.hidden = empty;
      tbody.querySelectorAll('tr').forEach((tr) => {
        if (tr.children[i]) tr.children[i].hidden = empty;
      });
    });
  }

  // ---------- channel mix tactic labels + share bar ----------
  function drawTactics(rows) {
    const chips = document.getElementById('mix-tacs');
    const bar = document.getElementById('mix-bar');
    if (!chips || !bar) return;
    const pf = d3.format('.0%');
    const sharePf = (v) => (v < 0.01 && v > 0 ? '<1%' : pf(v));
    chips.replaceChildren(
      ...rows.map((r) => {
        const c = document.createElement('span');
        c.className = 'pd-tac';
        c.style.setProperty('--c', r.color);
        const n = document.createElement('b');
        n.textContent = r.name;
        const v = document.createElement('em');
        v.textContent = sharePf(r.share);
        c.append(n, v);
        c.title = `${r.name}: ${nf(r.imp)} impressions (${sharePf(r.share)})`;
        return c;
      })
    );
    bar.replaceChildren(
      ...rows.map((r) => {
        const seg = document.createElement('i');
        seg.style.background = r.color;
        seg.style.flexGrow = '0';
        seg.title = `${r.name}: ${sharePf(r.share)} of impressions`;
        return seg;
      })
    );
    bar.hidden = !rows.length;
    requestAnimationFrame(() => requestAnimationFrame(() => [...bar.children].forEach((seg, i) => (seg.style.flexGrow = String(rows[i].share)))));
  }

  // ---------- trend chart ----------
  function drawTrend(daily, st, period) {
    const box = document.getElementById('trend-chart');
    const m = PD.metric;
    const rows = daily.filter((r) => r.client === st.client && r.d >= period.start && r.d <= period.end);
    const days = d3.utcDay.range(parse(period.start), d3.utcDay.offset(parse(period.end), 1)).map((d) => d.toISOString().slice(0, 10));
    const by = new Map(days.map((d) => [d, { d }]));
    for (const r of rows) {
      const o = by.get(r.d);
      if (o) o[r.platform] = (o[r.platform] || 0) + r[m];
    }
    const plats = PLATS.filter((p) => rows.some((r) => r.platform === p && r[m]));
    const data = days.map((d) => {
      const o = by.get(d);
      for (const p of PLATS) o[p] = o[p] || 0;
      return o;
    });
    const legend = document.getElementById('trend-legend');
    legend.replaceChildren(
      ...plats.map((p) => {
        const s = document.createElement('span');
        s.style.setProperty('--c', dash.colors[PLATS.indexOf(p)]);
        s.textContent = p;
        return s;
      })
    );
    const label = { imp: 'Impressions', clk: 'Clicks', spend: 'Investment' }[m];
    document.getElementById('trend-note').textContent = `${label} by platform, each day of the time frame.`;
    box.replaceChildren();
    if (!plats.length) {
      const p = document.createElement('div');
      p.className = 'pd-empty';
      p.textContent = 'No delivery in this time frame.';
      box.append(p);
      return;
    }
    const W = Math.max(280, box.clientWidth || 600);
    const H = 260;
    const stack = d3.stack().keys(plats)(data);
    const ymax = d3.max(stack, (s) => d3.max(s, (d) => d[1])) || 1;
    const y = d3.scaleLinear([0, ymax], [H - 24, 8]).nice();
    const yf = m === 'spend' ? (v) => '$' + compact.format(v) : (v) => compact.format(v);
    const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', `${label} per day`);
    const tmp = svg.append('text').attr('font-size', 11).text(yf(y.ticks(4).slice(-1)[0] || 0));
    const ml = Math.ceil(tmp.node().getComputedTextLength()) + 10;
    tmp.remove();
    const x = d3.scaleBand(days, [ml, W - 4]).paddingInner(days.length > 60 ? 0.1 : 0.25);
    svg.append('g').selectAll('line').data(y.ticks(4)).join('line').attr('x1', ml).attr('x2', W - 4).attr('y1', y).attr('y2', y).attr('stroke', 'var(--cds-chart-grid)');
    svg.append('g').selectAll('text').data(y.ticks(4)).join('text').attr('x', ml - 6).attr('y', (d) => y(d) + 4).attr('text-anchor', 'end').attr('font-size', 11).attr('fill', 'var(--color-fg-muted)').text(yf);
    const r = Math.min(4, x.bandwidth() / 2);
    svg.append('g').selectAll('g').data(stack).join('g').attr('fill', (s) => dash.colors[PLATS.indexOf(s.key)])
      .selectAll('rect').data((s) => s).join('rect')
      .attr('x', (d) => x(d.data.d)).attr('width', x.bandwidth())
      .attr('y', (d) => y(d[1])).attr('height', (d) => Math.max(0, y(d[0]) - y(d[1])))
      .attr('rx', (d, i, n) => 0);
    const nt = Math.max(2, Math.floor((W - ml) / 90));
    const step = Math.ceil(days.length / nt);
    const ticks = days.filter((d, i) => i % step === 0);
    svg.append('g').selectAll('text').data(ticks).join('text').attr('x', (d) => x(d) + x.bandwidth() / 2).attr('y', H - 6).attr('text-anchor', 'middle').attr('font-size', 11).attr('fill', 'var(--color-fg-muted)').text((d) => shortDay(parse(d)));
    svg.append('line').attr('x1', ml).attr('x2', W - 4).attr('y1', y(0)).attr('y2', y(0)).attr('stroke', 'var(--cds-chart-axis)');
    const tip = document.createElement('div');
    tip.className = 'pd-tip';
    tip.hidden = true;
    box.append(tip);
    const fmtV = m === 'spend' ? money : (v) => nf(v);
    svg.append('g').selectAll('rect').data(data).join('rect').attr('x', (d) => x(d.d) - (x.step() * x.paddingInner()) / 2).attr('width', x.step()).attr('y', 0).attr('height', H - 24).attr('fill', 'transparent')
      .on('mousemove', (ev, d) => {
        tip.hidden = false;
        tip.replaceChildren();
        const t = document.createElement('div');
        t.className = 't';
        t.textContent = dayFmt(parse(d.d));
        tip.append(t);
        for (const p of plats) {
          const line = document.createElement('div');
          const sw = document.createElement('i');
          sw.style.background = dash.colors[PLATS.indexOf(p)];
          line.append(sw, `${p}  ${fmtV(d[p])}`);
          tip.append(line);
        }
        const [px] = d3.pointer(ev, box);
        const bw = box.clientWidth;
        const tw = tip.offsetWidth;
        tip.style.left = Math.max(0, Math.min(bw - tw, px + 12)) + 'px';
        tip.style.top = '8px';
      })
      .on('mouseleave', () => (tip.hidden = true));
  }

  PD.fillTable = fillTable;
  dash.onData(draw);
  PD.redraw = draw;
})();

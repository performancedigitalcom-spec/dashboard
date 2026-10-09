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
  const state = () => {
    const p = dash.params();
    return { client: p.client || 'All clients', period: p.period || 'last30', spend: p.spend !== false };
  };
  PD.state = state;

  // ---------- controls ----------
  const selClient = document.getElementById('pd-client');
  const selPeriod = document.getElementById('pd-period');
  const chkSpend = document.getElementById('pd-spend');
  selClient.addEventListener('change', () => dash.setParams({ client: selClient.value }));
  selPeriod.addEventListener('change', () => dash.setParams({ period: selPeriod.value }));
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

  // ---------- main draw ----------
  function ready(ids) {
    const out = {};
    let status = 'ok';
    for (const id of ids) {
      const r = dash.data(id);
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
      fillSelect(selPeriod, per.data.map((p) => ({ value: p.period, label: p.label })), st.period);
      period = per.data.find((p) => p.period === st.period) || per.data[1];
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
    PD.views = { st, period, tot, daily, cmp, gtypes, all, plats, mixRows, gRows, pRows };
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

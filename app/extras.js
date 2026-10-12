(function () {
  const PD = window.PD;
  const nf = d3.format(',');
  const pct = (v) => (v == null || !isFinite(v) ? '—' : d3.format('.2%')(v));
  const p0 = (v) => (v == null || !isFinite(v) ? '—' : d3.format('.0%')(v));
  const money0 = (v) => (v == null ? '—' : '$' + d3.format(',.0f')(v));
  const money = (v) => (v == null ? '—' : '$' + d3.format(',.2f')(v));
  const enc = (v) => String(v).replace(/%/g, '%25').replace(/&/g, '%26').replace(/=/g, '%3D');
  const dayFmt = d3.utcFormat('%b %-d');
  const parse = (s) => new Date(s + 'T00:00:00Z');
  const STATUS = { 'on pace': ['on', 'On pace'], under: ['under', 'Under pace'], ahead: ['ahead', 'Ahead of pace'], stopped: ['stopped', 'No spend, last 3 days'], 'new this month': ['new', 'New this month'] };
  const AGE_ORDER = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+', '55+', 'Unknown'];
  PD.audPlat = PD.audPlat || null;
  PD.vidPlat = PD.vidPlat || 'All';

  const mark = (el, source, field, key) => {
    el.setAttribute('data-source', source);
    el.setAttribute('data-field', field);
    el.setAttribute('data-where', 'k=' + enc(key));
  };
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const bar = (share, color, marker) => {
    const b = el('div', 'pd-bar');
    const i = el('i');
    i.style.width = Math.max(0, Math.min(1, share || 0)) * 100 + '%';
    if (color) i.style.setProperty('--c', color);
    b.append(i);
    if (marker != null) {
      const m = el('b');
      m.style.left = `calc(${Math.min(1, marker) * 100}% - 1px)`;
      b.append(m);
    }
    return b;
  };
  function seg(box, items, value, onPick) {
    box.replaceChildren(
      ...items.map((it) => {
        const b = el('button', null, it);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(it === value));
        b.addEventListener('click', () => onPick(it));
        return b;
      })
    );
    box.hidden = items.length < 2;
  }
  const data = (id) => {
    const r = PD.data ? PD.data(id) : dash.data(id);
    return r.status === 'ok' ? r.data : null;
  };

  // animated donut with legend
  function donut(fig, title, slices, big, small) {
    if (!fig) return;
    fig.replaceChildren();
    const cap = el('figcaption', null, title);
    const S = 190, R = S / 2, r0 = R * 0.64;
    const svg = d3.create('svg').attr('viewBox', `0 0 ${S} ${S}`).attr('role', 'img').attr('aria-label', title);
    const g = svg.append('g').attr('transform', `translate(${R},${R})`);
    const tot = d3.sum(slices, (d) => d.v) || 1;
    const pie = d3.pie().value((d) => d.v).sort(null).padAngle(0.012);
    const arc = d3.arc().innerRadius(r0).outerRadius(R - 2).cornerRadius(3);
    const arcs = pie(slices);
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    g.selectAll('path').data(arcs).join('path').attr('fill', (d) => d.data.c)
      .each(function (d) { this._end = d; })
      .append('title').text((d) => `${d.data.label}: ${p0(d.data.v / tot)}`);
    const paths = g.selectAll('path');
    if (reduce) paths.attr('d', arc);
    else paths.attr('d', (d) => arc({ ...d, endAngle: d.startAngle })).transition().duration(900).delay((d, i) => i * 90).ease(d3.easeCubicOut)
      .attrTween('d', function (d) { const i = d3.interpolate(d.startAngle, d.endAngle); return (t) => arc({ ...d, endAngle: i(t) }); });
    g.append('text').attr('class', 'big').attr('text-anchor', 'middle').attr('y', 6).text(big);
    String(small).split('\n').forEach((t, i) => g.append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', 24 + i * 14).text(t));
    const ul = el('ul');
    slices.forEach((d, i) => {
      const li = el('li', d.dim ? 'dim' : null);
      const sw = el('i');
      sw.style.setProperty('--c', d.c);
      li.append(sw, el('span', null, d.label), el('b', null, d.v / tot < 0.01 ? '<1%' : p0(d.v / tot)));
      ul.append(li);
      setTimeout(() => li.classList.add('in'), reduce ? 0 : 150 + i * 70);
    });
    fig.append(cap, svg.node(), ul);
  }

  PD.extras = function (st, period) {
    const ins = data('insights');
    const pacing = data('pacing');
    const aud = data('audience');
    const vid = data('video');
    const out = (PD.extra = {});

    // ---------- story + highlights ----------
    const story = document.getElementById('pd-story');
    const good = document.getElementById('hl-good');
    const fix = document.getElementById('hl-fix');
    if (ins) {
      const field = st.spend ? 'text' : 'text_ns';
      const mine = ins.filter((r) => r.period === period.period && r.client === st.client);
      const s = mine.find((r) => r.type === 'story');
      story.classList.remove('dash-skeleton');
      if (s) {
        mark(story, 'insights', field, s.k);
        story.textContent = s[field];
      } else {
        story.removeAttribute('data-where');
        story.textContent = `${st.client} had no paid delivery on Meta, Google Ads or TikTok in this time frame.`;
      }
      const fill = (ul, type, emptyText) => {
        const items = mine.filter((r) => r.type === type && r[field]).sort((a, b) => a.n - b.n);
        ul.replaceChildren();
        for (const r of items) {
          const li = el('li', null, r[field]);
          mark(li, 'insights', field, r.k);
          ul.append(li);
        }
        if (!items.length) ul.append(el('li', 'none', emptyText));
        return items.map((r) => r[field]);
      };
      out.story = s ? s[field] : story.textContent;
      out.storyUp = s ? s[field + '_up'] || s[field] : story.textContent;
      out.good = fill(good, 'good', 'Nothing stands out above the market benchmarks or the prior period yet.');
      out.fix = fill(fix, 'improve', 'No clear weak spots against the market benchmarks or the prior period.');
    }

    // ---------- pacing ----------
    const paceSec = document.getElementById('pacing-sec');
    if (pacing) {
      const solo = st.client !== 'All clients';
      const rows = pacing
        .filter((r) => r.client === st.client && r.level === (solo ? 'campaign' : 'platform'))
        .sort((a, b) => b.mtd - a.mtd);
      paceSec.hidden = !rows.length;
      out.pacing = rows;
      if (rows.length) {
        const r0 = rows[0];
        const mName = d3.utcFormat('%B')(parse(r0.month_start));
        document.getElementById('pace-note').textContent =
          `${mName} 1 – ${dayFmt(parse(r0.through))}: ${p0(r0.elapsed_share)} of the month has passed. The bar shows the share of last month’s spending rate used so far; the line marks where an even pace would be. This section always shows the current month, whatever time frame is picked.`;
        out.paceNote = document.getElementById('pace-note').textContent;
        const tb = document.querySelector('#pace-table tbody');
        const ths = document.querySelectorAll('#pace-table th');
        ths[0].textContent = solo ? 'Campaign' : 'Platform';
        ths[1].hidden = !solo;
        tb.replaceChildren();
        for (const r of rows) {
          const tr = el('tr');
          tr.dataset.key = r.k;
          tr.append(el('td', null, r.name));
          const tp = el('td', 'txt', r.platform);
          tp.hidden = !solo;
          tr.append(tp);
          const tdb = el('td', 'txt');
          tdb.append(bar(r.spent_share == null ? 0 : r.spent_share, null, r.elapsed_share));
          tdb.title = r.spent_share == null ? 'No spend last month to compare with' : `${p0(r.spent_share)} of last month’s rate used, ${p0(r.elapsed_share)} of the month gone`;
          tr.append(tdb);
          tr.append(el('td', 'sp', money0(r.mtd)));
          tr.append(el('td', 'sp', money(r.daily_7d)));
          const v = r.projected_vs_last;
          tr.append(el('td', null, v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + d3.format('.0%')(Math.abs(v))));
          const tds = el('td', 'txt');
          const [cls, label] = STATUS[r.status] || ['new', r.status];
          tds.append(el('span', 'pd-chip ' + cls, label));
          tr.append(tds);
          tb.append(tr);
        }
      }
    }

    // ---------- audience ----------
    const audSec = document.getElementById('audience');
    const vidSec = document.getElementById('video');
    if (aud) {
      const mine = aud.filter((r) => r.period === period.period && r.client === st.client);
      const plats = ['Meta', 'TikTok', 'Programmatic'].filter((p) => mine.some((r) => r.platform === p && r.kind === 'age' && r.imp > 0));
      audSec.hidden = !plats.length;
      if (plats.length) {
        if (!plats.includes(PD.audPlat)) PD.audPlat = plats[0];
        const pl = PD.audPlat;
        seg(document.getElementById('aud-plat'), plats, pl, (p) => {
          PD.audPlat = p;
          PD.extras(PD.state(), PD.period);
        });
        const color = dash.colors[{ Meta: 0, TikTok: 2, Programmatic: 3 }[pl]];
        const ages = mine.filter((r) => r.platform === pl && r.kind === 'age').sort((a, b) => AGE_ORDER.indexOf(a.bucket) - AGE_ORDER.indexOf(b.bucket));
        const max = d3.max(ages, (r) => r.share) || 1;
        const box = document.getElementById('aud-age');
        box.replaceChildren();
        for (const r of ages) {
          const row = el('div', 'pd-row');
          row.append(el('span', null, r.bucket.replace('-', '–')));
          row.append(bar(r.share / max, color));
          const sh = el('span', 'r', p0(r.share));
          mark(sh, 'audience', 'share', r.k);
          const ct = el('span', 'm', pct(r.ctr) + ' CTR');
          mark(ct, 'audience', 'ctr', r.k);
          row.append(sh, ct);
          box.append(row);
        }
        const gens = mine.filter((r) => r.platform === pl && r.kind === 'gender' && r.imp > 0).sort((a, b) => ['Female', 'Male', 'Unknown'].indexOf(a.bucket) - ['Female', 'Male', 'Unknown'].indexOf(b.bucket));
        const gbox = document.getElementById('aud-gender');
        gbox.replaceChildren();
        const GC = { Female: '#c2185b', Male: dash.colors[0], Unknown: 'var(--color-border-line)' };
        const stack = el('div', 'pd-stack');
        for (const r of gens) {
          const i = el('i');
          i.style.width = r.share * 100 + '%';
          i.style.background = GC[r.bucket];
          i.title = `${r.bucket}: ${p0(r.share)}`;
          stack.append(i);
        }
        const leg = el('div', 'pd-legend');
        for (const r of gens) {
          const s = el('span', null, `${r.bucket === 'Unknown' ? 'Not reported' : r.bucket === 'Female' ? 'Women' : 'Men'} ${p0(r.share)} · ${pct(r.ctr)} CTR`);
          s.style.setProperty('--c', GC[r.bucket]);
          mark(s, 'audience', 'share', r.k);
          leg.append(s);
        }
        gbox.append(stack, leg);
        const months = ages[0] ? ages[0].months : '';
        document.getElementById('aud-note').textContent = `${pl} impressions and clicks by age and gender, from monthly reports (${months.replace(/(\d{4})-(\d{2})/g, (m, y, mo) => d3.utcFormat('%b %Y')(new Date(Date.UTC(+y, +mo - 1, 1))))}).`;
        out.aud = { pl, ages, gens, plats, all: mine, note: document.getElementById('aud-note').textContent };
      }
    }

    // ---------- video ----------
    if (vid) {
      const mine = vid.filter((r) => r.period === period.period && r.client === st.client && r.plays > 0);
      const plats = ['All', 'Meta', 'TikTok', 'Google Ads', 'Programmatic'].filter((p) => mine.some((r) => r.platform === p));
      const real = plats.filter((p) => p !== 'All');
      const tabs = real.length > 1 ? plats : real;
      vidSec.hidden = !real.length;
      document.getElementById('aud-sec').hidden = audSec.hidden && vidSec.hidden;
      if (real.length) {
        if (!tabs.includes(PD.vidPlat)) PD.vidPlat = tabs[0];
        const pl = PD.vidPlat;
        seg(document.getElementById('vid-plat'), tabs, pl, (p) => {
          PD.vidPlat = p;
          PD.extras(PD.state(), PD.period);
        });
        const r = mine.find((x) => x.platform === pl);
        const box = document.getElementById('vid-funnel');
        box.replaceChildren();
        const steps = [['Video plays', 'plays', 1], ['Watched 25%', 'p25', r.r25], ['Watched 50%', 'p50', r.r50], ['Watched 75%', 'p75', r.r75], ['Watched 100%', 'p100', r.r100]];
        const color = pl === 'All' ? null : dash.colors[{ Meta: 0, 'Google Ads': 1, TikTok: 2, Programmatic: 3 }[pl]];
        for (const [label, f, rate] of steps) {
          const row = el('div', 'pd-row');
          row.append(el('span', null, label));
          row.append(bar(rate, color));
          const n = el('span', 'r', nf(r[f]));
          mark(n, 'video', f, r.k);
          const rt = el('span', 'm', f === 'plays' ? '' : p0(rate));
          if (f !== 'plays') mark(rt, 'video', 'r' + f.slice(1), r.k);
          row.append(n, rt);
          box.append(row);
        }
        const g = pl === 'Google Ads' || (pl === 'All' && real.includes('Google Ads'));
        document.getElementById('vid-note').textContent =
          'Share of video plays that reached each point, from monthly reports.' + (g ? ' For YouTube, plays are ad impressions and the quartile counts are estimated from Google’s quartile rates.' : '') + (pl !== 'Google Ads' && pl !== 'Programmatic' ? ' Meta and TikTok count every video start as a play.' : '') + (pl === 'Programmatic' || pl === 'All' ? ' Programmatic video is mostly CTV, which viewers rarely skip.' : '');
        out.vid = { pl, rows: mine, note: document.getElementById('vid-note').textContent };
      }
    }
    // ---------- creatives ----------
    const crs = data('creatives');
    if (crs && PD.fillTable) {
      out.creatives = {};
      for (const pl of ['Meta', 'TikTok']) {
        const t = document.querySelector(`table[data-creatives="${pl}"]`);
        const cols = [...t.querySelectorAll('th')].map((th) => th.dataset.field);
        let rows = crs.filter((r) => r.period === period.period && r.platform === pl && (st.client === 'All clients' || r.client === st.client)).sort((a, b) => b.imp - a.imp);
        if (st.client === 'All clients') rows = rows.slice(0, 25);
        PD.fillTable(t.querySelector('tbody'), rows, cols, st.client === 'All clients');
        t.closest('.pd-card').hidden = !rows.length;
        out.creatives[pl] = rows;
      }
    }

    if (crs && PD.fillTable) {
      const all = st.client === 'All clients';
      const rows = crs.filter((r) => r.period === period.period && r.platform === 'Programmatic' && (all || r.client === st.client));
      out.creatives.Programmatic = rows;
      const box = document.getElementById('pcr-box');
      box.replaceChildren();
      const T = {
        CTV: [['name', 'Creative'], ['imp', 'Impressions'], ['p100', 'Completed views'], ['vcr', 'Completion'], ['pconv', 'Conv.', 'opt']],
        Display: [['name', 'Creative'], ['size', 'Size', 'txt'], ['imp', 'Impressions'], ['clk', 'Clicks'], ['ctr', 'CTR'], ['pconv', 'Conv.', 'opt']],
        Native: [['name', 'Creative'], ['size', 'Size', 'txt'], ['imp', 'Impressions'], ['clk', 'Clicks'], ['ctr', 'CTR'], ['pconv', 'Conv.', 'opt']],
        Audio: [['name', 'Creative'], ['imp', 'Impressions'], ['p100', 'Completed listens', 'opt'], ['vcr', 'Completion', 'opt'], ['pconv', 'Conv.', 'opt']],
        DOOH: [['name', 'Creative'], ['imp', 'Impressions'], ['pconv', 'Conv.', 'opt']],
      };
      const LBL = { CTV: 'CTV', Display: 'Display', Native: 'Native', Audio: 'Streaming audio', DOOH: 'Digital out-of-home' };
      out.tactics = [];
      for (const tac of ['CTV', 'Display', 'Native', 'Audio', 'DOOH']) {
        let tr = rows.filter((r) => r.channel === tac).sort((a, b) => b.imp - a.imp);
        if (!tr.length) continue;
        const imp = tr.reduce((a, r) => a + r.imp, 0);
        const n = tr.length;
        if (all) tr = tr.slice(0, 25);
        const wrap = el('div', 'pd-tactic');
        const h = el('h4', null, LBL[tac] + ' ');
        h.append(el('span', null, `${n} creative${n === 1 ? '' : 's'} · ${nf(imp)} impressions` + (all && n > 25 ? ' · top 25 shown' : '')));
        const tw = el('div', 'pd-table-wrap');
        const table = el('table', 'pd-table');
        table.setAttribute('data-source', 'creatives');
        table.setAttribute('data-row-key', 'k');
        const head = el('thead');
        const hr = el('tr');
        for (const [f, l, c] of T[tac]) {
          const th = el('th', c || null, l);
          th.dataset.field = f;
          hr.append(th);
        }
        head.append(hr);
        table.append(head, el('tbody'));
        tw.append(table);
        wrap.append(h, tw);
        box.append(wrap);
        PD.fillTable(table.querySelector('tbody'), tr, T[tac].map((x) => x[0]), all);
        out.tactics.push({ tac, label: LBL[tac], cols: T[tac], rows: tr, n, imp });
      }
      document.getElementById('pcr-card').hidden = !rows.length;
    }
    // ---------- CTV networks, household income, conversion definitions ----------
    const cm = data('ctvmix');
    if (cm) {
      const card = document.getElementById('ctv-card');
      const mine = cm.filter((r) => r.period === period.period && r.client === st.client);
      const nets = mine.filter((r) => r.kind === 'net');
      const hh = mine.filter((r) => r.kind === 'hhi');
      const defs = mine.filter((r) => r.kind === 'def');
      const single = st.client !== 'All clients';
      card.hidden = !nets.length && !hh.length;
      const sum = (list) => {
        const o = { imp: 0, clk: 0, conv: 0, p1: 0, p2: 0, p3: 0, share: 0 };
        for (const r of list) for (const f of Object.keys(o)) o[f] += r[f] || 0;
        o.ctr = o.imp ? o.clk / o.imp : null;
        o.cpm = o.imp ? (o.conv / o.imp) * 1000 : null;
        return o;
      };
      const named = nets.filter((r) => r.name && r.name !== '~other').sort((a, b) => b.imp - a.imp);
      const TOP = 12;
      const k1 = (r) => (r.imp ? (r.conv / r.imp) * 1000 : null);
      const netRows = named.slice(0, TOP).map((r) => ({ ...r, cpm: k1(r), label: r.name }));
      const rest = [...named.slice(TOP), ...nets.filter((r) => r.name === '~other')];
      if (rest.length) netRows.push({ ...sum(rest), label: 'All other networks', muted: true, count: named.length - Math.min(TOP, named.length) });
      const unrep = nets.filter((r) => !r.name);
      if (unrep.length) netRows.push({ ...sum(unrep), label: 'Network not reported', muted: true });
      const ctvImp = nets.reduce((a, r) => a + r.imp, 0);
      const known = ctvImp - unrep.reduce((a, r) => a + r.imp, 0);
      const HHI = ['Under $25,000', '$25,000-$50,000', '$50,001-$75,000', '$75,001-$100,000', '$100,001-$150,000', '$150,001-$200,000', '$200,001+', 'Unknown'];
      const hhRows = hh.slice().sort((a, b) => HHI.indexOf(a.name) - HHI.indexOf(b.name)).map((r) => ({ ...r, cpm: k1(r), label: r.name.replace(/-/g, ' – ').replace('Unknown', 'Income not known'), muted: r.name === 'Unknown' }));
      const hhKnownAll = hh.filter((r) => r.name !== 'Unknown').reduce((a, r) => a + r.imp, 0);
      const showPST = single && nets.some((r) => r.p1 || r.p2 || r.p3);
      const netCols = [['label', 'Network'], ['share', 'Share of CTV impressions'], ['imp', 'Impressions'], ['conv', 'Conv.'], ['cpm', 'Conv. per 1K impr.']];
      if (showPST) netCols.push(['p1', 'Primary'], ['p2', 'Secondary'], ['p3', 'Tertiary']);
      const hhCols = [['label', 'Household income'], ['share', 'Share of CTV impressions'], ['imp', 'Impressions'], ['conv', 'Conv.'], ['cpm', 'Conv. per 1K impr.']];
      const fmtC = { imp: (v) => nf(v), clk: (v) => nf(v), ctr: pct, conv: (v) => d3.format(',.0f')(v || 0), p1: (v) => d3.format(',.0f')(v || 0), p2: (v) => d3.format(',.0f')(v || 0), p3: (v) => d3.format(',.0f')(v || 0), cpm: (v) => (v == null ? '—' : d3.format(',.2f')(v)) };
      const draw = (table, cols, rows) => {
        const head = el('tr');
        cols.forEach(([f, l], i) => head.append(el('th', i === 0 ? null : f === 'share' ? 'txt' : null, l)));
        table.tHead.replaceChildren(head);
        const tb = table.tBodies[0];
        tb.replaceChildren();
        if (!rows.length) {
          const tr = el('tr');
          const td = el('td', 'pd-empty', 'No CTV delivery in this time frame.');
          td.colSpan = cols.length;
          tr.append(td);
          tb.append(tr);
          return;
        }
        for (const r of rows) {
          const tr = el('tr', r.muted ? 'muted' : null);
          for (const [f] of cols) {
            if (f === 'share') {
              const td = el('td', 'bar txt');
              td.append(bar(r.share, r.muted ? '#94A3B8' : null), el('em', null, p0(r.share)));
              tr.append(td);
            } else if (f === 'label') {
              tr.append(el('td', null, r.label + (r.count ? ` (${r.count})` : '')));
            } else tr.append(el('td', null, fmtC[f](r[f])));
          }
          tb.append(tr);
        }
        // hide all-zero conversion columns
        cols.forEach(([f], i) => {
          if (!['conv', 'clk', 'p1', 'p2', 'p3', 'cpm'].includes(f)) return;
          const empty = rows.every((r) => !r[f]);
          table.tHead.rows[0].children[i].hidden = empty;
          for (const tr of tb.rows) if (tr.children[i]) tr.children[i].hidden = empty;
        });
      };
      // animated donuts: network share and household income share
      const NET_C = ['#1B75BC', '#7B3FC4', '#0EA5A4', '#E37400', '#D6336C', '#5B6BD8'];
      const HHI_C = ['#D6E6F5', '#B0CEEB', '#86B3DE', '#5B97CF', '#357CBE', '#1C62A3', '#0E4880'];
      const netSlices = [
        ...named.slice(0, 6).map((r, i) => ({ label: r.name, v: r.imp, c: NET_C[i] })),
        { label: 'Other networks', v: named.slice(6).reduce((a, r) => a + r.imp, 0) + nets.filter((r) => r.name === '~other').reduce((a, r) => a + r.imp, 0), c: '#9AA9BA', dim: true },
        { label: 'Not reported', v: unrep.reduce((a, r) => a + r.imp, 0), c: '#DCE3EA', dim: true },
      ].filter((x) => x.v > 0);
      const hhSorted = hh.slice().sort((a, b) => HHI.indexOf(a.name) - HHI.indexOf(b.name));
      const hhSlices = hhSorted.map((r) => ({ label: r.name === 'Unknown' ? 'Income not known' : r.name.replace(/-/g, ' – '), v: r.imp, c: r.name === 'Unknown' ? '#DCE3EA' : HHI_C[HHI.indexOf(r.name)], dim: r.name === 'Unknown' }));
      const rich = hh.filter((r) => ['$100,001-$150,000', '$150,001-$200,000', '$200,001+'].includes(r.name)).reduce((a, r) => a + r.imp, 0);
      const compactN = (v) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
      donut(document.getElementById('ctv-donut-net'), 'Share of CTV impressions by network', netSlices, ctvImp ? compactN(ctvImp) : '0', 'CTV impressions');
      donut(document.getElementById('ctv-donut-hhi'), 'Share of CTV impressions by household income', hhSlices, hhKnownAll ? p0(rich / hhKnownAll) : '—', 'of matched homes\nearn $100K+');
      out.ctvDonuts = { net: netSlices, hhi: hhSlices, netCenter: [ctvImp ? compactN(ctvImp) : '0', 'CTV impressions'], hhiCenter: [hhKnownAll ? p0(rich / hhKnownAll) : '—', 'of matched homes\nearn $100K+'] };
      draw(document.getElementById('ctvnet-table'), netCols, netRows);
      draw(document.getElementById('hhi-table'), hhCols, hhRows);
      const netSub = ctvImp ? `${nf(named.length)} network${named.length === 1 ? '' : 's'} · ${p0(known / ctvImp)} of impressions named` : '';
      document.getElementById('ctvnet-sub').textContent = netSub;
      const hhKnown = hh.filter((r) => r.name !== 'Unknown').reduce((a, r) => a + r.imp, 0), hhAll = hh.reduce((a, r) => a + r.imp, 0);
      const top = hh.filter((r) => r.name !== 'Unknown').sort((a, b) => b.imp - a.imp)[0];
      const hhSub = hhAll ? `${p0(hhKnown / hhAll)} of impressions matched to an income` : '';
      document.getElementById('hhi-sub').textContent = hhSub;
      document.getElementById('ctv-note').textContent = 'Where the CTV ads ran and the household income of the homes that saw them, from Illumin by calendar month (a time frame counts every month it touches). Exchanges don’t always pass the network name, so part of the delivery is listed as “Network not reported”.';
      // conversion definitions
      const dbox = document.getElementById('ctv-defs');
      dbox.replaceChildren();
      const pretty = (n) => String(n || '').replace(/^Performance Digital_/, '').replace(/_/g, ' · ');
      const lab = (t) => String(t || '').split(/\n+/).map((x) => x.trim()).filter(Boolean).join(' · ');
      const jlabel = (names) => {
        if (names.length < 2) return pretty(names[0]);
        const parts = names.map((n) => pretty(n).split(' · '));
        const common = parts[0].filter((t) => parts.every((p) => p.includes(t)));
        const diff = parts.map((p) => p.filter((t) => !common.includes(t)).join(' · ')).filter(Boolean);
        return diff.length === names.length ? `${common[0] || 'Journeys'} · ${diff.join(' + ')}` : names.map(pretty).join(' + ');
      };
      const span = (d) => (d.start && d.end ? `${dayFmt(parse(d.start))} – ${dayFmt(parse(d.end))}` : d.start ? `Since ${dayFmt(parse(d.start))}` : '');
      const defOut = [];
      const dcard = document.getElementById('pdef-card');
      const hasDefs = single && defs.some((d) => d.status !== 'NONE');
      dcard.hidden = !hasDefs;
      if (hasDefs) {
        // journeys with identical definitions (same dates and labels) are shown once
        const sig = (d) => [d.start, d.end, d.status, d.l1, d.l2, d.l3, d.notes].join('¦');
        const merged = new Map();
        for (const d of defs.slice().sort((a, b) => (a.start + a.name).localeCompare(b.start + b.name))) {
          const m = merged.get(sig(d));
          if (m) { if (!m.names.includes(d.name)) m.names.push(d.name); }
          else merged.set(sig(d), { ...d, names: [d.name] });
        }
        const byJ = d3.group([...merged.values()].sort((a, b) => (a.names.join() + a.start).localeCompare(b.names.join() + b.start)), (d) => d.names.join('|'));
        const changed = [...byJ.values()].some((l) => l.length > 1);
        dbox.append(el('p', null, changed
          ? 'The definitions changed during this time frame, so the counts above combine the actions listed for each date range.'
          : 'Illumin conversions are Primary + Secondary + Tertiary. Each client and journey sets what those count, so they are listed here for this time frame.'));
        for (const [, list] of byJ) {
          for (const d of list) {
            const row = el('div', 'pd-def');
            const when = el('div', 'when');
            when.append(el('b', null, jlabel(d.names)), document.createTextNode(span(d)));
            const body = el('div');
            const o = { journey: jlabel(d.names), when: span(d), status: d.status, items: [], notes: d.notes };
            if (d.status === 'MAPPED') {
              const dl = el('dl');
              for (const [k, t] of [['Primary', d.l1], ['Secondary', d.l2], ['Tertiary', d.l3]]) {
                if (!t) continue;
                dl.append(el('dt', null, k), el('dd', null, lab(t)));
                o.items.push([k, lab(t)]);
              }
              body.append(dl);
              if (d.notes) body.append(el('div', 'when', d.notes));
            } else if (d.status === 'NONE') {
              body.append(el('div', 'when', 'No conversion definitions on file for this journey yet, so the counts are shown as Illumin reports them.'));
            } else {
              body.append(el('div', 'warn', d.notes || 'No confirmed conversion mapping for these dates.'));
            }
            row.append(when, body);
            dbox.append(row);
            defOut.push(o);
          }
        }
      }
      out.ctv = card.hidden && dcard.hidden ? null : { show: !card.hidden, nets: netRows, hhi: hhRows, netSub, hhSub, pst: showPST, defs: defOut, single, changed: single && defOut.length > new Set(defOut.map((d) => d.journey)).size };
    }
    const ps = data('psizes');
    if (ps && PD.fillTable) {
      const rows = ps.filter((r) => r.period === period.period && r.client === st.client).sort((a, b) => b.imp - a.imp);
      PD.fillTable(document.querySelector('#psize-table tbody'), rows, ['size', 'channel', 'creatives', 'imp', 'clk', 'ctr', 'pconv']);
      document.getElementById('psize-table').closest('.pd-card').hidden = !rows.length;
      out.psizes = rows;
    }
    // ---------- Meta pixel ----------
    const pxd = data('meta_pixels');
    const pcard = document.getElementById('pixel-card');
    if (pxd) {
      const head = document.querySelector('#pixel-table thead tr');
      const tb = document.querySelector('#pixel-table tbody');
      tb.replaceChildren();
      const th = (t, left) => {
        const e = el('th', left ? null : null, t);
        return e;
      };
      const label = (e) => (e === 'PageView' ? 'Page views' : e === '__missing_event' ? 'Unnamed events' : e.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2'));
      const r0 = pxd[0];
      const win = r0 ? `${dayFmt(parse(r0.since))} – ${dayFmt(parse(r0.until))}` : '';
      if (st.client === 'All clients') {
        const by = new Map();
        for (const r of pxd) {
          let o = by.get(r.pixel_id);
          if (!o) by.set(r.pixel_id, (o = { client: r.client, pixel: r.pixel, last: r.last_fired, pv: 0, other: 0, names: [] }));
          if (r.event === 'PageView') o.pv += r.count;
          else if (r.event !== '__missing_event') {
            o.other += r.count;
            o.names.push(label(r.event));
          }
        }
        head.replaceChildren(...['Client', 'Pixel', 'Last fired', 'Page views', 'Other events', 'Events tracked'].map((t) => th(t)));
        head.lastChild.className = 'txt';
        const rows = [...by.values()].sort((a, b) => b.pv - a.pv);
        for (const o of rows) {
          const tr = el('tr');
          [o.client, o.pixel, dayFmt(parse(o.last)), nf(o.pv), nf(o.other)].forEach((v) => tr.append(el('td', null, v)));
          tr.append(el('td', 'txt', o.names.slice(0, 3).join(', ') + (o.names.length > 3 ? ` +${o.names.length - 3}` : '') || '—'));
          tb.append(tr);
        }
        pcard.hidden = !rows.length;
        document.getElementById('pixel-note').textContent = `Every PD-managed pixel and what it recorded on the client’s website, ${win} (all visitors, not only people who saw an ad). Meta keeps about four weeks of this history.`;
        out.pixel = { all: true, rows, win };
      } else {
        const agg = new Map();
        for (const r of pxd.filter((x) => x.client === st.client)) {
          const o = agg.get(r.event);
          if (o) o.count += r.count;
          else agg.set(r.event, { ...r });
        }
        const mine = [...agg.values()].sort((a, b) => b.count - a.count);
        const allPx = pxd.filter((x) => x.client === st.client);
        pcard.hidden = !mine.length;
        if (mine.length) {
          head.replaceChildren(...['Event', 'Count'].map((t) => th(t)));
          for (const r of mine) {
            if (r.event === '__missing_event') continue;
            const tr = el('tr');
            tr.append(el('td', null, label(r.event)), el('td', null, nf(r.count)));
            tb.append(tr);
          }
          const pix = [...new Set(allPx.map((r) => r.pixel + ' (last fired ' + dayFmt(parse(r.last_fired)) + ')'))].join('; ');
          document.getElementById('pixel-note').textContent = `What the pixel recorded on the website, ${win}, from all visitors, not only people who saw an ad. Pixel: ${pix}.`;
          const nonPv = mine.filter((r) => r.event !== 'PageView' && r.event !== '__missing_event').reduce((a, r) => a + r.count, 0);
          document.getElementById('pixel-foot').textContent = nonPv
            ? `Meta has not credited any of these ${nf(nonPv)} website actions to the ads so far in 2026, so they are not counted as conversions above. Landing page views in the table below are pixel-measured and do come from ad clicks.`
            : 'The pixel only records page views on this site. Adding events for form fills, calls or bookings would let Meta count and optimize for real conversions.';
          out.pixel = { all: false, rows: mine.filter((r) => r.event !== '__missing_event'), win, pix, foot: document.getElementById('pixel-foot').textContent };
        }
      }
      if (st.client === 'All clients') document.getElementById('pixel-foot').textContent = 'Meta has not credited any pixel conversions to PD ads in 2026; ad-level website results here are landing page views.';
    } else pcard.hidden = true;

    // ---------- GA4 ----------
    const ga = data('ga4');
    const gsec = document.getElementById('ga4-sec');
    if (ga) {
      const mine = ga.filter((r) => r.period === period.period);
      const tiles = document.getElementById('ga4-tiles');
      const tb = document.querySelector('#ga4-table tbody');
      const ths = document.querySelectorAll('#ga4-table th');
      tb.replaceChildren();
      const cell = (tr, v, cls) => tr.append(el('td', cls, v));
      const fmtR = (v) => (v == null ? '—' : d3.format('.1%')(v));
      const chgT = (v) => (v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + d3.format('.0%')(Math.abs(v)));
      if (st.client === 'All clients') {
        const rows = mine.filter((r) => r.kind === 'total').sort((a, b) => b.sessions - a.sessions);
        gsec.hidden = !rows.length;
        tiles.hidden = true;
        document.getElementById('ga4-title').textContent = 'Clients with GA4 linked';
        document.getElementById('ga4-note').textContent = 'Website sessions for each client whose GA4 property is linked in the PD warehouse.';
        ['Client', 'Sessions', 'Vs prior', 'Engaged', 'Engagement rate', 'Key events'].forEach((t, i) => (ths[i].textContent = t));
        for (const r of rows) {
          const tr = el('tr');
          tr.dataset.key = r.k;
          cell(tr, r.client);
          cell(tr, nf(r.sessions));
          cell(tr, chgT(r.d_sessions));
          cell(tr, nf(r.engaged));
          cell(tr, fmtR(r.engagement_rate));
          cell(tr, nf(r.key_events));
          tb.append(tr);
        }
        out.ga4 = { all: true, rows };
      } else {
        const t = mine.find((r) => r.kind === 'total' && r.client === st.client);
        gsec.hidden = !t;
        tiles.hidden = false;
        if (t) {
          tiles.querySelectorAll('[data-g]').forEach((e) => {
            const f = e.dataset.g;
            mark(e, 'ga4', f, t.k);
            e.textContent = f === 'engagement_rate' ? fmtR(t[f]) : nf(t[f]);
          });
          tiles.querySelectorAll('[data-gchg]').forEach((e) => {
            const v = t[e.dataset.gchg];
            e.className = 'chg ' + (v == null || !isFinite(v) ? 'flat' : v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
            e.textContent = v == null || !isFinite(v) ? 'No data in the prior period' : chgT(v) + ' vs prior period';
          });
          document.getElementById('ga4-title').textContent = 'Sessions by channel';
          document.getElementById('ga4-note').textContent = 'Where website visits came from, as GA4 groups them. Paid Search and Paid Social include the ads in this report.';
          ['Channel', 'Sessions', 'Share', 'Engaged', 'Engagement rate', 'Key events'].forEach((x, i) => (ths[i].textContent = x));
          const rows = mine.filter((r) => r.kind === 'channel' && r.client === st.client).sort((a, b) => b.sessions - a.sessions);
          for (const r of rows) {
            const tr = el('tr');
            tr.dataset.key = r.k;
            cell(tr, r.channel);
            cell(tr, nf(r.sessions));
            cell(tr, d3.format('.0%')(r.share || 0));
            cell(tr, nf(r.engaged));
            cell(tr, fmtR(r.engagement_rate));
            cell(tr, nf(r.key_events));
            tb.append(tr);
          }
          out.ga4 = { all: false, total: t, rows };
        }
      }
    } else gsec.hidden = true;
  };
  dash.onData(() => {
    if (PD.views && PD.period) PD.extras(PD.state(), PD.period);
  });
})();

(function () {
  const btn = document.getElementById('pd-export');
  const PLATS = ['Meta', 'Google Ads', 'TikTok', 'Programmatic'];
  const W = 1275, H = 1650, M = 66; // US Letter at 150 dpi, ~0.44in margins
  const BLUE = '#1B75BC', INK = '#1d1d1f', MUTED = '#6b6b70', LINE = '#dcdce0', PANEL = '#f6f7f9';
  const FONT = "'PD Text', Helvetica, Arial, sans-serif";
  const DISPLAY = "'PD Display', 'PD Text', Helvetica, Arial, sans-serif";
  const nf = d3.format(',');
  const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
  const money = (v) => (v == null ? '—' : '$' + d3.format(',.2f')(v));
  const money0 = (v) => (v == null ? '—' : '$' + d3.format(',.0f')(v));
  const pct = (v) => (v == null ? '—' : d3.format('.2%')(v));
  const dec = (v) => (v == null ? '—' : Number.isInteger(v) ? nf(v) : d3.format(',.1f')(v));
  const int = (v) => (v == null ? '—' : nf(v));
  const chg = (v) => (v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + d3.format('.1%')(Math.abs(v)));
  const dayFmt = d3.utcFormat('%b %-d, %Y');
  const parse = (s) => new Date(s + 'T00:00:00Z');

  function resolveColor(c) {
    const s = document.createElement('span');
    s.style.color = c;
    document.getElementById('report').append(s);
    const out = getComputedStyle(s).color;
    s.remove();
    return out || BLUE;
  }

  function Doc() {
    const pages = [];
    let ctx, y;
    const self = {
      get y() { return y; },
      set y(v) { y = v; },
      get ctx() { return ctx; },
      page() {
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = BLUE;
        ctx.fillRect(0, 0, W, 10);
        const logo = document.getElementById('pd-logo');
        if (logo && logo.complete && logo.naturalWidth) {
          const lh = pages.length ? 56 : 84;
          const lw = (logo.naturalWidth / logo.naturalHeight) * lh;
          ctx.drawImage(logo, W - M - lw, 28, lw, lh);
        }
        pages.push(c);
        y = pages.length > 1 ? M + 40 : M;
        return self;
      },
      ensure(h) {
        if (y + h > H - M - 40) self.page();
      },
      text(t, x, yy, { size = 22, color = INK, weight = '', align = 'left', font = FONT, maxW } = {}) {
        ctx.font = `${weight} ${size}px ${font}`.trim();
        ctx.fillStyle = color;
        ctx.textAlign = align;
        ctx.textBaseline = 'alphabetic';
        let s = String(t);
        if (maxW && ctx.measureText(s).width > maxW) {
          while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
          s += '…';
        }
        ctx.fillText(s, x, yy);
        return ctx.measureText(s).width;
      },
      wrap(t, x, width, { size = 22, color = INK, lh = 1.4, weight = '' } = {}) {
        ctx.font = `${weight} ${size}px ${FONT}`.trim();
        const words = String(t).split(/\s+/);
        let line = '';
        const lines = [];
        for (const w of words) {
          const test = line ? line + ' ' + w : w;
          if (ctx.measureText(test).width > width && line) {
            lines.push(line);
            line = w;
          } else line = test;
        }
        if (line) lines.push(line);
        for (const l of lines) {
          self.ensure(size * lh);
          y += size * lh;
          self.text(l, x, y, { size, color, weight });
        }
      },
      pages,
    };
    return self;
  }

  function header(doc, v) {
    const { ctx } = doc;
    doc.text('CLIENT PERFORMANCE', M, doc.y + 22, { size: 17, color: BLUE, weight: '700', font: DISPLAY });
    doc.text(v.st.client, M, doc.y + 72, { size: 46, color: INK, weight: '800', font: DISPLAY, maxW: W - 2 * M - 300 });
    doc.text(`${v.period.label} · ${dayFmt(parse(v.period.start))} – ${dayFmt(parse(v.period.end))}`, M, doc.y + 106, { size: 22, color: MUTED });
    doc.y += 126;
    ctx.fillStyle = BLUE;
    ctx.fillRect(M, doc.y, W - 2 * M, 3);
    doc.y += 18;
  }

  function tiles(doc, items) {
    const gap = 16;
    const w = (W - 2 * M - gap * (items.length - 1)) / items.length;
    const h = 120;
    doc.ensure(h + 10);
    const { ctx } = doc;
    items.forEach((it, i) => {
      const x = M + i * (w + gap);
      ctx.fillStyle = PANEL;
      ctx.fillRect(x, doc.y, w, h);
      ctx.fillStyle = BLUE;
      ctx.fillRect(x, doc.y, w, 4);
      doc.text(it.label.toUpperCase(), x + 18, doc.y + 34, { size: 14, color: MUTED, weight: '700', maxW: w - 24 });
      doc.text(it.value, x + 16, doc.y + 78, { size: 34, color: INK, weight: '800', font: DISPLAY, maxW: w - 24 });
      if (it.change != null) {
        const col = it.change === '—' ? MUTED : it.change.startsWith('+') ? '#1a7f37' : it.change.startsWith('−') ? '#c62828' : MUTED;
        const tw = doc.text(it.change, x + 16, doc.y + 104, { size: 17, color: col });
        doc.text(' vs prior', x + 16 + tw, doc.y + 104, { size: 17, color: MUTED });
      }
    });
    doc.y += h + 24;
  }

  function heading(doc, t, color) {
    doc.ensure(90);
    doc.y += 14;
    const { ctx } = doc;
    ctx.fillStyle = color || BLUE;
    ctx.beginPath();
    ctx.arc(M + 8, doc.y + 18, 8, 0, Math.PI * 2);
    ctx.fill();
    doc.text(t, M + 26, doc.y + 26, { size: 28, weight: '800', font: DISPLAY });
    doc.y += 44;
  }

  function table(doc, cols, rows) {
    // cols: [{label, w (fraction), align, get}]
    const width = W - 2 * M;
    const rh = 34;
    const { ctx } = doc;
    const drawHead = () => {
      doc.ensure(rh * 2);
      doc.ctx.fillStyle = PANEL;
      doc.ctx.fillRect(M, doc.y, width, rh);
      let x = M;
      for (const c of cols) {
        const cw = c.w * width;
        const tx = c.align === 'left' ? x + 8 : x + cw - 8;
        doc.text(c.label.toUpperCase(), tx, doc.y + 23, { size: 13.5, color: MUTED, weight: '700', align: c.align === 'left' ? 'left' : 'right', maxW: cw - 12 });
        x += cw;
      }
      doc.y += rh;
    };
    drawHead();
    if (!rows.length) {
      doc.text('No delivery in this time frame.', M + 8, doc.y + 24, { size: 17, color: MUTED });
      doc.y += rh;
      return;
    }
    for (const r of rows) {
      if (doc.y + rh > H - M - 40) {
        doc.page();
        drawHead();
      }
      let x = M;
      for (const c of cols) {
        const cw = c.w * width;
        const tx = c.align === 'left' ? x + 8 : x + cw - 8;
        if (c.draw) c.draw(doc.ctx, x, doc.y, cw, rh, r);
        else doc.text(c.get(r), tx, doc.y + 23, { size: 17, color: c.color ? c.color(r) : INK, align: c.align === 'left' ? 'left' : 'right', maxW: cw - 14 });
        x += cw;
      }
      doc.ctx.fillStyle = LINE;
      doc.ctx.fillRect(M, doc.y + rh - 1, width, 1);
      doc.y += rh;
    }
    doc.y += 12;
  }

  function chart(doc, v, colors) {
    const h = 300;
    doc.ensure(h + 70);
    const { ctx } = doc;
    doc.text('Daily impressions by platform', M, doc.y + 24, { size: 22, weight: '700', font: DISPLAY });
    doc.y += 40;
    const rows = v.daily.filter((r) => r.client === v.st.client && r.d >= v.period.start && r.d <= v.period.end);
    const days = d3.utcDay.range(parse(v.period.start), d3.utcDay.offset(parse(v.period.end), 1)).map((d) => d.toISOString().slice(0, 10));
    const by = new Map(days.map((d) => [d, Object.fromEntries(PLATS.map((p) => [p, 0]))]));
    for (const r of rows) if (by.has(r.d)) by.get(r.d)[r.platform] += r.imp;
    const totals = days.map((d) => PLATS.reduce((s, p) => s + by.get(d)[p], 0));
    const max = d3.max(totals) || 1;
    const y = d3.scaleLinear([0, max], [h - 30, 6]).nice();
    const left = M + 70, right = W - M;
    const bw = (right - left) / days.length;
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    for (const t of y.ticks(4)) {
      const yy = doc.y + y(t);
      ctx.beginPath();
      ctx.moveTo(left, yy);
      ctx.lineTo(right, yy);
      ctx.stroke();
      doc.text(compact.format(t), left - 10, yy + 6, { size: 16, color: MUTED, align: 'right' });
    }
    days.forEach((d, i) => {
      let base = 0;
      PLATS.forEach((p, pi) => {
        const val = by.get(d)[p];
        if (!val) return;
        const y0 = doc.y + y(base), y1 = doc.y + y(base + val);
        ctx.fillStyle = colors[pi];
        ctx.fillRect(left + i * bw + bw * 0.12, y1, Math.max(1, bw * 0.76), y0 - y1);
        base += val;
      });
    });
    const step = Math.ceil(days.length / 7);
    days.forEach((d, i) => {
      if (i % step) return;
      doc.text(d3.utcFormat('%b %-d')(parse(d)), left + i * bw + bw / 2, doc.y + h - 6, { size: 16, color: MUTED, align: 'center' });
    });
    doc.y += h + 30;
    let lx = left;
    PLATS.forEach((p, pi) => {
      if (!rows.some((r) => r.platform === p && r.imp)) return;
      ctx.fillStyle = colors[pi];
      ctx.fillRect(lx, doc.y - 12, 14, 14);
      lx += 22 + doc.text(p, lx + 22, doc.y, { size: 17, color: MUTED }) + 26;
    });
    doc.y += 24;
  }


  function lines(doc, t, width, size) {
    doc.ctx.font = `${size}px ${FONT}`;
    const out = [];
    let line = '';
    for (const w of String(t).split(/\s+/)) {
      const test = line ? line + ' ' + w : w;
      if (doc.ctx.measureText(test).width > width && line) {
        out.push(line);
        line = w;
      } else line = test;
    }
    if (line) out.push(line);
    return out;
  }

  function storyBlock(doc, ex) {
    if (!ex || !ex.story) return;
    heading(doc, 'Campaign story');
    doc.wrap(ex.story, M, W - 2 * M, { size: 21, lh: 1.5 });
    doc.y += 26;
    const gap = 30, cw = (W - 2 * M - gap) / 2, size = 19, lh = size * 1.45;
    const cols = [
      { title: 'Highlights', color: '#1a7f37', items: ex.good.length ? ex.good : ['Nothing stands out above the PD average or the prior period yet.'] },
      { title: 'Things to improve', color: '#c62828', items: ex.fix.length ? ex.fix : ['No clear weak spots against the PD average or the prior period.'] },
    ].map((c) => ({ ...c, wrapped: c.items.map((t) => lines(doc, t, cw - 60, size)) }));
    const hOf = (c) => 64 + c.wrapped.reduce((a, l) => a + l.length * lh + 12, 0);
    const h = Math.max(...cols.map(hOf));
    doc.ensure(h);
    const { ctx } = doc;
    cols.forEach((c, i) => {
      const x = M + i * (cw + gap);
      ctx.fillStyle = PANEL;
      ctx.fillRect(x, doc.y, cw, h);
      ctx.fillStyle = c.color;
      ctx.fillRect(x, doc.y, cw, 5);
      doc.text(c.title, x + 22, doc.y + 42, { size: 22, weight: '700', font: DISPLAY });
      let yy = doc.y + 64;
      for (const l of c.wrapped) {
        ctx.fillStyle = c.color;
        ctx.beginPath();
        ctx.arc(x + 30, yy + lh / 2 + 2, 6, 0, Math.PI * 2);
        ctx.fill();
        for (const t of l) {
          yy += lh;
          doc.text(t, x + 48, yy - 5, { size, color: INK });
        }
        yy += 12;
      }
    });
    doc.y += h + 24;
  }

  function hbar(ctx, x, y, w, h, share, color, marker) {
    ctx.fillStyle = '#e8e9ec';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, Math.max(0, Math.min(1, share || 0)) * w, h);
    if (marker != null) {
      ctx.fillStyle = INK;
      ctx.fillRect(x + Math.min(1, marker) * w - 1, y - 5, 3, h + 10);
    }
  }

  function pacingBlock(doc, v, ex) {
    const rows = ex && ex.pacing;
    if (!rows || !rows.length) return;
    doc.ensure(260);
    heading(doc, 'Pacing this month');
    doc.wrap(ex.paceNote, M, W - 2 * M, { size: 17, color: MUTED, lh: 1.45 });
    doc.y += 14;
    const solo = v.st.client !== 'All clients';
    const sp = v.st.spend;
    const ST = { 'on pace': ['On pace', '#1a7f37'], under: ['Under pace', '#c62828'], ahead: ['Ahead of pace', BLUE], stopped: ['No spend, 3 days', '#c62828'], 'new this month': ['New this month', MUTED] };
    const cols = [{ label: solo ? 'Campaign' : 'Platform', w: solo ? (sp ? 0.25 : 0.37) : sp ? 0.33 : 0.45, align: 'left', get: (r) => r.name }];
    if (solo) cols.push({ label: 'Platform', w: 0.12, align: 'left', get: (r) => r.platform });
    cols.push({ label: 'Spent vs month elapsed', w: 0.2, align: 'left', draw: (ctx, x, y, cw, rh, r) => hbar(doc.ctx, x + 8, y + 12, cw - 24, 11, r.spent_share, BLUE, r.elapsed_share) });
    if (sp) cols.push({ label: 'Spent so far', w: 0.11, get: (r) => money0(r.mtd) }, { label: 'Daily avg 7d', w: 0.1, get: (r) => money(r.daily_7d) });
    cols.push({ label: 'Projected', w: 0.11, get: (r) => chg(r.projected_vs_last).replace(/\.\d%/, '%') });
    cols.push({ label: 'Status', w: 0.11, get: (r) => (ST[r.status] || [r.status])[0], color: (r) => (ST[r.status] || [0, INK])[1] });
    table(doc, cols, rows);
  }

  function audVidBlock(doc, ex, colors) {
    const aud = ex && ex.aud, vid = ex && ex.vid;
    if (!aud && !vid) return;
    const order = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+', '55+', 'Unknown'];
    const PC = { Meta: colors[0], 'Google Ads': colors[1], TikTok: colors[2], Programmatic: colors[3], All: BLUE };
    const { ctx } = doc;
    if (aud) {
      doc.ensure(420);
      heading(doc, 'Who saw the ads');
      doc.text('Share of impressions by age, then click-through rate. ' + aud.note.replace(/^\w+ impressions and clicks by age and gender, /, 'From '), M, doc.y + 4, { size: 17, color: MUTED, maxW: W - 2 * M });
      doc.y += 26;
      const gap = 40, n = aud.plats.length, cw = (W - 2 * M - gap * (n - 1)) / n;
      const top = doc.y;
      let maxY = top;
      aud.plats.forEach((pl, i) => {
        const x = M + i * (cw + gap);
        let y = top;
        doc.text(pl, x, y + 22, { size: 20, weight: '700', font: DISPLAY });
        y += 36;
        const ages = aud.all.filter((r) => r.platform === pl && r.kind === 'age').sort((a, b) => order.indexOf(a.bucket) - order.indexOf(b.bucket));
        const mx = Math.max(...ages.map((r) => r.share), 0.01);
        for (const r of ages) {
          doc.text(r.bucket.replace('-', '–'), x, y + 18, { size: 17, color: INK });
          hbar(doc.ctx, x + 80, y + 5, cw - 250, 16, r.share / mx, PC[pl]);
          doc.text(d3.format('.0%')(r.share), x + cw - 112, y + 18, { size: 17, align: 'right' });
          doc.text(pct(r.ctr), x + cw, y + 18, { size: 16, color: MUTED, align: 'right' });
          y += 30;
        }
        const gens = aud.all.filter((r) => r.platform === pl && r.kind === 'gender' && r.imp > 0);
        const g = (b) => gens.find((r) => r.bucket === b);
        const parts = [['Women', g('Female')], ['Men', g('Male')], ['Not reported', g('Unknown')]].filter((p) => p[1]);
        y += 8;
        for (const [lab, r] of parts) {
          doc.text(`${lab} ${d3.format('.0%')(r.share)} · ${pct(r.ctr)} CTR`, x, y + 18, { size: 16, color: MUTED, maxW: cw });
          y += 24;
        }
        y += 6;
        maxY = Math.max(maxY, y);
      });
      doc.y = maxY + 16;
    }
    if (vid) {
      const plats = vid.rows.map((r) => r.platform).filter((p) => p !== 'All');
      doc.ensure(300);
      heading(doc, 'Video completion');
      doc.wrap(vid.note, M, W - 2 * M, { size: 17, color: MUTED, lh: 1.45 });
      doc.y += 14;
      const gap = 40, per = Math.min(2, plats.length), cw = (W - 2 * M - gap * (per - 1)) / per, bh = 36 + 5 * 30 + 16;
      plats.forEach((pl, i) => {
        if (i % per === 0) {
          if (i) doc.y += bh;
          doc.ensure(bh);
        }
        const top = doc.y;
        const r = vid.rows.find((x) => x.platform === pl);
        const x = M + (i % per) * (cw + gap);
        let y = top;
        doc.text(pl, x, y + 22, { size: 20, weight: '700', font: DISPLAY });
        y += 36;
        for (const [lab, f, rate] of [['Plays', 'plays', 1], ['25%', 'p25', r.r25], ['50%', 'p50', r.r50], ['75%', 'p75', r.r75], ['100%', 'p100', r.r100]]) {
          doc.text(lab, x, y + 18, { size: 17 });
          hbar(doc.ctx, x + 70, y + 5, cw - 240, 16, rate, PC[pl]);
          doc.text(int(r[f]), x + cw - 70, y + 18, { size: 17, align: 'right' });
          doc.text(f === 'plays' ? '' : d3.format('.0%')(rate), x + cw, y + 18, { size: 16, color: MUTED, align: 'right' });
          y += 30;
        }
      });
      doc.y += bh;
    }
  }

  function build() {
    const v = window.PD.views;
    const sp = v.st.spend;
    const colors = dash.colors.slice(0, 4).map(resolveColor);
    const doc = Doc().page();
    header(doc, v);
    const all = v.all;
    if (all) {
      const kt = [
        { label: 'Impressions', value: int(all.imp), change: chg(all.d_imp) },
        { label: 'Clicks', value: int(all.clk), change: chg(all.d_clk) },
        { label: 'Click-through rate', value: pct(all.ctr), change: chg(all.d_ctr) },
        { label: 'Conversions', value: dec(all.conv), change: chg(all.d_conv) },
      ];
      if (sp) kt.push({ label: 'Investment', value: money0(all.spend), change: chg(all.d_spend) });
      tiles(doc, kt);
      storyBlock(doc, window.PD.extra);
      doc.ensure(420);
      chart(doc, v, colors);
      doc.ensure(220);
      heading(doc, 'Channel mix');
      const mc = [
        { label: 'Platform', w: 0.22, align: 'left', get: (r) => r.platform },
        { label: 'Impressions', w: 0.14, get: (r) => int(r.imp) },
        { label: 'Share', w: 0.08, get: (r) => d3.format('.0%')(r.share_imp || 0) },
        { label: 'Clicks', w: 0.11, get: (r) => int(r.clk) },
        { label: 'CTR', w: 0.09, get: (r) => pct(r.ctr) },
        { label: 'Conv.', w: 0.1, get: (r) => (r.platform === 'Programmatic' ? '—' : dec(r.conv)) },
      ];
      if (sp) mc.push({ label: 'Investment', w: 0.12, get: (r) => money0(r.spend) });
      mc.push({ label: 'Impr. vs prior', w: sp ? 0.14 : 0.26, get: (r) => chg(r.d_imp) });
      table(doc, mc, v.mixRows);
    } else {
      doc.wrap(`${v.st.client} had no paid delivery on Meta, Google Ads, TikTok or programmatic in this time frame.`, M, W - 2 * M, { size: 24 });
    }

    if (all) {
      pacingBlock(doc, v, window.PD.extra);
      audVidBlock(doc, window.PD.extra, colors);
    }

    const camp = (p) => v.cmp.filter((r) => r.period === v.period.period && r.platform === p && (v.st.client === 'All clients' || r.client === v.st.client)).sort((a, b) => b.imp - a.imp);
    const name = (r) => (v.st.client === 'All clients' ? `${r.campaign} · ${r.client}` : r.campaign);
    const sec = (p) => v.tot.get(`${v.period.period}|${v.st.client}|${p}`);

    const m = sec('Meta');
    if (m && (m.imp || m.spend)) {
      doc.page();
      heading(doc, 'Meta (Facebook & Instagram)', colors[0]);
      const cols = [
        { label: 'Campaign', w: sp ? 0.3 : 0.38, align: 'left', get: name },
        { label: 'Impressions', w: 0.12, get: (r) => int(r.imp) },
        { label: 'Link clicks', w: 0.1, get: (r) => int(r.clk) },
        { label: 'CTR', w: 0.08, get: (r) => pct(r.ctr) },
        { label: 'LP views', w: 0.1, get: (r) => int(r.lpv) },
        { label: 'ThruPlays', w: 0.1, get: (r) => int(r.tp) },
      ];
      if (camp('Meta').some((r) => r.conv > 0)) cols.push({ label: 'Leads/calls', w: 0.1, get: (r) => dec(r.conv) });
      if (sp) cols.push({ label: 'Investment', w: 0.12, get: (r) => money0(r.spend) });
      table(doc, cols, camp('Meta'));
      const crM = window.PD.extra && window.PD.extra.creatives && window.PD.extra.creatives.Meta;
      if (crM && crM.length) {
        doc.ensure(160);
        doc.text('Meta creatives', M, doc.y + 26, { size: 22, weight: '700', font: DISPLAY });
        doc.y += 40;
        const cc = [
          { label: 'Creative', w: sp ? 0.3 : 0.4, align: 'left', get: (r) => (v.st.client === 'All clients' ? `${r.name} · ${r.client}` : r.name) },
          { label: 'Impressions', w: 0.13, get: (r) => int(r.imp) },
          { label: 'Link clicks', w: 0.11, get: (r) => int(r.clk) },
          { label: 'CTR', w: 0.09, get: (r) => pct(r.ctr) },
          { label: 'LP views', w: 0.1, get: (r) => int(r.lpv) },
          { label: 'ThruPlays', w: 0.1, get: (r) => int(r.tp) },
        ];
        if (crM.some((r) => r.res > 0)) cc.push({ label: 'Leads/calls', w: 0.09, get: (r) => dec(r.res) });
        if (sp) cc.push({ label: 'Investment', w: 0.1, get: (r) => money0(r.spend) });
        table(doc, cc, crM);
      }
      const px = window.PD.extra && window.PD.extra.pixel;
      if (px) {
        doc.ensure(200);
        doc.text('Website pixel (Meta Pixel)', M, doc.y + 26, { size: 22, weight: '700', font: DISPLAY });
        doc.y += 36;
        const lab = (e) => (e === 'PageView' ? 'Page views' : e.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2'));
        if (px.all) {
          table(doc, [
            { label: 'Client', w: 0.28, align: 'left', get: (r) => r.client },
            { label: 'Pixel', w: 0.3, align: 'left', get: (r) => r.pixel },
            { label: 'Last fired', w: 0.14, get: (r) => dayFmt(parse(r.last)) },
            { label: 'Page views', w: 0.14, get: (r) => int(r.pv) },
            { label: 'Other events', w: 0.14, get: (r) => int(r.other) },
          ], px.rows);
        } else {
          doc.wrap(`Recorded on the website ${px.win}, all visitors. Pixel: ${px.pix}.`, M, W - 2 * M, { size: 16, color: MUTED, lh: 1.4 });
          doc.y += 10;
          table(doc, [
            { label: 'Event', w: 0.7, align: 'left', get: (r) => lab(r.event) },
            { label: 'Count', w: 0.3, get: (r) => int(r.count) },
          ], px.rows);
          doc.wrap(px.foot, M, W - 2 * M, { size: 16, color: MUTED, lh: 1.4 });
          doc.y += 10;
        }
      }
    }
    const g = sec('Google Ads');
    if (g && (g.imp || g.spend)) {
      doc.page();
      heading(doc, 'Google Ads', colors[1]);
      const tcols = [
        { label: 'Campaign type', w: 0.26, align: 'left', get: (r) => r.channel },
        { label: 'Campaigns', w: 0.1, get: (r) => int(r.campaigns) },
        { label: 'Impressions', w: 0.14, get: (r) => int(r.imp) },
        { label: 'Clicks', w: 0.12, get: (r) => int(r.clk) },
        { label: 'CTR', w: 0.1, get: (r) => pct(r.ctr) },
        { label: 'Conv.', w: sp ? 0.12 : 0.28, get: (r) => dec(r.conv) },
      ];
      if (sp) tcols.push({ label: 'Investment', w: 0.16, get: (r) => money0(r.spend) });
      if (v.gRows.length > 1) table(doc, tcols, v.gRows);
      doc.y += 10;
      const cols = [
        { label: 'Campaign', w: sp ? 0.3 : 0.4, align: 'left', get: name },
        { label: 'Type', w: 0.12, align: 'left', get: (r) => r.channel },
        { label: 'Impressions', w: 0.12, get: (r) => int(r.imp) },
        { label: 'Clicks', w: 0.1, get: (r) => int(r.clk) },
        { label: 'CTR', w: 0.08, get: (r) => pct(r.ctr) },
        { label: 'Conv.', w: sp ? 0.08 : 0.18, get: (r) => dec(r.conv) },
      ];
      if (sp) cols.push({ label: 'CPC', w: 0.08, get: (r) => money(r.cpc) }, { label: 'Investment', w: 0.12, get: (r) => money0(r.spend) });
      table(doc, cols, camp('Google Ads'));
    }
    const t = sec('TikTok');
    if (t && (t.imp || t.spend)) {
      doc.ensure(400);
      heading(doc, 'TikTok', colors[2]);
      const cols = [
        { label: 'Campaign', w: sp ? 0.34 : 0.46, align: 'left', get: name },
        { label: 'Impressions', w: 0.13, get: (r) => int(r.imp) },
        { label: 'Clicks', w: 0.1, get: (r) => int(r.clk) },
        { label: 'CTR', w: 0.09, get: (r) => pct(r.ctr) },
        { label: 'Video plays', w: 0.11, get: (r) => int(r.plays) },
        { label: 'Watched 100%', w: 0.11, get: (r) => int(r.p100) },
      ];
      if (sp) cols.push({ label: 'Investment', w: 0.12, get: (r) => money0(r.spend) });
      table(doc, cols, camp('TikTok'));
      const crT = window.PD.extra && window.PD.extra.creatives && window.PD.extra.creatives.TikTok;
      if (crT && crT.length) {
        doc.ensure(160);
        doc.text('TikTok creatives', M, doc.y + 26, { size: 22, weight: '700', font: DISPLAY });
        doc.y += 40;
        const tc = [
          { label: 'Creative', w: sp ? 0.28 : 0.38, align: 'left', get: (r) => (v.st.client === 'All clients' ? `${r.name} · ${r.client}` : r.name) },
          { label: 'Impressions', w: 0.12, get: (r) => int(r.imp) },
          { label: 'Clicks', w: 0.09, get: (r) => int(r.clk) },
          { label: 'CTR', w: 0.09, get: (r) => pct(r.ctr) },
          { label: 'Plays', w: 0.11, get: (r) => int(r.plays) },
          { label: '100%', w: 0.09, get: (r) => int(r.p100) },
          { label: 'Completion', w: 0.12, get: (r) => (r.vcr == null ? '—' : d3.format('.1%')(r.vcr)) },
        ];
        if (sp) tc.push({ label: 'Investment', w: 0.1, get: (r) => money0(r.spend) });
        table(doc, tc, crT);
      }
    }
    const pr = sec('Programmatic');
    if (pr && (pr.imp || pr.spend)) {
      doc.page();
      heading(doc, 'Programmatic (Illumin)', colors[3]);
      const vcr = (r) => (r.vcr == null ? '—' : d3.format('.1%')(r.vcr));
      doc.y += 10;
      const cc = [
        { label: 'Campaign', w: sp ? 0.32 : 0.42, align: 'left', get: name },
        { label: 'Tactic', w: 0.1, align: 'left', get: (r) => r.channel },
        { label: 'Impressions', w: 0.13, get: (r) => int(r.imp) },
        { label: 'Clicks', w: 0.09, get: (r) => int(r.clk) },
        { label: 'CTR', w: 0.08, get: (r) => pct(r.ctr) },
        { label: 'Completion', w: 0.1, get: vcr },
        { label: 'Conv.', w: 0.08, get: (r) => dec(r.pconv) },
      ];
      if (sp) cc.push({ label: 'Investment', w: 0.1, get: (r) => money0(r.spend) });
      table(doc, cc.filter((c) => c.label !== 'Completion' || camp('Programmatic').some((r) => r.vcr != null)), camp('Programmatic'));
      const tacs = (window.PD.extra && window.PD.extra.tactics) || [];
      const FMTS = { name: null, size: (r) => r.size || '—', imp: (r) => int(r.imp), clk: (r) => int(r.clk), ctr: (r) => pct(r.ctr), p100: (r) => int(r.p100), vcr: (r) => (r.vcr == null ? '—' : d3.format('.1%')(r.vcr)), pconv: (r) => dec(r.pconv) };
      for (const t of tacs) {
        doc.ensure(170);
        doc.text(`${t.label} creatives`, M, doc.y + 26, { size: 22, weight: '700', font: DISPLAY });
        doc.text(`${t.n} creative${t.n === 1 ? '' : 's'} · ${int(t.imp)} impressions`, W - M, doc.y + 26, { size: 16, color: MUTED, align: 'right' });
        doc.y += 40;
        const used = t.cols.filter(([f, , c]) => c !== 'opt' || t.rows.some((r) => r[f]));
        const rest = used.length - 1;
        table(doc, used.map(([f, l], i) => (i === 0
          ? { label: l, w: 0.46, align: 'left', get: (r) => (v.st.client === 'All clients' ? `${r.name} · ${r.client}` : r.name) }
          : { label: l, w: 0.54 / rest, align: f === 'size' ? 'left' : undefined, get: FMTS[f] })), t.rows);
      }
      const psz = window.PD.extra && window.PD.extra.psizes;
      if (psz && psz.length) {
        doc.ensure(160);
        doc.text('Display and native by ad size', M, doc.y + 26, { size: 22, weight: '700', font: DISPLAY });
        doc.y += 40;
        table(doc, [
          { label: 'Size', w: 0.2, align: 'left', get: (r) => r.size },
          { label: 'Tactic', w: 0.14, align: 'left', get: (r) => r.channel },
          { label: 'Creatives', w: 0.12, get: (r) => int(r.creatives) },
          { label: 'Impressions', w: 0.16, get: (r) => int(r.imp) },
          { label: 'Clicks', w: 0.12, get: (r) => int(r.clk) },
          { label: 'CTR', w: 0.12, get: (r) => pct(r.ctr) },
          { label: 'Conv.', w: 0.14, get: (r) => dec(r.pconv) },
        ], psz);
      }
    }
    const ga = window.PD.extra && window.PD.extra.ga4;
    if (ga && (ga.all ? ga.rows.length : ga.total)) {
      doc.ensure(420);
      heading(doc, 'Website analytics (GA4)', BLUE);
      const fr = (x) => (x == null ? '—' : d3.format('.1%')(x));
      if (ga.all) {
        table(doc, [
          { label: 'Client', w: 0.34, align: 'left', get: (r) => r.client },
          { label: 'Sessions', w: 0.14, get: (r) => int(r.sessions) },
          { label: 'Vs prior', w: 0.12, get: (r) => chg(r.d_sessions) },
          { label: 'Engaged', w: 0.13, get: (r) => int(r.engaged) },
          { label: 'Engagement rate', w: 0.15, get: (r) => fr(r.engagement_rate) },
          { label: 'Key events', w: 0.12, get: (r) => int(r.key_events) },
        ], ga.rows);
      } else {
        const t = ga.total;
        tiles(doc, [
          { label: 'Sessions', value: int(t.sessions), change: chg(t.d_sessions) },
          { label: 'Engaged sessions', value: int(t.engaged), change: chg(t.d_engaged) },
          { label: 'Engagement rate', value: fr(t.engagement_rate) },
          { label: 'Users', value: int(t.users) },
          { label: 'Key events', value: int(t.key_events), change: chg(t.d_key_events) },
        ]);
        table(doc, [
          { label: 'Channel', w: 0.34, align: 'left', get: (r) => r.channel },
          { label: 'Sessions', w: 0.14, get: (r) => int(r.sessions) },
          { label: 'Share', w: 0.12, get: (r) => d3.format('.0%')(r.share || 0) },
          { label: 'Engaged', w: 0.13, get: (r) => int(r.engaged) },
          { label: 'Engagement rate', w: 0.15, get: (r) => fr(r.engagement_rate) },
          { label: 'Key events', w: 0.12, get: (r) => int(r.key_events) },
        ], ga.rows);
      }
    }
    doc.ensure(160);
    doc.y += 10;
    doc.wrap(document.getElementById('defs').textContent, M, W - 2 * M, { size: 16, color: MUTED, lh: 1.5 });

    const n = doc.pages.length;
    doc.pages.forEach((c, i) => {
      const ctx = c.getContext('2d');
      ctx.fillStyle = LINE;
      ctx.fillRect(M, H - M - 20, W - 2 * M, 1);
      ctx.font = `15px ${FONT}`;
      ctx.fillStyle = MUTED;
      ctx.textAlign = 'left';
      ctx.fillText(`${v.st.client} · ${v.period.label} · Ad platform data through ${dayFmt(parse(window.PD.latest))}`, M, H - M + 6);
      ctx.textAlign = 'right';
      ctx.fillText(`Page ${i + 1} of ${n}`, W - M, H - M + 6);
    });
    return doc.pages;
  }

  function toPdf(canvases) {
    const enc = new TextEncoder();
    const parts = [];
    let len = 0;
    const offs = [];
    const w = (s) => {
      const b = typeof s === 'string' ? enc.encode(s) : s;
      parts.push(b);
      len += b.length;
    };
    const jpgs = canvases.map((c) => {
      const b64 = c.toDataURL('image/jpeg', 0.9).split(',')[1];
      const bin = atob(b64);
      const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return u;
    });
    const n = jpgs.length;
    const obj = (id, body) => {
      offs[id] = len;
      w(id + ' 0 obj\n');
      body();
      w('\nendobj\n');
    };
    w('%PDF-1.4\n%âãÏÓ\n');
    obj(1, () => w('<< /Type /Catalog /Pages 2 0 R >>'));
    const kids = jpgs.map((_, i) => `${3 + 3 * i} 0 R`).join(' ');
    obj(2, () => w(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`));
    jpgs.forEach((j, i) => {
      const p = 3 + 3 * i, im = p + 1, ct = p + 2;
      obj(p, () => w(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${ct} 0 R >>`));
      obj(im, () => {
        w(`<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${j.length} >>\nstream\n`);
        w(j);
        w('\nendstream');
      });
      const cs = 'q 612 0 0 792 0 0 cm /Im0 Do Q';
      obj(ct, () => w(`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`));
    });
    const xref = len;
    const size = 3 + 3 * n;
    w(`xref\n0 ${size}\n0000000000 65535 f \n`);
    for (let id = 1; id < size; id++) w(String(offs[id]).padStart(10, '0') + ' 00000 n \n');
    w(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    return new Blob(parts, { type: 'application/pdf' });
  }

  async function save(blob, filename) {
    try {
      const api = window.claude && typeof window.claude.use === 'function' ? await window.claude.use('downloads') : null;
      if (api) {
        await api.save({ filename, data: blob });
        return;
      }
    } catch (e) {
      if (e && (e.code === 'declined' || e.code === 'rate_limited')) return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }

  btn.addEventListener('click', async () => {
    if (!window.PD || !window.PD.ready || !window.PD.views) return;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Building PDF…';
    try {
      await new Promise((r) => setTimeout(r, 30));
      try {
        await Promise.all([document.fonts.load("800 40px 'PD Display'"), document.fonts.load("700 20px 'PD Display'"), document.fonts.load("400 18px 'PD Text'"), document.fonts.load("700 18px 'PD Text'")]);
      } catch (e) {}
      const v = window.PD.views;
      const blob = toPdf(build());
      const safe = (s) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');
      await save(blob, `${safe(v.st.client)}_${safe(v.period.label)}_${v.period.end}.pdf`);
      btn.textContent = label;
    } catch (e) {
      btn.textContent = 'Export failed — try again';
      setTimeout(() => (btn.textContent = label), 4000);
    } finally {
      btn.disabled = false;
    }
  });
})();

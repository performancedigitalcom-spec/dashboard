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
      if (it.change) {
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
    // small multiples: one stacked bar chart per metric, so the PDF shows everything
    const sp = v.st.spend;
    const rows = v.daily.filter((r) => r.client === v.st.client && r.d >= v.period.start && r.d <= v.period.end);
    const days = d3.utcDay.range(parse(v.period.start), d3.utcDay.offset(parse(v.period.end), 1)).map((d) => d.toISOString().slice(0, 10));
    const plats = PLATS.filter((p) => rows.some((r) => r.platform === p && (r.imp || r.clk || r.spend)));
    const metrics = [['imp', 'Impressions', compact.format], ['clk', 'Clicks', compact.format]];
    if (rows.some((r) => r.conv)) metrics.push(['conv', 'Conversions', compact.format]);
    if (sp && rows.some((r) => r.spend)) metrics.push(['spend', 'Investment', (x) => '$' + compact.format(x)]);
    const gap = 36, cw = (W - 2 * M - gap) / 2, ch = 250;
    const nRows = Math.ceil(metrics.length / 2);
    doc.ensure(90 + Math.min(nRows, 1) * (ch + 50));
    const { ctx } = doc;
    doc.text('Daily delivery by platform', M, doc.y + 24, { size: 22, weight: '700', font: DISPLAY });
    // colour key, top right
    let lx = W - M;
    const keyItems = plats.slice().reverse();
    for (const p of keyItems) {
      ctx.font = `600 16px ${FONT}`;
      const tw = ctx.measureText(p).width;
      lx -= tw;
      doc.text(p, lx, doc.y + 24, { size: 16, weight: '600', color: INK });
      lx -= 22;
      ctx.fillStyle = colors[PLATS.indexOf(p)];
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(lx, doc.y + 11, 14, 14, 3) : ctx.rect(lx, doc.y + 11, 14, 14);
      ctx.fill();
      lx -= 24;
    }
    doc.y += 46;
    for (let k = 0; k < metrics.length; k += 2) {
      doc.ensure(ch + 50);
      for (let c = 0; c < 2 && k + c < metrics.length; c++) {
        const [f, label, fmt] = metrics[k + c];
        const x0 = M + c * (cw + gap), top = doc.y;
        const by = new Map(days.map((d) => [d, Object.fromEntries(PLATS.map((p) => [p, 0]))]));
        for (const r of rows) if (by.has(r.d)) by.get(r.d)[r.platform] += r[f] || 0;
        const total = d3.sum(rows, (r) => r[f] || 0);
        ctx.fillStyle = PANEL;
        ctx.fillRect(x0, top, cw, ch + 30);
        doc.text(label.toUpperCase(), x0 + 16, top + 28, { size: 14, weight: '700', color: MUTED });
        doc.text(f === 'spend' ? money0(total) : f === 'conv' ? dec(total) : int(total), x0 + cw - 16, top + 30, { size: 20, weight: '800', font: DISPLAY, align: 'right' });
        const plotTop = top + 48, plotH = ch - 70, left = x0 + 62, right = x0 + cw - 14;
        const max = d3.max(days, (d) => PLATS.reduce((a, p) => a + by.get(d)[p], 0)) || 1;
        const y = d3.scaleLinear([0, max], [plotH, 0]).nice();
        ctx.strokeStyle = LINE;
        ctx.lineWidth = 1;
        for (const t of y.ticks(3)) {
          const yy = plotTop + y(t);
          ctx.beginPath();
          ctx.moveTo(left, yy);
          ctx.lineTo(right, yy);
          ctx.stroke();
          doc.text(fmt(t), left - 8, yy + 5, { size: 13, color: MUTED, align: 'right' });
        }
        const bw = (right - left) / days.length;
        days.forEach((d, i) => {
          let base = 0;
          PLATS.forEach((p, pi) => {
            const val = by.get(d)[p];
            if (!val) return;
            const y0 = plotTop + y(base), y1 = plotTop + y(base + val);
            ctx.fillStyle = colors[pi];
            ctx.fillRect(left + i * bw + bw * 0.12, y1, Math.max(1, bw * 0.76), y0 - y1);
            base += val;
          });
        });
        const step = Math.ceil(days.length / 4);
        days.forEach((d, i) => {
          if (i % step) return;
          doc.text(d3.utcFormat('%b %-d')(parse(d)), left + i * bw + bw / 2, plotTop + plotH + 22, { size: 13, color: MUTED, align: 'center' });
        });
      }
      doc.y += ch + 30 + 18;
    }
    doc.y += 6;
  }

  function tacticMix(doc, rows) {
    if (!rows || !rows.length) return;
    const { ctx } = doc;
    doc.ensure(120);
    // labels (chips)
    let x = M, y = doc.y;
    for (const r of rows) {
      const label = r.name, val = r.share < 0.01 ? '<1%' : d3.format('.0%')(r.share);
      ctx.font = `700 16px ${FONT}`;
      const w1 = ctx.measureText(label).width;
      ctx.font = `600 16px ${FONT}`;
      const w2 = ctx.measureText(val).width;
      const w = 34 + w1 + 10 + w2 + 16;
      if (x + w > W - M) { x = M; y += 44; }
      ctx.fillStyle = r.color + '1F';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x, y, w, 34, 17) : ctx.rect(x, y, w, 34);
      ctx.fill();
      ctx.fillStyle = r.color;
      ctx.beginPath();
      ctx.arc(x + 18, y + 17, 6, 0, Math.PI * 2);
      ctx.fill();
      doc.text(label, x + 32, y + 23, { size: 16, weight: '700', color: INK });
      doc.text(val, x + 32 + w1 + 10, y + 23, { size: 16, weight: '600', color: MUTED });
      x += w + 10;
    }
    y += 50;
    // 100% share bar
    let bx = M;
    const bwid = W - 2 * M;
    for (const r of rows) {
      const w = Math.max(3, r.share * bwid);
      ctx.fillStyle = r.color;
      ctx.fillRect(bx, y, Math.max(1, w - 2), 14);
      bx += w;
    }
    doc.y = y + 32;
  }

  function donutPdf(doc, x, y, title, slices, center) {
    const { ctx } = doc;
    const R = 92, r0 = 60, cx = x + R, cy = y + 44 + R;
    doc.text(title, x, y + 22, { size: 18, weight: '700', font: DISPLAY });
    const tot = d3.sum(slices, (d) => d.v) || 1;
    let a = -Math.PI / 2;
    for (const s of slices) {
      const b = a + (s.v / tot) * Math.PI * 2;
      ctx.fillStyle = s.c;
      ctx.beginPath();
      ctx.arc(cx, cy, R, a, b);
      ctx.arc(cx, cy, r0, b, a, true);
      ctx.closePath();
      ctx.fill();
      a = b;
    }
    doc.text(center[0], cx, cy + 8, { size: 26, weight: '800', font: DISPLAY, align: 'center' });
    String(center[1]).split('\n').forEach((t, i) => doc.text(t, cx, cy + 28 + i * 16, { size: 13, color: MUTED, align: 'center' }));
    let ly = y + 58;
    const lx = x + 2 * R + 26;
    for (const s of slices) {
      ctx.fillStyle = s.c;
      ctx.fillRect(lx, ly - 12, 14, 14);
      doc.text(s.label, lx + 22, ly, { size: 15, color: s.dim ? MUTED : INK, maxW: 210 });
      doc.text(s.v / tot < 0.01 ? '<1%' : d3.format('.0%')(s.v / tot), lx + 300, ly, { size: 15, weight: '700', color: s.dim ? MUTED : INK, align: 'right' });
      ly += 25;
    }
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

  function storyBlock(doc, ex, showFix, upOnly) {
    if (!ex || !ex.story) return;
    heading(doc, 'Campaign story');
    doc.wrap(upOnly ? ex.storyUp || ex.story : ex.story, M, W - 2 * M, { size: 21, lh: 1.5 });
    doc.y += 26;
    const two = showFix !== false;
    const gap = 30, cw = two ? (W - 2 * M - gap) / 2 : W - 2 * M, size = 19, lh = size * 1.45;
    const cols = [
      { title: 'Highlights', color: '#1a7f37', items: ex.good.length ? ex.good : ['Nothing stands out above the market benchmarks or the prior period yet.'] },
      two && { title: 'Things to improve', color: '#c62828', items: ex.fix.length ? ex.fix : ['No clear weak spots against the market benchmarks or the prior period.'] },
    ].filter(Boolean).map((c) => ({ ...c, wrapped: c.items.map((t) => lines(doc, t, cw - 60, size)) }));
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

  function defsBlock(doc, cx) {
    doc.ensure(240);
    doc.text('What programmatic conversions count', M, doc.y + 26, { size: 22, weight: '700', font: DISPLAY });
    doc.y += 38;
    const cs = cx.convSum;
    if (cs && cs.parts.length) {
      doc.wrap(cs.text, M, W - 2 * M, { size: 16, color: INK, lh: 1.45 });
      doc.y += 8;
      // stacked bar + key
      const bw = W - 2 * M, by = doc.y, tot = cs.parts.reduce((a, p) => a + p.v, 0) || 1;
      let x = M;
      for (const p of cs.parts) {
        const w = Math.max(4, (p.v / tot) * bw - 2);
        doc.ctx.fillStyle = p.c;
        doc.ctx.fillRect(x, by, w, 16);
        x += w + 2;
      }
      doc.y += 30;
      const cw = (W - 2 * M) / cs.parts.length;
      let maxH = 0;
      cs.parts.forEach((p, i) => {
        const cx0 = M + i * cw;
        doc.ctx.fillStyle = p.c;
        doc.ctx.fillRect(cx0, doc.y, 4, 64);
        doc.text(d3.format(',.0f')(p.v), cx0 + 14, doc.y + 24, { size: 22, weight: '700', font: DISPLAY });
        doc.text(`${p.k.toUpperCase()} · ${p.pct || d3.format('.0%')(p.share)}`, cx0 + 14, doc.y + 46, { size: 12, weight: '700', color: MUTED });
        let yy = doc.y + 66;
        if (p.l) for (const t of lines(doc, p.l, cw - 30, 14).slice(0, 3)) { doc.text(t, cx0 + 14, yy, { size: 14, color: INK }); yy += 19; }
        maxH = Math.max(maxH, yy - doc.y);
      });
      doc.y += maxH + 12;
    }
    if (!cx.single || !cx.defs.some((d) => d.status !== 'NONE')) { doc.y += 10; return; }
    if (cx.defs.length === 1 && cx.defs[0].folded) {
      const d = cx.defs[0];
      doc.wrap(`Definitions for ${d.journey}, ${(d.when || '').replace(/^Since/, 'in force since')}. ${d.notes || ''}`.trim(), M, W - 2 * M, { size: 15, color: MUTED, lh: 1.45 });
      doc.y += 16;
      return;
    }
    doc.wrap(cx.changed ? 'The definitions changed during this time frame, so each date range is listed with the conversions counted under it.' : 'Programmatic conversions are Primary + Secondary + Tertiary. Each client and journey sets what those count; the number is how many happened in this time frame.', M, W - 2 * M, { size: 16, color: MUTED, lh: 1.45 });
    doc.y += 6;
    const lw = 330, kx = M + lw + 20, vx = kx + 130, nx = W - M, vw = W - M - vx - 90;
    for (const d of cx.defs) {
      const msg = d.status === 'NONE' ? 'No conversion definitions on file for this journey yet.' : d.status === 'GAP' ? 'These days fall outside every definition on file.' : d.notes || 'No confirmed conversion mapping for these dates.';
      const items = d.status === 'MAPPED' ? d.items : [['', msg, ''], ...d.items];
      const wrapped = items.map(([k, t, n]) => [k, lines(doc, t || '—', vw, 16), n]);
      const jl = lines(doc, d.journey, lw, 16);
      const h = Math.max(jl.length * 23 + 24, wrapped.reduce((a, [, l]) => a + l.length * 23 + 4, 0) + (d.notes && d.status === 'MAPPED' ? 26 : 0)) + 14;
      doc.ensure(h);
      doc.ctx.fillStyle = LINE;
      doc.ctx.fillRect(M, doc.y, W - 2 * M, 1);
      let y = doc.y + 26;
      for (const t of jl) { doc.text(t, M, y, { size: 16, weight: '700' }); y += 23; }
      doc.text(d.when || '', M, y, { size: 15, color: MUTED });
      y = doc.y + 26;
      for (const [k, l, n] of wrapped) {
        if (k) doc.text(k.toUpperCase(), kx, y, { size: 13, weight: '700', color: MUTED });
        if (n) doc.text(n, nx, y, { size: 16, weight: '700', align: 'right' });
        for (const t of l) { doc.text(t, k ? vx : kx, y, { size: 16, color: k || d.status === 'MAPPED' ? INK : '#b45309' }); y += 23; }
        y += 4;
      }
      if (d.notes && d.status === 'MAPPED') doc.text(d.notes, vx, y, { size: 14, color: MUTED, maxW: vw });
      doc.y += h;
    }
    doc.y += 10;
  }

  function ctvBlock(doc, cx, v) {
    const k1 = (r) => (r.cpm == null ? '—' : d3.format(',.2f')(r.cpm));
    const shareCol = (w) => ({ label: 'Share of CTV impressions', w, align: 'left', draw: (ctx, x, y, cw, rh, r) => {
      hbar(doc.ctx, x + 8, y + 12, cw - 80, 10, r.share, r.muted ? '#94A3B8' : BLUE);
      doc.text(d3.format('.0%')(r.share || 0), x + cw - 8, y + 23, { size: 15, color: MUTED, align: 'right' });
    } });
    const conv = (f) => (r) => d3.format(',.0f')(r[f] || 0);
    const lab = (r) => r.label + (r.count ? ` (${r.count})` : '');
    const dn = window.PD.extra && window.PD.extra.ctvDonuts;
    if (dn) {
      doc.ensure(300);
      const half = (W - 2 * M) / 2;
      donutPdf(doc, M, doc.y, 'CTV impressions by network', dn.net, dn.netCenter);
      donutPdf(doc, M + half + 10, doc.y, 'CTV impressions by household income', dn.hhi, dn.hhiCenter);
      doc.y += 44 + 2 * 92 + Math.max(0, Math.max(dn.net.length, dn.hhi.length) * 25 - 2 * 92 + 10) + 24;
    }
    doc.ensure(200);
    doc.text('CTV streaming networks', M, doc.y + 26, { size: 22, weight: '700', font: DISPLAY });
    doc.text(cx.netSub, W - M, doc.y + 26, { size: 16, color: MUTED, align: 'right' });
    doc.y += 40;
    const anyConv = cx.nets.some((r) => r.conv);
    let nc = [{ label: 'Network', w: 0.24, align: 'left', get: lab }, shareCol(0.22), { label: 'Impressions', w: 0.14, get: (r) => int(r.imp) }];
    if (anyConv) nc.push({ label: 'Conv.', w: 0.1, get: conv('conv') }, { label: 'Per 1K impr.', w: 0.12, get: k1 });
    if (cx.pst) for (const [f, l] of [['p1', 'Primary'], ['p2', 'Secondary'], ['p3', 'Tertiary']]) if (cx.nets.some((r) => r[f])) nc.push({ label: l, w: 0.115, get: conv(f) });
    const tw = nc.reduce((a, c) => a + c.w, 0);
    nc = nc.map((c) => ({ ...c, w: c.w / tw }));
    table(doc, nc, cx.nets);
    const na = window.PD.extra && window.PD.extra.netAll;
    if (na && na.list.length > 12) {
      // more networks, in three compact columns (rank, name, impressions)
      const inTop = new Set(cx.nets.map((r) => r.label));
      const list = na.list.filter((r) => !inTop.has(r[0])).slice(0, 27);
      doc.ensure(90);
      doc.text(`More networks · ${int(na.count)} named in total`, M, doc.y + 30, { size: 17, weight: '700' });
      doc.y += 44;
      const cols = 3, cw = (W - 2 * M) / cols, rows = Math.ceil(list.length / cols), rh = 25;
      doc.ensure(rows * rh + 20);
      list.forEach(([name, imp], i) => {
        const cx0 = M + Math.floor(i / rows) * cw, y = doc.y + (i % rows) * rh + 16;
        doc.text(`${i + 13}.`, cx0, y, { size: 13.5, color: MUTED });
        doc.text(name, cx0 + 34, y, { size: 14.5, maxW: cw - 150 });
        doc.text(int(imp), cx0 + cw - 20, y, { size: 14.5, color: MUTED, align: 'right' });
      });
      doc.y += rows * rh + 14;
      if (na.count > 12 + list.length) { doc.text(`Plus ${int(na.count - 12 - list.length)} more networks with smaller delivery. The full list is on the dashboard.`, M, doc.y + 8, { size: 14, color: MUTED }); doc.y += 26; }
    }
    doc.ensure(200);
    doc.text('CTV households by income', M, doc.y + 26, { size: 22, weight: '700', font: DISPLAY });
    doc.text(cx.hhSub, W - M, doc.y + 26, { size: 16, color: MUTED, align: 'right' });
    doc.y += 40;
    let hc = [{ label: 'Household income', w: 0.26, align: 'left', get: lab }, shareCol(0.34), { label: 'Impressions', w: 0.16, get: (r) => int(r.imp) }];
    if (cx.hhi.some((r) => r.conv)) hc.push({ label: 'Conv.', w: 0.1, get: conv('conv') }, { label: 'Per 1K impr.', w: 0.14, get: k1 });
    const th = hc.reduce((a, c) => a + c.w, 0);
    table(doc, hc.map((c) => ({ ...c, w: c.w / th })), cx.hhi);
  }

  let HIDE_DOWN = false;
  const chgP = (v) => (HIDE_DOWN && v != null && isFinite(v) && v < 0 ? '' : chg(v));
  function build(sel) {
    const on = (k) => !sel || sel.has(k);
    HIDE_DOWN = on('hidedown');
    const v = window.PD.views;
    const sp = v.st.spend;
    const colors = dash.colors.slice(0, 4).map(resolveColor);
    const doc = Doc().page();
    header(doc, v);
    const all = v.all;
    if (all) {
      const kt = [
        { label: 'Impressions', value: int(all.imp), change: chgP(all.d_imp) },
        { label: 'Clicks', value: int(all.clk), change: chgP(all.d_clk) },
        { label: 'Click-through rate', value: pct(all.ctr), change: chgP(all.d_ctr) },
        { label: 'Conversions', value: dec(all.conv), change: chgP(all.d_conv) },
      ];
      if (sp) kt.push({ label: 'Investment', value: money0(all.spend), change: chgP(all.d_spend) });
      if (on('summary')) {
        tiles(doc, kt);
        storyBlock(doc, window.PD.extra, on('improve'), HIDE_DOWN);
      }
      if (on('daily')) {
        doc.ensure(420);
        chart(doc, v, colors);
      }
      if (on('mix')) {
      doc.ensure(220);
      heading(doc, 'Channel mix');
      tacticMix(doc, v.tacRows);
      const mc = [
        { label: 'Platform', w: 0.22, align: 'left', get: (r) => r.platform },
        { label: 'Impressions', w: 0.14, get: (r) => int(r.imp) },
        { label: 'Share', w: 0.08, get: (r) => d3.format('.0%')(r.share_imp || 0) },
        { label: 'Clicks', w: 0.11, get: (r) => int(r.clk) },
        { label: 'CTR', w: 0.09, get: (r) => pct(r.ctr) },
        { label: 'Conv.', w: 0.1, get: (r) => (r.platform === 'Programmatic' ? '—' : dec(r.conv)) },
      ];
      if (sp) mc.push({ label: 'Investment', w: 0.12, get: (r) => money0(r.spend) });
      mc.push({ label: 'Impr. vs prior', w: sp ? 0.14 : 0.26, get: (r) => chgP(r.d_imp) });
      table(doc, mc, v.mixRows);
      }
    } else {
      doc.wrap(`${v.st.client} had no paid delivery on Meta, Google Ads, TikTok or programmatic in this time frame.`, M, W - 2 * M, { size: 24 });
    }

    const fresh = () => {
      if (sel && sel.size < 6) doc.ensure(520);
      else if (doc.y > M + 260) doc.page();
    };
    if (all) {
      if (on('pacing')) pacingBlock(doc, v, window.PD.extra);
      const ex = window.PD.extra || {};
      if (on('audience') || on('video')) audVidBlock(doc, { ...ex, aud: on('audience') ? ex.aud : null, vid: on('video') ? ex.vid : null }, colors);
    }

    const camp = (p) => v.cmp.filter((r) => r.period === v.period.period && r.platform === p && (v.st.client === 'All clients' || r.client === v.st.client)).sort((a, b) => b.imp - a.imp);
    const name = (r) => (v.st.client === 'All clients' ? `${r.campaign} · ${r.client}` : r.campaign);
    const sec = (p) => v.tot.get(`${v.period.period}|${v.st.client}|${p}`);

    const m = sec('Meta');
    if (on('meta') && m && (m.imp || m.spend)) {
      fresh();
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
    if (on('google') && g && (g.imp || g.spend)) {
      fresh();
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
    if (on('tiktok') && t && (t.imp || t.spend)) {
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
    const tacsAll = (window.PD.extra && window.PD.extra.tactics) || [];
    const progOn = on('prog') || on('sizes') || on('ctv') || tacsAll.some((x) => on('tac:' + x.tac));
    if (progOn && pr && (pr.imp || pr.spend)) {
      fresh();
      heading(doc, 'Programmatic', colors[3]);
      const vcr = (r) => (r.vcr == null ? '—' : d3.format('.1%')(r.vcr));
      doc.y += 10;
      if (on('prog')) {
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
      }
      const cx = window.PD.extra && window.PD.extra.ctv;
      if ((on('prog') || on('ctv')) && cx && ((cx.single && cx.defs.some((d) => d.status !== 'NONE')) || (cx.convSum && cx.convSum.parts.length))) defsBlock(doc, cx);
      const tacs = tacsAll.filter((x) => on('tac:' + x.tac));
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
      if (on('ctv') && cx && cx.show) ctvBlock(doc, cx, v);
      const psz = window.PD.extra && window.PD.extra.psizes;
      if (on('sizes') && psz && psz.length) {
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
    if (on('ga4') && ga && (ga.all ? ga.rows.length : ga.total)) {
      doc.ensure(420);
      heading(doc, 'Website analytics (GA4)', BLUE);
      const fr = (x) => (x == null ? '—' : d3.format('.1%')(x));
      if (ga.all) {
        table(doc, [
          { label: 'Client', w: 0.34, align: 'left', get: (r) => r.client },
          { label: 'Sessions', w: 0.14, get: (r) => int(r.sessions) },
          { label: 'Vs prior', w: 0.12, get: (r) => chgP(r.d_sessions) },
          { label: 'Engaged', w: 0.13, get: (r) => int(r.engaged) },
          { label: 'Engagement rate', w: 0.15, get: (r) => fr(r.engagement_rate) },
          { label: 'Key events', w: 0.12, get: (r) => int(r.key_events) },
        ], ga.rows);
      } else {
        const t = ga.total;
        tiles(doc, [
          { label: 'Sessions', value: int(t.sessions), change: chgP(t.d_sessions) },
          { label: 'Engaged sessions', value: int(t.engaged), change: chgP(t.d_engaged) },
          { label: 'Engagement rate', value: fr(t.engagement_rate) },
          { label: 'Users', value: int(t.users) },
          { label: 'Key events', value: int(t.key_events), change: chgP(t.d_key_events) },
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
    if (on('summary')) {
      doc.ensure(160);
      doc.y += 10;
      doc.wrap(document.getElementById('defs').textContent, M, W - 2 * M, { size: 16, color: MUTED, lh: 1.5 });
    }

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

  const menu = document.getElementById('pd-export-menu');
  const list = document.getElementById('pd-export-list');
  const go = document.getElementById('pd-export-go');
  const KEY = 'pd-export-sel';
  function options() {
    const v = window.PD.views, ex = window.PD.extra || {};
    const has = (p) => { const r = v.tot.get(`${v.period.period}|${v.st.client}|${p}`); return r && (r.imp || r.spend); };
    const groups = [
      ['Overview', [['summary', 'Headline numbers, story and highlights'], ex.story && ['improve', '“Things to improve” box'], ['daily', 'Daily delivery charts'], ['mix', 'Channel mix'],
        ex.pacing && ex.pacing.length && ['pacing', 'Pacing this month'], ex.aud && ['audience', 'Who saw the ads'], ex.vid && ['video', 'Video completion']]],
      ['Platforms', [has('Meta') && ['meta', 'Meta (campaigns, creatives, pixel)'], has('Google Ads') && ['google', 'Google Ads'], has('TikTok') && ['tiktok', 'TikTok'],
        has('Programmatic') && ['prog', 'Programmatic campaigns']]],
      ['Programmatic tactics', [...(ex.tactics || []).flatMap((t) => [['tac:' + t.tac, `${t.label} creatives`], t.tac === 'CTV' && ex.ctv && ex.ctv.show && ['ctv', 'CTV networks and households']]), !(ex.tactics || []).some((t) => t.tac === 'CTV') && ex.ctv && ex.ctv.show && ['ctv', 'CTV networks and households'], ex.psizes && ex.psizes.length && ['sizes', 'Display and native by ad size']]],
      ['Website', [ex.ga4 && (ex.ga4.all ? ex.ga4.rows.length : ex.ga4.total) && ['ga4', 'Website analytics (GA4)']]],
      ['Options', [['hidedown', 'Hide decreases vs the prior period']]],
    ];
    return groups.map(([g, items]) => [g, items.filter(Boolean)]).filter(([, items]) => items.length);
  }
  function fill() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    list.replaceChildren();
    for (const [g, items] of options()) {
      const h = document.createElement('div');
      h.className = 'grp';
      h.textContent = g;
      list.append(h);
      for (const [k, label] of items) {
        const l = document.createElement('label');
        const c = document.createElement('input');
        c.type = 'checkbox';
        c.value = k;
        c.checked = !saved || saved[k] !== false;
        l.append(c, ' ' + label);
        list.append(l);
      }
    }
  }
  const boxes = () => [...list.querySelectorAll('input[type=checkbox]')];
  function setOpen(open) {
    if (open) fill();
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  }
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (!window.PD || !window.PD.ready || !window.PD.views) return;
    setOpen(menu.hidden);
  });
  document.addEventListener('click', (ev) => { if (!menu.hidden && !menu.contains(ev.target) && ev.target !== btn) setOpen(false); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') setOpen(false); });
  menu.querySelector('[data-all]').addEventListener('click', () => boxes().forEach((b) => (b.checked = true)));
  menu.querySelector('[data-none]').addEventListener('click', () => boxes().forEach((b) => { if (b.value !== 'hidedown') b.checked = false; }));
  go.addEventListener('click', async () => {
    const bs = boxes();
    const sel = new Set(bs.filter((b) => b.checked).map((b) => b.value));
    if (!sel.size) return;
    try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(bs.map((b) => [b.value, b.checked])))); } catch (e) {}
    const label = go.textContent;
    go.disabled = true;
    go.textContent = 'Building PDF…';
    try {
      await new Promise((r) => setTimeout(r, 30));
      try {
        await Promise.all([document.fonts.load("800 40px 'PD Display'"), document.fonts.load("700 20px 'PD Display'"), document.fonts.load("400 18px 'PD Text'"), document.fonts.load("700 18px 'PD Text'")]);
      } catch (e) {}
      const v = window.PD.views;
      const partial = bs.some((b) => !b.checked && b.value !== 'improve' && b.value !== 'hidedown');
      const blob = toPdf(build(sel));
      const safe = (s) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');
      let part = '';
      if (partial) {
        const names = bs.filter((b) => b.checked && b.value !== 'improve' && b.value !== 'hidedown').map((b) => b.parentElement.textContent.trim().split(' ')[0]);
        part = '_' + safe(names.length > 2 ? 'selected-sections' : names.join('-'));
      }
      await save(blob, `${safe(v.st.client)}_${safe(v.period.label)}_${v.period.end}${part}.pdf`);
      go.textContent = label;
      setOpen(false);
    } catch (e) {
      console.error(e);
      go.textContent = 'Export failed — try again';
      setTimeout(() => (go.textContent = label), 4000);
    } finally {
      go.disabled = false;
    }
  });
})();

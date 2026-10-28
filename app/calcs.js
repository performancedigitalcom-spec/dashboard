// Keep a copy of each calculation so the page can rerun them for a custom date range.
(function () {
  if (typeof window === 'undefined' || !window.dash || window.PD_SPECS) return;
  var specs = (window.PD_SPECS = {});
  var orig = window.dash.calc;
  try {
    window.dash.calc = function (id, o) {
      specs[id] = o;
      return orig.apply(window.dash, arguments);
    };
  } catch (e) {}
})();

dash.calc('periods', {
  title: 'Reporting periods',
  description: 'The date windows in the period picker, counted back from the latest day any platform has reported, each with the equal-length window before it.',
  inputs: ['meta_daily', 'google_daily', 'tiktok_daily'],
  fn: (meta_daily, google_daily, tiktok_daily) => {
    let max = '';
    for (const rows of [meta_daily, google_daily, tiktok_daily]) for (const r of rows) if (r.d > max) max = r.d;
    const D = (s) => new Date(s + 'T00:00:00Z');
    const S = (d) => d.toISOString().slice(0, 10);
    const add = (d, n) => new Date(+d + n * 864e5);
    const U = (y, m, day) => new Date(Date.UTC(y, m, day));
    const end = D(max);
    const y = end.getUTCFullYear();
    const mo = end.getUTCMonth();
    const out = [];
    const push = (period, label, s, e, ps, pe) =>
      out.push({ period, label, start: S(s), end: S(e), prev_start: S(ps), prev_end: S(pe) });
    push('last7', 'Last 7 days', add(end, -6), end, add(end, -13), add(end, -7));
    push('last30', 'Last 30 days', add(end, -29), end, add(end, -59), add(end, -30));
    const ms = U(y, mo, 1);
    const pms = U(y, mo - 1, 1);
    const elapsed = Math.round((end - ms) / 864e5);
    push('mtd', 'Month to date', ms, end, pms, new Date(Math.min(+add(pms, elapsed), +add(ms, -1))));
    push('lastmonth', 'Last month', pms, add(ms, -1), U(y, mo - 2, 1), add(pms, -1));
    const qs = U(y, Math.floor(mo / 3) * 3, 1);
    const pqs = U(y, Math.floor(mo / 3) * 3 - 3, 1);
    push('qtd', 'Quarter to date', qs, end, pqs, new Date(Math.min(+add(pqs, Math.round((end - qs) / 864e5)), +add(qs, -1))));
    const ys = U(y, 0, 1);
    const pys = U(y - 1, 0, 1);
    push('ytd', 'Year to date', ys, end, pys, add(pys, Math.round((end - ys) / 864e5)));
    const fmt = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    for (let m = mo; m >= 0; m--) {
      const s = U(y, m, 1);
      const e = new Date(Math.min(+U(y, m + 1, 0), +end));
      push('m' + S(s).slice(0, 7), fmt.format(s), s, e, U(y, m - 1, 1), U(y, m, 0));
    }
    return out;
  },
});

dash.calc('totals', {
  title: 'Totals by client, platform and period',
  description: 'Each client’s delivery summed over each period and the period before it, per platform and across all platforms. Clicks are link clicks on Meta; conversions are Google Ads conversions plus Meta leads, calls and messaging conversations.',
  inputs: ['campaigns', 'meta_daily', 'google_daily', 'tiktok_daily', 'programmatic_daily', 'periods'],
  fn: (campaigns, meta_daily, google_daily, tiktok_daily, programmatic_daily, periods) => {
    const owner = {};
    for (const c of campaigns) owner[c.platform + '|' + c.campaign_id] = c.client;
    const F = ['imp', 'clk', 'spend', 'conv', 'lpv', 'vv', 'tp', 'pe', 'leads', 'calls', 'msgs', 'plays', 'p100', 'pconv'];
    const series = new Map();
    const put = (client, platform, d, v) => {
      for (const c of [client, 'All clients']) {
        for (const p of [platform, 'All']) {
          const key = c + '|' + p;
          let m = series.get(key);
          if (!m) series.set(key, (m = new Map()));
          let o = m.get(d);
          if (!o) {
            o = {};
            for (const f of F) o[f] = 0;
            m.set(d, o);
          }
          for (const f in v) o[f] += v[f];
        }
      }
    };
    for (const r of meta_daily) {
      const c = owner['Meta|' + r.cid];
      if (c) put(c, 'Meta', r.d, { imp: r.imp, clk: r.lc, spend: r.spend, conv: r.leads + r.calls + r.msgs, lpv: r.lpv, vv: r.vv, tp: r.tp, pe: r.pe, leads: r.leads, calls: r.calls, msgs: r.msgs });
    }
    for (const r of google_daily) {
      const c = owner['Google Ads|' + r.cid];
      if (c) put(c, 'Google Ads', r.d, { imp: r.imp, clk: r.clk, spend: r.cost, conv: r.conv });
    }
    for (const r of tiktok_daily) {
      const c = owner['TikTok|' + r.cid];
      if (c) put(c, 'TikTok', r.d, { imp: r.imp, clk: r.clk, spend: r.spend, plays: r.plays, p100: r.p100 });
    }
    for (const r of programmatic_daily) {
      const c = owner['Programmatic|' + r.cid];
      if (c) put(c, 'Programmatic', r.d, { imp: r.imp, clk: r.clk, spend: r.spend, plays: r.vs, p100: r.v100, pconv: r.conv });
    }
    const sum = (m, a, b) => {
      const o = {};
      for (const f of F) o[f] = 0;
      for (const [d, v] of m) if (d >= a && d <= b) for (const f of F) o[f] += v[f];
      return o;
    };
    const ratio = (a, b) => (b ? a / b : null);
    const change = (a, b) => (b ? (a - b) / b : null);
    const rows = [];
    for (const p of periods) {
      const allImp = {};
      const part = [];
      for (const [key, m] of series) {
        const [client, platform] = key.split('|');
        const cur = sum(m, p.start, p.end);
        const prev = sum(m, p.prev_start, p.prev_end);
        if (!cur.imp && !cur.spend && !prev.imp && !prev.spend) continue;
        if (platform === 'All') allImp[client] = cur.imp;
        part.push({ client, platform, cur, prev });
      }
      for (const { client, platform, cur, prev } of part) {
        const row = { k: p.period + '|' + client + '|' + platform, period: p.period, client, platform };
        for (const f of F) row[f] = f === 'spend' ? Math.round(cur[f] * 100) / 100 : Math.round(cur[f] * 100) / 100;
        row.ctr = ratio(cur.clk, cur.imp);
        row.cpc = ratio(cur.spend, cur.clk);
        row.cpa = ratio(cur.spend, cur.conv);
        row.share_imp = ratio(cur.imp, allImp[client] || 0);
        row.p_imp = prev.imp;
        row.p_clk = prev.clk;
        row.p_spend = Math.round(prev.spend * 100) / 100;
        row.p_conv = Math.round(prev.conv * 100) / 100;
        row.d_imp = change(cur.imp, prev.imp);
        row.d_clk = change(cur.clk, prev.clk);
        row.d_spend = change(cur.spend, prev.spend);
        row.d_conv = change(cur.conv, prev.conv);
        row.d_ctr = cur.imp && prev.imp && prev.clk ? change(cur.clk / cur.imp, prev.clk / prev.imp) : null;
        rows.push(row);
      }
    }
    return rows;
  },
});

dash.calc('daily', {
  title: 'Daily delivery by client and platform',
  description: 'Impressions, clicks, spend and conversions per day for each client and platform, with every client added together as All clients.',
  inputs: ['campaigns', 'meta_daily', 'google_daily', 'tiktok_daily', 'programmatic_daily'],
  fn: (campaigns, meta_daily, google_daily, tiktok_daily, programmatic_daily) => {
    const owner = {};
    for (const c of campaigns) owner[c.platform + '|' + c.campaign_id] = c.client;
    const acc = new Map();
    const put = (client, platform, d, imp, clk, spend, conv) => {
      for (const c of [client, 'All clients']) {
        const key = c + '|' + platform + '|' + d;
        let o = acc.get(key);
        if (!o) acc.set(key, (o = { client: c, platform, d, imp: 0, clk: 0, spend: 0, conv: 0 }));
        o.imp += imp;
        o.clk += clk;
        o.spend += spend;
        o.conv += conv;
      }
    };
    for (const r of meta_daily) {
      const c = owner['Meta|' + r.cid];
      if (c) put(c, 'Meta', r.d, r.imp, r.lc, r.spend, r.leads + r.calls + r.msgs);
    }
    for (const r of google_daily) {
      const c = owner['Google Ads|' + r.cid];
      if (c) put(c, 'Google Ads', r.d, r.imp, r.clk, r.cost, r.conv);
    }
    for (const r of tiktok_daily) {
      const c = owner['TikTok|' + r.cid];
      if (c) put(c, 'TikTok', r.d, r.imp, r.clk, r.spend, 0);
    }
    for (const r of programmatic_daily) {
      const c = owner['Programmatic|' + r.cid];
      if (c) put(c, 'Programmatic', r.d, r.imp, r.clk, r.spend, 0);
    }
    return [...acc.values()].map((o) => ({ ...o, spend: Math.round(o.spend * 100) / 100, conv: Math.round(o.conv * 100) / 100 }));
  },
});

dash.calc('camps', {
  title: 'Campaign totals by period',
  description: 'Each campaign’s delivery summed over each period, with its client, platform and channel.',
  inputs: ['campaigns', 'meta_daily', 'google_daily', 'tiktok_daily', 'programmatic_daily', 'periods'],
  fn: (campaigns, meta_daily, google_daily, tiktok_daily, programmatic_daily, periods) => {
    const info = {};
    for (const c of campaigns) info[c.platform + '|' + c.campaign_id] = c;
    const F = ['imp', 'clk', 'spend', 'conv', 'lpv', 'vv', 'tp', 'leads', 'calls', 'msgs', 'plays', 'p100', 'pconv'];
    const days = new Map();
    const put = (key, d, v) => {
      if (!info[key]) return;
      let m = days.get(key);
      if (!m) days.set(key, (m = []));
      m.push([d, v]);
    };
    for (const r of meta_daily) put('Meta|' + r.cid, r.d, { imp: r.imp, clk: r.lc, spend: r.spend, conv: r.leads + r.calls + r.msgs, lpv: r.lpv, vv: r.vv, tp: r.tp, leads: r.leads, calls: r.calls, msgs: r.msgs });
    for (const r of google_daily) put('Google Ads|' + r.cid, r.d, { imp: r.imp, clk: r.clk, spend: r.cost, conv: r.conv });
    for (const r of tiktok_daily) put('TikTok|' + r.cid, r.d, { imp: r.imp, clk: r.clk, spend: r.spend, plays: r.plays, p100: r.p100 });
    for (const r of programmatic_daily) put('Programmatic|' + r.cid, r.d, { imp: r.imp, clk: r.clk, spend: r.spend, plays: r.vs, p100: r.v100, pconv: r.conv });
    const rows = [];
    for (const p of periods) {
      for (const [key, list] of days) {
        const o = {};
        for (const f of F) o[f] = 0;
        for (const [d, v] of list) if (d >= p.start && d <= p.end) for (const f in v) o[f] += v[f];
        if (!o.imp && !o.spend && !o.pconv) continue;
        const c = info[key];
        rows.push({
          k: p.period + '|' + key,
          period: p.period,
          client: c.client,
          platform: c.platform,
          campaign: c.campaign,
          channel: c.channel,
          imp: o.imp,
          clk: o.clk,
          ctr: o.imp ? o.clk / o.imp : null,
          spend: Math.round(o.spend * 100) / 100,
          cpc: o.clk ? o.spend / o.clk : null,
          conv: Math.round(o.conv * 100) / 100,
          cpa: o.conv ? o.spend / o.conv : null,
          lpv: o.lpv,
          vv: o.vv,
          tp: o.tp,
          leads: o.leads,
          calls: o.calls,
          msgs: o.msgs,
          plays: o.plays,
          p100: o.p100,
          pconv: Math.round(o.pconv * 100) / 100,
          vcr: o.plays ? o.p100 / o.plays : null,
          cpm: o.imp ? (o.spend / o.imp) * 1000 : null,
        });
      }
    }
    return rows;
  },
});

dash.calc('gtypes', {
  title: 'Campaign types and programmatic tactics',
  description: 'Google Ads delivery grouped by campaign type (Search, Display, YouTube, App) and programmatic delivery grouped by tactic (CTV, display, native, audio, DOOH), per client and period.',
  inputs: ['camps'],
  fn: (camps) => {
    const acc = new Map();
    for (const r of camps) {
      if (r.platform !== 'Google Ads' && r.platform !== 'Programmatic') continue;
      for (const client of [r.client, 'All clients']) {
        const k = r.period + '|' + client + '|' + r.platform + '|' + r.channel;
        let o = acc.get(k);
        if (!o) acc.set(k, (o = { k, period: r.period, client, platform: r.platform, channel: r.channel, campaigns: 0, imp: 0, clk: 0, spend: 0, conv: 0, pconv: 0, plays: 0, p100: 0 }));
        o.campaigns += 1;
        o.imp += r.imp;
        o.clk += r.clk;
        o.spend += r.spend;
        o.conv += r.conv;
        o.pconv += r.pconv || 0;
        o.plays += r.plays || 0;
        o.p100 += r.p100 || 0;
      }
    }
    return [...acc.values()].map((o) => ({
      ...o,
      vcr: o.plays ? o.p100 / o.plays : null,
      cpm: o.imp ? (o.spend / o.imp) * 1000 : null,
      spend: Math.round(o.spend * 100) / 100,
      conv: Math.round(o.conv * 100) / 100,
      ctr: o.imp ? o.clk / o.imp : null,
      cpc: o.clk ? o.spend / o.clk : null,
      cpa: o.conv ? o.spend / o.conv : null,
    }));
  },
});

dash.calc('audience', {
  title: 'Audience by age and gender',
  description: 'Impressions and clicks by age band and gender for each client, platform and period. Meta and TikTok report these by calendar month, so a period counts every month it touches.',
  inputs: ['campaigns', 'monthly', 'periods'],
  fn: (campaigns, monthly, periods) => {
    const owner = {};
    for (const c of campaigns) owner[c.platform + '|' + c.campaign_id] = c.client;
    const acc = new Map();
    for (const p of periods) {
      const m0 = p.start.slice(0, 7), m1 = p.end.slice(0, 7);
      for (const r of monthly) {
        if (r.kind !== 'age' && r.kind !== 'gender') continue;
        if (r.m < m0 || r.m > m1) continue;
        const client = owner[r.platform + '|' + r.cid];
        if (!client) continue;
        for (const c of [client, 'All clients']) {
          const k = [p.period, c, r.platform, r.kind, r.b].join('|');
          let o = acc.get(k);
          if (!o) acc.set(k, (o = { k, period: p.period, client: c, platform: r.platform, kind: r.kind, bucket: r.b, imp: 0, clk: 0, months: m0 === m1 ? m0 : m0 + ' to ' + m1 }));
          o.imp += r.imp;
          o.clk += r.clk;
        }
      }
    }
    const tot = new Map();
    for (const o of acc.values()) {
      const t = [o.period, o.client, o.platform, o.kind].join('|');
      tot.set(t, (tot.get(t) || 0) + o.imp);
    }
    return [...acc.values()].map((o) => ({ ...o, share: o.imp / (tot.get([o.period, o.client, o.platform, o.kind].join('|')) || 1), ctr: o.imp ? o.clk / o.imp : null }));
  },
});

dash.calc('video', {
  title: 'Video completion by platform',
  description: 'Video plays and views reaching 25%, 50%, 75% and 100% for each client, platform and period, by calendar month. Google Ads counts are YouTube impressions times Google’s quartile rates.',
  inputs: ['campaigns', 'monthly', 'periods'],
  fn: (campaigns, monthly, periods) => {
    const owner = {};
    for (const c of campaigns) owner[c.platform + '|' + c.campaign_id] = c.client;
    const acc = new Map();
    for (const p of periods) {
      const m0 = p.start.slice(0, 7), m1 = p.end.slice(0, 7);
      for (const r of monthly) {
        if (r.kind !== 'video' || r.m < m0 || r.m > m1) continue;
        const client = owner[r.platform + '|' + r.cid];
        if (!client) continue;
        for (const c of [client, 'All clients']) {
          for (const plat of [r.platform, 'All']) {
            const k = [p.period, c, plat].join('|');
            let o = acc.get(k);
            if (!o) acc.set(k, (o = { k, period: p.period, client: c, platform: plat, plays: 0, p25: 0, p50: 0, p75: 0, p100: 0, months: m0 === m1 ? m0 : m0 + ' to ' + m1 }));
            o.plays += r.plays;
            o.p25 += r.p25;
            o.p50 += r.p50;
            o.p75 += r.p75;
            o.p100 += r.p100;
          }
        }
      }
    }
    return [...acc.values()].filter((o) => o.plays > 0).map((o) => ({ ...o, r25: o.p25 / o.plays, r50: o.p50 / o.plays, r75: o.p75 / o.plays, r100: o.p100 / o.plays }));
  },
});

dash.calc('ttdeep', {
  title: 'TikTok reach, attention and engagement',
  description: 'For each client and period, from TikTok’s monthly reports: people reached and how often they saw the ads, how long people watched (2-second, 6-second and 15-second views, average watch time), engagement (likes, comments, shares, follows, profile visits), landing page views, and impressions by state and by device. Reach is unique within each campaign and month, so it is added up across campaigns and months.',
  inputs: ['campaigns', 'monthly', 'periods'],
  fn: (campaigns, monthly, periods) => {
    const owner = {};
    for (const c of campaigns) if (c.platform === 'TikTok') owner[c.campaign_id] = c.client;
    const F = ['imp', 'clk', 'reach', 'plays', 'v2', 'v6', 'ev6', 'ev15', 'wt', 'likes', 'cmts', 'shares', 'follows', 'pvis', 'eng', 'lpv'];
    const acc = new Map();
    for (const p of periods) {
      const m0 = p.start.slice(0, 7), m1 = p.end.slice(0, 7);
      const months = m0 === m1 ? m0 : m0 + ' to ' + m1;
      for (const r of monthly) {
        if (r.platform !== 'TikTok' || (r.kind !== 'ttx' && r.kind !== 'geo' && r.kind !== 'dev') || r.m < m0 || r.m > m1) continue;
        const client = owner[r.cid];
        if (!client) continue;
        for (const c of [client, 'All clients']) {
          const kind = r.kind === 'ttx' ? 'sum' : r.kind;
          const k = [p.period, c, kind, r.b].join('|');
          let o = acc.get(k);
          if (!o) {
            o = { k, period: p.period, client: c, kind, bucket: r.b || '', months, imp: 0, clk: 0 };
            if (kind === 'sum') for (const f of F) o[f] = 0;
            acc.set(k, o);
          }
          if (kind === 'sum') for (const f of F) o[f] += r[f] || 0;
          else { o.imp += r.imp; o.clk += r.clk; }
        }
      }
    }
    const tot = new Map();
    for (const o of acc.values()) if (o.kind !== 'sum') tot.set([o.period, o.client, o.kind].join('|'), (tot.get([o.period, o.client, o.kind].join('|')) || 0) + o.imp);
    return [...acc.values()].map((o) => {
      const ctr = o.imp ? o.clk / o.imp : null;
      if (o.kind !== 'sum') return { ...o, ctr, share: o.imp / (tot.get([o.period, o.client, o.kind].join('|')) || 1) };
      return {
        ...o, ctr,
        freq: o.reach ? o.imp / o.reach : null,
        avgw: o.plays ? o.wt / o.plays : null,
        r2: o.plays ? o.v2 / o.plays : null,
        r6: o.plays ? o.v6 / o.plays : null,
        r15: o.plays ? o.ev15 / o.plays : null,
        er: o.imp ? o.eng / o.imp : null,
        lpr: o.clk ? o.lpv / o.clk : null,
      };
    });
  },
});

dash.calc('pacing', {
  title: 'Budget pacing this month',
  description: 'Each campaign’s spend so far this month against its spend rate last month (spend per day it delivered, times the days in this month). The projection adds the last 7 days’ daily average for each day left.',
  inputs: ['campaigns', 'meta_daily', 'google_daily', 'tiktok_daily', 'programmatic_daily'],
  fn: (campaigns, meta_daily, google_daily, tiktok_daily, programmatic_daily) => {
    const info = {};
    for (const c of campaigns) info[c.platform + '|' + c.campaign_id] = c;
    const spend = new Map();
    let latest = '';
    const put = (key, d, v) => {
      if (!info[key]) return;
      if (d > latest) latest = d;
      let m = spend.get(key);
      if (!m) spend.set(key, (m = new Map()));
      m.set(d, (m.get(d) || 0) + v);
    };
    for (const r of meta_daily) put('Meta|' + r.cid, r.d, r.spend);
    for (const r of google_daily) put('Google Ads|' + r.cid, r.d, r.cost);
    for (const r of tiktok_daily) put('TikTok|' + r.cid, r.d, r.spend);
    for (const r of programmatic_daily) put('Programmatic|' + r.cid, r.d, r.spend);
    const end = new Date(latest + 'T00:00:00Z');
    const y = end.getUTCFullYear(), mo = end.getUTCMonth();
    const S = (d) => d.toISOString().slice(0, 10);
    const ms = S(new Date(Date.UTC(y, mo, 1)));
    const pms = S(new Date(Date.UTC(y, mo - 1, 1)));
    const pme = S(new Date(Date.UTC(y, mo, 0)));
    const dim = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    const elapsed = end.getUTCDate();
    const l7 = S(new Date(+end - 6 * 864e5));
    const groups = new Map();
    const add = (k, base, o) => {
      let g = groups.get(k);
      if (!g) groups.set(k, (g = { ...base, mtd: 0, last7: 0, prev: 0, prevDays: 0, active3: 0 }));
      g.mtd += o.mtd;
      g.last7 += o.last7;
      g.prev += o.prev;
      g.prevDays = Math.max(g.prevDays, o.prevDays);
      g.active3 += o.active3;
      g.parts = (g.parts || 0) + 1;
      g.prevRate = (g.prevRate || 0) + o.prevRate;
    };
    const l3 = S(new Date(+end - 2 * 864e5));
    for (const [key, m] of spend) {
      const c = info[key];
      const o = { mtd: 0, last7: 0, prev: 0, prevDays: 0, active3: 0 };
      for (const [d, v] of m) {
        if (d >= ms) o.mtd += v;
        if (d >= l7) o.last7 += v;
        if (d >= l3) o.active3 += v;
        if (d >= pms && d <= pme) {
          o.prev += v;
          if (v > 0) o.prevDays += 1;
        }
      }
      if (!o.mtd && !o.prev) continue;
      o.prevRate = o.prevDays ? o.prev / o.prevDays : 0;
      for (const client of [c.client, 'All clients']) {
        add('c|' + key + '|' + client, { level: 'campaign', client, platform: c.platform, name: c.campaign }, o);
        add('p|' + c.platform + '|' + client, { level: 'platform', client, platform: c.platform, name: c.platform }, o);
      }
    }
    const rows = [];
    for (const [k, g] of groups) {
      if (g.level === 'campaign' && g.client === 'All clients') continue;
      const baseline = g.prevRate * dim;
      const daily7 = g.last7 / Math.min(7, elapsed + (elapsed < 7 ? 7 - elapsed : 0));
      const projected = g.mtd + (g.active3 > 0 ? (g.last7 / 7) * (dim - elapsed) : 0);
      const spent = baseline ? g.mtd / baseline : null;
      const pace = baseline ? projected / baseline : null;
      let status = 'on pace';
      if (!baseline) status = 'new this month';
      else if (!g.active3) status = 'stopped';
      else if (pace < 0.9) status = 'under';
      else if (pace > 1.1) status = 'ahead';
      rows.push({
        k: k.slice(2),
        level: g.level,
        client: g.client,
        platform: g.platform,
        name: g.name,
        month_start: ms,
        through: latest,
        elapsed_share: elapsed / dim,
        spent_share: spent,
        projected_vs_last: pace == null ? null : pace - 1,
        daily_7d: Math.round((g.last7 / 7) * 100) / 100,
        mtd: Math.round(g.mtd * 100) / 100,
        status,
      });
    }
    return rows;
  },
});

dash.calc('insights', {
  title: 'Campaign story, highlights and things to improve',
  description: 'A short written summary of each client’s time frame, plus what went well and what to work on. Each client is compared with the period before and with market click-through benchmarks for each platform and tactic (Meta 1.71%, TikTok 0.84%, Google search 6.66%, YouTube 0.65%, programmatic display 0.10%, native 0.20%, CTV 0.03%). Lines about investment are left out when investment is hidden.',
  inputs: ['totals', 'camps', 'audience', 'video', 'pacing', 'gtypes', 'creatives', 'periods'],
  fn: (totals, camps, audience, video, pacing, gtypes, creatives, periods) => {
    const CR = new Map();
    for (const r of creatives) {
      const k = r.period + '|' + r.client + '|' + r.platform;
      if (!CR.has(k)) CR.set(k, []);
      CR.get(k).push(r);
    }
    const GT = new Map(gtypes.map((r) => [r.k, r]));
    // Market click-through benchmarks (industry averages, not PD's own clients)
    const BENCH = { Meta: 0.0171, TikTok: 0.0084, 'Google Ads|Search': 0.0666, 'Google Ads|YouTube': 0.0065, 'Programmatic|Display': 0.001, 'Programmatic|Native': 0.002, 'Programmatic|CTV': 0.0003 };
    const BNAME = { Meta: 'Meta', TikTok: 'TikTok', 'Google Ads|Search': 'Google search', 'Google Ads|YouTube': 'YouTube', 'Programmatic|Display': 'programmatic display', 'Programmatic|Native': 'native', 'Programmatic|CTV': 'CTV' };
    const T = new Map(totals.map((r) => [r.k, r]));
    const nf = (v) => Math.round(v).toLocaleString('en-US');
    const big = (v) => (v >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + ' million' : nf(v));
    const pc = (v, d = 2) => (v * 100).toFixed(d) + '%';
    const p0 = (v) => Math.round(Math.abs(v) * 100) + '%';
    const usd = (v) => '$' + (v >= 100 ? nf(v) : v.toFixed(2));
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = (s) => MON[+s.slice(5, 7) - 1] + ' ' + +s.slice(8, 10);
    const list = (a) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
    const up = (v) => (v >= 0 ? 'up ' : 'down ') + p0(v);
    const PL = ['Meta', 'Google Ads', 'TikTok', 'Programmatic'];
    const CLICKY = ['Meta', 'Google Ads', 'TikTok'];
    const ageName = (b) => b.replace('-', '–');
    const isAge = (b) => b !== 'Unknown';
    const genName = (b) => ({ Female: 'women', Male: 'men' }[b] || null);
    const byPC = new Map();
    for (const r of camps) {
      const k = r.period + '|' + r.client;
      if (!byPC.has(k)) byPC.set(k, []);
      byPC.get(k).push(r);
    }
    const aud = new Map();
    for (const r of audience) {
      const k = [r.period, r.client, r.platform, r.kind].join('|');
      if (!aud.has(k)) aud.set(k, []);
      aud.get(k).push(r);
    }
    const V = new Map(video.map((r) => [r.k, r]));
    const pace = new Map();
    for (const r of pacing) if (r.level === 'platform') pace.set(r.client + '|' + r.platform, r);
    const through = pacing.length ? pacing[0].through : null;
    const rows = [];
    for (const p of periods) {
      const clients = totals.filter((r) => r.period === p.period && r.platform === 'All' && r.imp > 0).map((r) => r.client);
      const isMonth = /^m\d/.test(p.period) || p.period === 'lastmonth';
      const FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      const prevName = isMonth ? FULL[+p.prev_start.slice(5, 7) - 1] + (p.prev_start.slice(0, 4) !== p.start.slice(0, 4) ? ' ' + p.prev_start.slice(0, 4) : '') : day(p.prev_start) + '–' + (p.prev_start.slice(0, 7) === p.prev_end.slice(0, 7) ? +p.prev_end.slice(8, 10) : day(p.prev_end));
      for (const client of clients) {
        const all = T.get(p.period + '|' + client + '|All');
        const pf = PL.map((pl) => T.get(p.period + '|' + client + '|' + pl)).filter((r) => r && r.imp > 0);
        const cs = (client === 'All clients' ? camps.filter((r) => r.period === p.period) : byPC.get(p.period + '|' + client) || []).filter((r) => r.imp > 0);
        const solo = client !== 'All clients';
        const good = [], fix = [];
        const S = [], Sns = [];
        let cmpSentence = null, cmpUp = null; // the vs-prior sentence, and a version that only mentions increases
        // ---- story ----
        const who = solo ? client : 'PD clients';
        const nC = cs.length;
        const s1 = `From ${day(p.start)} to ${day(p.end)}, ${who} ran ${nC} campaign${nC === 1 ? '' : 's'} on ${list(pf.map((r) => r.platform))}.`;
        S.push(s1);
        Sns.push(s1);
        if (all.p_imp > 0) {
          const t = `Compared with ${prevName}, impressions were ${up(all.d_imp)} and clicks ${all.d_clk == null ? 'new' : up(all.d_clk)}.`;
          const ups = [all.d_imp >= 0 && `impressions were ${up(all.d_imp)}`, all.d_clk != null && all.d_clk >= 0 && `clicks were ${up(all.d_clk)}`].filter(Boolean);
          cmpSentence = t;
          cmpUp = ups.length ? `Compared with ${prevName}, ${ups.join(' and ')}.` : '';
          S.push(t);
          Sns.push(t);
        } else {
          const t = `There was no paid delivery in ${prevName}, so this is a fresh start.`;
          S.push(t);
          Sns.push(t);
        }
        if (pf.length > 1) {
          const lead = pf.slice().sort((a, b) => b.imp - a.imp)[0];
          const best = pf.filter((r) => r.imp >= 1000 && r.platform !== 'Programmatic').sort((a, b) => (b.ctr || 0) - (a.ctr || 0))[0];
          let t = `${lead.platform} carried ${p0(lead.share_imp || 0)} of impressions`;
          t += best && best.platform !== lead.platform ? `, while ${best.platform} earned the best click-through rate (${pc(best.ctr)}).` : best ? ` and also earned the best click-through rate (${pc(best.ctr)}).` : '.';
          S.push(t);
          Sns.push(t);
        }
        if (all.conv >= 1 && all.cpa) S.push(`Each conversion cost about ${usd(all.cpa)}.`);
        const pg = pf.find((r) => r.platform === 'Programmatic');
        if (pg && pg.pconv >= 1) {
          const t = `Programmatic added ${nf(pg.pconv)} conversion${Math.round(pg.pconv) === 1 ? '' : 's'} as counted by the programmatic platform, which includes people who saw an ad and converted later.`;
          S.push(t);
          Sns.push(t);
        }
        const topC = cs.slice().sort((a, b) => b.clk - a.clk)[0];
        if (topC && nC > 1 && topC.clk > 0) {
          const t = `The “${topC.campaign}” campaign${solo || topC.campaign === topC.client ? '' : ' (' + topC.client + ')'} drove the most clicks: ${nf(topC.clk)} at ${pc(topC.ctr || 0)}.`;
          S.push(t);
          Sns.push(t);
        }
        const va = V.get(p.period + '|' + client + '|All');
        if (va && va.plays >= 1000) {
          const t = `Of ${big(va.plays)} video plays, ${p0(va.r25)} reached a quarter of the video and ${p0(va.r100)} played to the end.`;
          S.push(t);
          Sns.push(t);
        }
        // ---- click-through vs market benchmarks, and vs prior ----
        if (solo) {
          const cands = [];
          for (const pl of ['Meta', 'TikTok']) { const r = pf.find((x) => x.platform === pl); if (r) cands.push([pl, r]); }
          for (const ch of ['Search', 'YouTube']) { const r = GT.get(p.period + '|' + client + '|Google Ads|' + ch); if (r) cands.push(['Google Ads|' + ch, r]); }
          for (const [key, r] of cands) {
            const b = BENCH[key];
            if (!b || r.imp < 2000 || r.ctr == null) continue;
            const rel = r.ctr / b, nm = BNAME[key];
            if (rel >= 1.2) good.push({ s: Math.min(rel - 1, 3), t: `${nm} click-through rate of ${pc(r.ctr)} is ${p0(rel - 1)} above the ${pc(b)} market benchmark.` });
            else if (rel <= 0.8) fix.push({ s: 1 - rel, t: `${nm} click-through rate of ${pc(r.ctr)} is below the ${pc(b)} market benchmark. ${key.startsWith('Google Ads|Search') ? 'Tighter keywords and sharper ad copy are the usual first fix.' : 'Fresh creative or a clearer call to action is the usual first fix.'}` });
          }
        }
        for (const r of pf) {
          if (r.imp < 2000 || r.platform === 'Programmatic') continue;
          if (r.p_clk >= 50 && r.d_clk != null) {
            if (r.d_clk >= 0.2) good.push({ s: Math.min(r.d_clk, 2) * 0.8, t: `${r.platform} clicks grew ${p0(r.d_clk)} compared with ${prevName} (${nf(r.p_clk)} → ${nf(r.clk)}).` });
            else if (r.d_clk <= -0.2) fix.push({ s: -r.d_clk * 0.8, t: `${r.platform} clicks fell ${p0(r.d_clk)} compared with ${prevName} (${nf(r.p_clk)} → ${nf(r.clk)}).` + (r.d_spend != null && r.d_spend < -0.15 ? ' Investment was also lower, which explains part of the drop.' : '') , ns: r.d_spend != null && r.d_spend < -0.15 ? `${r.platform} clicks fell ${p0(r.d_clk)} compared with ${prevName} (${nf(r.p_clk)} → ${nf(r.clk)}).` : undefined });
          }
        }
        if (all.p_conv >= 5 && all.d_conv != null) {
          if (all.d_conv >= 0.2) good.push({ s: Math.min(all.d_conv, 2), t: `Conversions rose ${p0(all.d_conv)} (${nf(all.p_conv)} → ${nf(all.conv)}).` });
          else if (all.d_conv <= -0.2) fix.push({ s: -all.d_conv, t: `Conversions fell ${p0(all.d_conv)} (${nf(all.p_conv)} → ${nf(all.conv)}). Check that forms, call tracking and landing pages are working.` });
          if (all.cpa && all.p_spend && all.p_conv) {
            const pcpa = all.p_spend / all.p_conv;
            const ch = all.cpa / pcpa - 1;
            if (ch <= -0.15) good.push({ s: -ch, t: `Cost per conversion improved to ${usd(all.cpa)} from ${usd(pcpa)}.`, ns: null });
            else if (ch >= 0.2) fix.push({ s: ch * 0.8, t: `Cost per conversion rose to ${usd(all.cpa)} from ${usd(pcpa)}.`, ns: null });
          }
        }
        // ---- across clients (All clients view) ----
        if (!solo) {
          const cl = [
            ...totals.filter((r) => r.period === p.period && r.client !== 'All clients' && (r.platform === 'Meta' || r.platform === 'TikTok') && r.imp >= 5000 && r.ctr != null).map((r) => [r.platform, r]),
            ...gtypes.filter((r) => r.period === p.period && r.client !== 'All clients' && r.platform === 'Google Ads' && (r.channel === 'Search' || r.channel === 'YouTube') && r.imp >= 5000 && r.ctr != null).map((r) => ['Google Ads|' + r.channel, r]),
          ];
          const rel = cl.map(([key, r]) => ({ r, key, b: BENCH[key], v: r.ctr / BENCH[key] }));
          rel.sort((a, b) => b.v - a.v);
          for (const x of rel.slice(0, 2)) if (x.v >= 1.3) good.push({ s: Math.min(x.v - 1, 3), t: `${x.r.client} leads on ${BNAME[x.key]}: ${pc(x.r.ctr)} click-through rate against the ${pc(x.b)} market benchmark.` });
          for (const x of rel.slice(-2).reverse()) if (x.v <= 0.6) fix.push({ s: 1 - x.v, t: `${x.r.client} trails on ${BNAME[x.key]}: ${pc(x.r.ctr)} click-through rate against the ${pc(x.b)} market benchmark.` });
          const mv = totals.filter((r) => r.period === p.period && r.client !== 'All clients' && r.platform === 'All' && r.p_clk >= 100 && r.d_clk != null).sort((a, b) => b.d_clk - a.d_clk);
          const g0 = mv[0], f0 = mv[mv.length - 1];
          if (g0 && g0.d_clk >= 0.25) good.push({ s: Math.min(g0.d_clk, 2) * 0.7, t: `${g0.client} grew clicks the most: up ${p0(g0.d_clk)} compared with ${prevName} (${nf(g0.p_clk)} → ${nf(g0.clk)}).` });
          if (f0 && f0 !== g0 && f0.d_clk <= -0.25) fix.push({ s: -f0.d_clk * 0.7, t: `${f0.client} lost the most clicks: down ${p0(f0.d_clk)} compared with ${prevName} (${nf(f0.p_clk)} → ${nf(f0.clk)}).` });
          const stopped = pacing.filter((r) => r.level === 'platform' && r.client !== 'All clients' && r.status === 'stopped');
          if (through && p.end === through && stopped.length)
            fix.push({ s: 0.5, t: `No spend in the last three days: ${list(stopped.slice(0, 6).map((r) => r.client + ' (' + r.platform + ')'))}${stopped.length > 6 ? ' and ' + (stopped.length - 6) + ' more' : ''}. Confirm these pauses are planned.` });
        }
        // ---- programmatic tactics vs market benchmarks ----
        if (solo) {
          for (const tac of ['Display', 'Native', 'CTV']) {
            const r = GT.get(p.period + '|' + client + '|Programmatic|' + tac);
            const b = BENCH['Programmatic|' + tac];
            if (!r || r.imp < 10000 || r.ctr == null) continue;
            const rel = r.ctr / b, nm = tac === 'CTV' ? 'CTV' : tac.toLowerCase();
            if (rel >= 1.3) good.push({ s: Math.min(rel - 1, 3) * 0.9, t: `Programmatic ${nm} clicks at ${pc(r.ctr, tac === 'CTV' ? 3 : 2)}, ${p0(rel - 1)} above the ${pc(b, tac === 'CTV' ? 3 : 2)} market benchmark for ${nm}.` });
            else if (rel <= 0.7 && tac !== 'CTV') fix.push({ s: (1 - rel) * 0.9, t: `Programmatic ${nm} clicks at ${pc(r.ctr)}, below the ${pc(b)} market benchmark for ${nm}. New banner sizes or a stronger offer usually help.` });
          }
          const ctv = GT.get(p.period + '|' + client + '|Programmatic|CTV');
          if (ctv && ctv.plays >= 5000 && ctv.vcr >= 0.95)
            good.push({ s: 0.3, t: `${p0(ctv.vcr)} of CTV ads played to the end across ${nf(ctv.imp)} impressions.` });
        }
        // ---- creatives (ads) within the client ----
        if (solo) {
          for (const pl of ['Meta', 'TikTok', 'Programmatic']) {
            const list3 = (CR.get(p.period + '|' + client + '|' + pl) || []).filter((r) => r.platform !== 'Programmatic' || r.channel === 'Display' || r.channel === 'Native');
            const tot = list3.reduce((a, r) => a + r.imp, 0);
            const ok = list3.filter((r) => r.imp >= Math.max(1000, tot * 0.05));
            if (ok.length < 2) continue;
            const by = ok.slice().sort((a, b) => b.ctr - a.ctr);
            const hi = by[0], lo = by[by.length - 1];
            const avg = list3.reduce((a, r) => a + r.clk, 0) / tot;
            if (hi.ctr >= avg * 1.3) good.push({ s: Math.min(hi.ctr / avg - 1, 3) * 0.9, t: `Best ${pl} creative: “${hi.name}” clicks at ${pc(hi.ctr)}, against ${pc(avg)} for all of this client’s ${pl} ads.` });
            if (lo !== hi && lo.ctr <= avg * 0.6 && lo.imp >= tot * 0.1) fix.push({ s: (1 - lo.ctr / avg) * 0.9, t: `${pl} creative “${lo.name}” took ${p0(lo.imp / tot)} of impressions but clicks at only ${pc(lo.ctr)}. Pausing it or shifting budget to “${hi.name}” should lift results.` });
          }
        }
        // ---- campaigns within the client ----
        if (solo) {
          for (const pl of CLICKY) {
            const pr = pf.find((r) => r.platform === pl);
            if (!pr || !pr.ctr) continue;
            const list2 = cs.filter((c) => c.platform === pl && c.imp >= Math.max(2000, pr.imp * 0.1));
            if (list2.length < 2) continue;
            const sorted = list2.slice().sort((a, b) => b.ctr - a.ctr);
            const hi = sorted[0], lo = sorted[sorted.length - 1];
            if (hi.ctr / pr.ctr >= 1.3) good.push({ s: hi.ctr / pr.ctr - 1, t: `${hi.campaign} is the standout on ${pl}, with a ${pc(hi.ctr)} click-through rate against ${pc(pr.ctr)} for ${pl} overall.` });
            if (lo.ctr / pr.ctr <= 0.6) fix.push({ s: 1 - lo.ctr / pr.ctr, t: `${lo.campaign} clicks at ${pc(lo.ctr)}, well under the ${pc(pr.ctr)} ${pl} average for this client. Consider refreshing it or moving budget to ${hi.campaign}.` });
          }
          for (const c of cs) {
            if (c.platform === 'Google Ads' && c.channel === 'Search' && c.clk >= 60 && !c.conv)
              fix.push({ s: 0.7, t: `${c.campaign} drew ${nf(c.clk)} search clicks but no recorded conversions. Worth checking conversion tracking and the landing page.` });
          }
        }
        // ---- audience ----
        if (solo) {
          for (const pl of ['Meta', 'TikTok']) {
            const ag = (aud.get([p.period, client, pl, 'age'].join('|')) || []).filter((r) => isAge(r.bucket));
            const tot = ag.reduce((a, r) => a + r.imp, 0);
            if (tot < 5000 || ag.length < 3) continue;
            const top = ag.slice().sort((a, b) => b.imp - a.imp)[0];
            const eligible = ag.filter((r) => r.imp / tot >= 0.08 && r.ctr != null);
            const best = eligible.sort((a, b) => b.ctr - a.ctr)[0];
            const pr = pf.find((r) => r.platform === pl);
            if (best && best.bucket !== top.bucket && top.ctr && best.ctr / top.ctr >= 1.3)
              fix.push({ s: 0.5, t: `On ${pl}, ${ageName(top.bucket)} gets the most impressions (${p0(top.imp / tot)}), but ${ageName(best.bucket)} clicks more often (${pc(best.ctr)} vs ${pc(top.ctr)}). Shifting more budget toward ${ageName(best.bucket)} could lift results.` });
            else if (best && best.bucket === top.bucket)
              good.push({ s: 0.4, t: `On ${pl}, delivery is concentrated where it works: ${ageName(top.bucket)} receives the most impressions (${p0(top.imp / tot)}) and has the best click-through rate (${pc(top.ctr)}).` });
            const gd = (aud.get([p.period, client, pl, 'gender'].join('|')) || []).filter((r) => genName(r.bucket));
            const gt = gd.reduce((a, r) => a + r.imp, 0);
            if (gt > 5000 && gd.length === 2) {
              const [a, b] = gd.slice().sort((x, y) => y.imp - x.imp);
              if (a.imp / gt >= 0.6 && b.ctr && a.ctr && b.ctr / a.ctr >= 1.3)
                fix.push({ s: 0.35, t: `${pl} shows ${p0(a.imp / gt)} of impressions to ${genName(a.bucket)}, yet ${genName(b.bucket)} click more (${pc(b.ctr)} vs ${pc(a.ctr)}).` });
            }
          }
        }
        // ---- pacing (only when the time frame runs to the latest day) ----
        if (through && p.end === through && p.start.slice(0, 7) === through.slice(0, 7)) {
          for (const pl of PL) {
            const r = pace.get(client + '|' + pl);
            if (!r || !solo || !pf.some((x) => x.platform === pl)) continue;
            if (r.status === 'stopped') fix.push({ s: 0.9, t: `${pl} has not spent in the last three days. Confirm whether that is planned.` });
            else if (r.status === 'under') fix.push({ s: 0.6, t: `${pl} is on track to spend ${p0(r.projected_vs_last)} less this month than last month’s rate.` });
            else if (r.status === 'ahead') fix.push({ s: 0.4, t: `${pl} is on track to spend ${p0(r.projected_vs_last)} more this month than last month’s rate. Check that the budget allows it.` });
          }
        }
        const base = p.period + '|' + client;
        const upOnly = (arr) => arr.map((x) => (x === cmpSentence ? cmpUp : x)).filter(Boolean).join(' ');
        rows.push({ k: base + '|story', period: p.period, client, type: 'story', n: 0, text: S.join(' '), text_ns: Sns.join(' '), text_up: upOnly(S), text_ns_up: upOnly(Sns) });
        const emit = (arr, type) =>
          arr.sort((a, b) => b.s - a.s).slice(0, 5).forEach((x, i) =>
            rows.push({ k: base + '|' + type + i, period: p.period, client, type, n: i + 1, text: x.t, text_ns: x.ns === undefined ? x.t : x.ns }));
        emit(good, 'good');
        emit(fix, 'improve');
      }
    }
    return rows;
  },
});

dash.calc('ga4', {
  title: 'Website analytics by client and period',
  description: 'Google Analytics 4 sessions, engaged sessions, users, page views and key events for each client and period, with the period before, plus sessions by channel. Only clients whose GA4 property is linked in the PD warehouse appear.',
  inputs: ['ga4_daily', 'periods'],
  fn: (ga4_daily, periods) => {
    const rows = [];
    const F = ['s', 'es', 'u', 'nu', 'pv', 'ke'];
    const clients = [...new Set(ga4_daily.map((r) => r.client))];
    for (const p of periods) {
      for (const client of clients) {
        const cur = {}, prev = {};
        for (const f of F) cur[f] = prev[f] = 0;
        const ch = new Map();
        for (const r of ga4_daily) {
          if (r.client !== client) continue;
          const inCur = r.d >= p.start && r.d <= p.end;
          const inPrev = r.d >= p.prev_start && r.d <= p.prev_end;
          if (r.kind === 'total') {
            if (inCur) for (const f of F) cur[f] += r[f];
            if (inPrev) for (const f of F) prev[f] += r[f];
          } else if (inCur) {
            let o = ch.get(r.ch);
            if (!o) ch.set(r.ch, (o = { s: 0, es: 0, ke: 0 }));
            o.s += r.s;
            o.es += r.es;
            o.ke += r.ke;
          }
        }
        if (!cur.s && !prev.s) continue;
        const chg = (a, b) => (b ? (a - b) / b : null);
        rows.push({ k: p.period + '|' + client + '|total', period: p.period, client, kind: 'total', channel: '', sessions: cur.s, engaged: cur.es, engagement_rate: cur.s ? cur.es / cur.s : null, users: cur.u, new_users: cur.nu, page_views: cur.pv, key_events: cur.ke, p_sessions: prev.s, d_sessions: chg(cur.s, prev.s), d_engaged: chg(cur.es, prev.es), d_key_events: chg(cur.ke, prev.ke) });
        for (const [name, o] of ch)
          rows.push({ k: p.period + '|' + client + '|' + name, period: p.period, client, kind: 'channel', channel: name, sessions: o.s, engaged: o.es, engagement_rate: o.s ? o.es / o.s : null, key_events: o.ke, share: cur.s ? o.s / cur.s : null });
      }
    }
    return rows;
  },
});

dash.calc('creatives', {
  title: 'Creative (ad) performance',
  description: 'Each Meta, TikTok and programmatic creative’s delivery for each client and period. The platforms report ads by calendar month, so a time frame counts every month it touches.',
  inputs: ['campaigns', 'ads_monthly', 'periods'],
  fn: (campaigns, ads_monthly, periods) => {
    const info = {};
    for (const c of campaigns) info[c.platform + '|' + c.campaign_id] = c;
    const rows = [];
    for (const p of periods) {
      const m0 = p.start.slice(0, 7), m1 = p.end.slice(0, 7);
      const acc = new Map();
      for (const r of ads_monthly) {
        if (r.m < m0 || r.m > m1) continue;
        const prog = r.platform === 'Programmatic';
        const c = prog ? { client: r.client, campaign: r.tactic } : info[r.platform + '|' + r.cid];
        if (!c) continue;
        const k = p.period + '|' + r.platform + '|' + r.ad;
        let o = acc.get(k);
        if (!o) acc.set(k, (o = { k, period: p.period, client: c.client, platform: r.platform, campaign: c.campaign, channel: prog ? r.tactic : '', size: r.size || '', name: r.name, imp: 0, clk: 0, spend: 0, lpv: 0, res: 0, tp: 0, plays: 0, p25: 0, p100: 0, pconv: 0, months: m0 === m1 ? m0 : m0 + ' to ' + m1 }));
        o.pconv += r.conv || 0;
        o.imp += r.imp;
        o.clk += r.clk;
        o.spend += r.spend;
        o.lpv += r.lpv || 0;
        o.res += r.res || 0;
        o.tp += r.tp || 0;
        o.plays += r.platform === 'TikTok' ? r.plays : r.vv || 0;
        o.p25 += r.p25 || 0;
        o.p100 += r.p100 || 0;
      }
      for (const o of acc.values()) {
        if (!o.imp) continue;
        rows.push({ ...o, spend: Math.round(o.spend * 100) / 100, ctr: o.clk / o.imp, cpc: o.clk ? o.spend / o.clk : null, vcr: o.platform === 'TikTok' && o.plays ? o.p100 / o.plays : o.platform === 'Programmatic' && (o.channel === 'CTV' || o.channel === 'Audio') && o.p100 ? o.p100 / o.imp : null, cpc: o.platform === 'Programmatic' ? null : o.clk ? o.spend / o.clk : null, hook: o.platform === 'Meta' ? o.plays / o.imp : null });
      }
    }
    return rows;
  },
});

dash.calc('psizes', {
  title: 'Programmatic results by ad size',
  description: 'Programmatic display and native impressions, clicks and click-through rate grouped by creative size (for example 300x250), per client, tactic and period.',
  inputs: ['creatives'],
  fn: (creatives) => {
    const acc = new Map();
    for (const r of creatives) {
      if (r.platform !== 'Programmatic' || !r.size || r.channel === 'CTV') continue;
      for (const client of [r.client, 'All clients']) {
        const k = [r.period, client, r.channel, r.size].join('|');
        let o = acc.get(k);
        if (!o) acc.set(k, (o = { k, period: r.period, client, channel: r.channel, size: r.size, creatives: 0, imp: 0, clk: 0, pconv: 0 }));
        o.creatives += 1;
        o.imp += r.imp;
        o.clk += r.clk;
        o.pconv += r.pconv;
      }
    }
    return [...acc.values()].map((o) => ({ ...o, ctr: o.imp ? o.clk / o.imp : null }));
  },
});

dash.calc('ctvmix', {
  title: 'CTV networks, household income and conversion definitions',
  description: 'CTV impressions, clicks and conversions by streaming network and by household income for each client and period (plus the full list of every named network, variants merged), from the programmatic platform by calendar month (a time frame counts every month it touches). Also lists what Primary, Secondary and Tertiary conversions meant for each client’s programmatic journeys (all tactics) in the period, with how many of each happened under each definition (date-aware, from daily programmatic rows), and a per-client total split by type and by click vs view-through.',
  inputs: ['campaigns', 'monthly', 'programmatic_daily', 'periods'],
  fn: (campaigns, monthly, programmatic_daily, periods) => {
    const info = {};
    for (const c of campaigns) if (c.platform === 'Programmatic') info[c.campaign_id] = c;
    const journey = {};
    const cfgs = [];
    for (const r of monthly) {
      if (r.kind === 'journey') journey[r.cid] = { id: r.b, name: r.name };
      if (r.kind === 'convcfg') cfgs.push(r);
    }
    const rows = [];
    for (const p of periods) {
      const m0 = p.start.slice(0, 7), m1 = p.end.slice(0, 7);
      const acc = new Map();
      const used = new Map(); // client -> Set(journey id)
      for (const r of monthly) {
        if ((r.kind !== 'ctvnet' && r.kind !== 'hhi') || r.m < m0 || r.m > m1) continue;
        const c = info[r.cid];
        if (!c) continue;
        if (c.channel !== 'CTV') continue;
        for (const client of [c.client, 'All clients']) {
          const k = [p.period, client, r.kind, r.b].join('|');
          let o = acc.get(k);
          if (!o) acc.set(k, (o = { k, period: p.period, client, kind: r.kind === 'ctvnet' ? 'net' : 'hhi', name: r.b, imp: 0, clk: 0, conv: 0, p1: 0, p2: 0, p3: 0, months: m0 === m1 ? m0 : m0 + ' to ' + m1 }));
          o.imp += r.imp;
          o.clk += r.clk;
          o.conv += r.conv || 0;
          o.p1 += r.p1 || 0;
          o.p2 += r.p2 || 0;
          o.p3 += r.p3 || 0;
        }
      }
      // full network list (every named network the CTV ads ran on, variants merged)
      const full = new Map(); // client -> Map(name -> [imp, clk, conv])
      for (const r of monthly) {
        if (r.kind !== 'ctvall' || r.m < m0 || r.m > m1) continue;
        const c = info[r.cid];
        if (!c || c.channel !== 'CTV') continue;
        for (const client of [c.client, 'All clients']) {
          if (!full.has(client)) full.set(client, new Map());
          const f = full.get(client);
          r.n.forEach((name, i) => {
            const a = f.get(name) || [0, 0, 0];
            a[0] += r.v[i]; a[1] += r.c[i]; a[2] += r.cv[i];
            f.set(name, a);
          });
        }
      }
      for (const [client, f] of full) {
        const list = [...f.entries()].sort((a, b) => b[1][0] - a[1][0]).map(([name, a]) => [name, a[0], a[1], Math.round(a[2] * 100) / 100]);
        rows.push({ k: [p.period, client, 'netall'].join('|'), period: p.period, client, kind: 'netall', name: '', count: list.length, list });
      }
      const tot = new Map();
      for (const o of acc.values()) {
        const t = o.client + '|' + o.kind;
        tot.set(t, (tot.get(t) || 0) + o.imp);
      }
      for (const o of acc.values()) rows.push({ ...o, share: o.imp / (tot.get(o.client + '|' + o.kind) || 1), ctr: o.imp ? o.clk / o.imp : null });
      // conversions by journey and by the definition in force on each day (date-aware), from the daily programmatic rows
      const cnt = new Map(); // client|journey|cfg start ('' = no definition) -> counts
      const sum = new Map(); // client -> totals
      const z = () => ({ n: 0, n1: 0, n2: 0, n3: 0, cc: 0, av: 0, imp: 0 });
      const add = (o, r) => {
        o.n += r.conv || 0; o.n1 += r.pconv || 0; o.n2 += r.p2 || 0; o.n3 += r.p3 || 0; o.cc += r.cc || 0; o.av += r.av || 0; o.imp += r.imp || 0;
      };
      for (const r of programmatic_daily) {
        if (r.d < p.start || r.d > p.end) continue;
        const c = info[r.cid];
        if (!c) continue;
        for (const client of [c.client, 'All clients']) {
          if (!sum.has(client)) sum.set(client, { ...z(), split: r.p2 != null });
          add(sum.get(client), r);
        }
        const j = journey[r.cid];
        if (!j) continue;
        if (!used.has(c.client)) used.set(c.client, new Map());
        used.get(c.client).set(j.id, j.name);
        const cf = cfgs.find((x) => x.b === j.id && x.s <= r.d && (!x.e || r.d <= x.e));
        const k = [c.client, j.id, cf ? cf.s : ''].join('|');
        if (!cnt.has(k)) cnt.set(k, z());
        add(cnt.get(k), r);
      }
      for (const [client, o] of sum) rows.push({ k: [p.period, client, 'convsum'].join('|'), period: p.period, client, kind: 'convsum', ...o });
      for (const [client, js] of used) {
        for (const [jid, jname] of js) {
          for (const c of cfgs) {
            if (c.b !== jid || c.s > p.end || (c.e && c.e < p.start)) continue;
            rows.push({ k: [p.period, client, 'def', jid, c.s].join('|'), period: p.period, client, kind: 'def', name: jname, journey: jid, start: c.s, end: c.e || '', status: c.st, l1: c.l1, l2: c.l2, l3: c.l3, notes: c.notes || '', ...(cnt.get([client, jid, c.s].join('|')) || z()) });
          }
          const none = cnt.get([client, jid, ''].join('|'));
          const hasCfg = cfgs.some((c) => c.b === jid);
          if (!hasCfg || (none && none.n >= 0.5)) rows.push({ k: [p.period, client, 'def', jid, ''].join('|'), period: p.period, client, kind: 'def', name: jname, journey: jid, start: '', end: '', status: hasCfg ? 'GAP' : 'NONE', l1: '', l2: '', l3: '', notes: '', ...(none || z()) });
        }
      }
    }
    return rows;
  },
});

dash.calc('tacperf', {
  title: 'Performance vs. market, by platform and tactic',
  description: 'For each client, time frame and section (Meta, TikTok, each Google Ads campaign type, each programmatic tactic): delivery, click-through rate against the market benchmark (Meta 1.71%, TikTok 0.84%, Google search 6.66%, YouTube 0.65% from WordStream; programmatic display 0.10%, native 0.20%, CTV 0.03% from Focus Digital / Gourmet Ads), video completion for CTV against the ~92% industry average (AdWave) and audio listen-through against ~94% (Next Broadcast Media), and the change against the period before. Each note is tagged good, neutral or flag; flags are shown on the live dashboard only.',
  inputs: ['campaigns', 'meta_daily', 'google_daily', 'tiktok_daily', 'programmatic_daily', 'periods'],
  fn: (campaigns, meta_daily, google_daily, tiktok_daily, programmatic_daily, periods) => {
    const info = {};
    for (const c of campaigns) info[c.platform + '|' + c.campaign_id] = c;
    const BENCH = { Meta: [0.0171, 'Meta'], TikTok: [0.0084, 'TikTok'], 'Google Ads|Search': [0.0666, 'Google search'], 'Google Ads|YouTube': [0.0065, 'YouTube'],
      'Programmatic|Display': [0.001, 'programmatic display'], 'Programmatic|Native': [0.002, 'native'], 'Programmatic|CTV': [0.0003, 'CTV'] };
    const VCR = { 'Programmatic|CTV': [0.92, 'CTV industry average of about 92%', 'completed views'], 'Programmatic|Audio': [0.94, 'streaming audio industry average of about 94%', 'completed listens'] };
    const MIN = { Meta: 2000, TikTok: 2000, 'Google Ads|Search': 500, 'Google Ads|YouTube': 2000, 'Programmatic|Display': 10000, 'Programmatic|Native': 10000, 'Programmatic|CTV': 5000 };
    const TIP = {
      Meta: 'Refresh the creative and test new opening lines; check how often the same people see the ads.',
      TikTok: 'Test native-style videos with a hook in the first two seconds and rotate creative more often.',
      'Google Ads|Search': 'Review search terms, add negative keywords and tighten the ad copy to the keywords.',
      'Google Ads|YouTube': 'Test shorter cuts with a clear call to action and review where the ads ran.',
      'Programmatic|Display': 'Review site and app placements, refresh the banners and drop sizes that lag.',
      'Programmatic|Native': 'Test new headlines and images and review publisher placements.',
      'Programmatic|CTV': 'Check ad length and favor premium, non-skippable TV inventory.',
      'Programmatic|Audio': 'Check ad length and placement mix.',
    };
    const LABEL = { Meta: 'Meta Ads', TikTok: 'TikTok', Programmatic: 'Programmatic' };
    const series = new Map(); // key|client -> [[d, vals]]
    const put = (platform, cid, d, v) => {
      const c = info[platform + '|' + cid];
      if (!c) return;
      const key = platform === 'Meta' || platform === 'TikTok' ? platform : platform + '|' + (c.channel || 'Other');
      for (const client of [c.client, 'All clients']) {
        const k = key + '¦' + client;
        if (!series.has(k)) series.set(k, []);
        series.get(k).push([d, v, c.campaign]);
      }
    };
    for (const r of meta_daily) put('Meta', r.cid, r.d, { imp: r.imp, clk: r.lc, conv: (r.leads || 0) + (r.calls || 0) + (r.msgs || 0) });
    for (const r of google_daily) put('Google Ads', r.cid, r.d, { imp: r.imp, clk: r.clk, conv: r.conv || 0 });
    for (const r of tiktok_daily) put('TikTok', r.cid, r.d, { imp: r.imp, clk: r.clk, conv: 0 });
    for (const r of programmatic_daily) put('Programmatic', r.cid, r.d, { imp: r.imp, clk: r.clk, conv: r.conv || 0, vs: r.vs || 0, v100: r.v100 || 0 });
    const nf = (v) => Math.round(v).toLocaleString('en-US');
    const pc = (v, b) => (v * 100).toFixed(b < 0.001 ? 3 : 2) + '%';
    const p0 = (v) => Math.round(v * 100) + '%';
    const rows = [];
    for (const p of periods) {
      for (const [k, list] of series) {
        const [key, client] = k.split('¦');
        const z = () => ({ imp: 0, clk: 0, conv: 0, vs: 0, v100: 0 });
        const cur = z(), prev = z();
        const camp = new Map();
        for (const [d, v, name] of list) {
          const t = d >= p.start && d <= p.end ? cur : d >= p.prev_start && d <= p.prev_end ? prev : null;
          if (!t) continue;
          for (const f in v) t[f] += v[f] || 0;
          if (t === cur) {
            const o = camp.get(name) || { imp: 0, clk: 0 };
            o.imp += v.imp || 0; o.clk += v.clk || 0;
            camp.set(name, o);
          }
        }
        if (cur.imp < 1) continue;
        const [platform, channel] = key.includes('|') ? key.split('|') : [key, ''];
        const ctr = cur.clk / cur.imp, pctr = prev.imp ? prev.clk / prev.imp : null;
        const vcr = cur.vs >= 1000 ? cur.v100 / cur.vs : null;
        const notes = [];
        const live = [...camp.values()].filter((o) => o.imp > 0).length;
        notes.push({ tone: 'neutral', text: `${nf(cur.imp)} impressions${channel === 'CTV' ? ' on TV screens' : ''}${cur.clk >= 1 && channel !== 'CTV' && channel !== 'Audio' && channel !== 'DOOH' ? ` and ${nf(cur.clk)} clicks` : ''} from ${live} campaign${live === 1 ? '' : 's'}.` });
        const B = BENCH[key];
        if (B && cur.imp >= (MIN[key] || 2000)) {
          const [b, nm] = B, rel = ctr / b;
          if (rel >= 1.1) notes.push({ tone: 'good', text: `Click-through rate of ${pc(ctr, b)} is ${rel >= 2 ? rel.toFixed(1) + '×' : Math.round((rel - 1) * 100) + '% above'} the ${nm} market benchmark (${pc(b, b)}).` });
          else if (rel >= 0.9) notes.push({ tone: 'good', text: `Click-through rate of ${pc(ctr, b)} is in line with the ${nm} market benchmark (${pc(b, b)}).` });
          else if (channel !== 'CTV') notes.push({ tone: 'flag', text: `Click-through rate of ${pc(ctr, b)} is below the ${nm} market benchmark (${pc(b, b)}). ${TIP[key] || ''}`.trim() });
        }
        const V = VCR[key];
        if (V && vcr != null) {
          if (vcr >= V[0] - 0.01) notes.push({ tone: 'good', text: `${p0(vcr)} of ads played to the end (${V[2]}), ${vcr >= V[0] + 0.01 ? 'above' : 'in line with'} the ${V[1]}.` });
          else notes.push({ tone: 'flag', text: `Only ${p0(vcr)} of ads played to the end, below the ${V[1]}. ${TIP[key] || ''}`.trim() });
        }
        if (pctr != null && prev.imp >= (MIN[key] || 2000) && cur.imp >= (MIN[key] || 2000) && prev.clk >= 5) {
          const d = ctr / pctr - 1;
          if (d >= 0.1) notes.push({ tone: 'good', text: `Click-through rate improved ${Math.round(d * 100)}% on the previous period.` });
          else if (d <= -0.2) notes.push({ tone: 'flag', text: `Click-through rate fell ${Math.round(-d * 100)}% from the previous period.` });
        }
        if (prev.imp >= 5000 && cur.imp < prev.imp * 0.6 && p.period !== 'mtd' && p.period !== 'qtd' && p.period !== 'ytd') notes.push({ tone: 'flag', text: `Impressions were down ${Math.round((1 - cur.imp / prev.imp) * 100)}% on the previous period; check budgets and pacing.` });
        if (cur.conv >= 1) {
          const what = platform === 'Meta' ? 'results (leads, calls and messages)' : platform === 'Programmatic' ? 'conversions, including people who saw an ad and acted later' : 'conversions';
          notes.push({ tone: 'good', text: `${nf(cur.conv)} ${what}.` });
        }
        if (['Display', 'Native', 'Search'].includes(channel) || platform === 'Meta') {
          const dead = [...camp.entries()].filter(([, o]) => o.imp >= 10000 && o.clk === 0).map(([n]) => n);
          if (dead.length) notes.push({ tone: 'flag', text: `No clicks on 10,000+ impressions: ${dead.slice(0, 3).join(', ')}${dead.length > 3 ? ` and ${dead.length - 3} more` : ''}.` });
        }
        rows.push({ k: [p.period, client, key].join('|'), period: p.period, client, key, platform, channel, label: channel ? (platform === 'Programmatic' || channel === 'YouTube' || channel === 'Performance Max' || channel === 'Demand Gen' ? channel : `Google ${channel}`) : LABEL[platform] || platform, imp: cur.imp, clk: cur.clk, ctr, vcr, bench: B ? B[0] : null, notes });
      }
    }
    return rows;
  },
});

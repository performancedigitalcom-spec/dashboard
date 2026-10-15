#!/usr/bin/env python3
"""PD Client Performance — daily refresh merger.

Usage:
  python3 refresh_merge.py --data DIR --raw DIR --start YYYY-MM-DD --end YYYY-MM-DD --out DIR

--data  folder holding the dashboard's current campaigns.json, meta_daily.json,
        google_daily.json, tiktok_daily.json (downloaded from the dashboard).
--raw   folder of raw Ryze answers saved as files, named by kind:
          meta_rows*.json      Meta campaign-level daily rows (runRawInsights, level campaign,
                               timeIncrement 1, the filtered actions list)
          meta_check*.json     Meta account-level daily totals (level account, timeIncrement 1,
                               fields impressions + spend)
          google_rows_<customerId>*.json   GAQL: segments.date, campaign.id, campaign.name,
                               campaign.advertising_channel_type, impressions, clicks,
                               cost_micros, conversions, all_conversions FROM campaign
          google_check_<customerId>*.json  GAQL: segments.date, metrics.impressions,
                               metrics.cost_micros FROM customer
          tiktok_rows_<advertiserId>*.json TikTok report: dims campaign_id + stat_time_day,
                               metrics spend, impressions, clicks, video_play_actions,
                               video_views_p100 (campaign_name optional)
        A file may hold the tool's answer as-is: a JSON list, an {"items": [...]} object,
        the [{"type":"text","text": ...}] wrapper of a saved tool result, or a TikTok
        {"list": [...]} answer.
Monthly audience and video (optional; replaces the calendar months present in the raw files):
          meta_age*.json / meta_gender*.json  Meta insights, level campaign, time_increment
                               "monthly", breakdowns age / gender, fields campaign_id,
                               impressions, inline_link_clicks
          meta_video*.json     Meta insights, level campaign, time_increment "monthly", fields
                               campaign_id, video_play_actions, video_p25/p50/p75/p100_watched_actions
          tiktok_aud_<advertiserId>_<YYYY-MM>*.json  TikTok AUDIENCE report for that month,
                               dims campaign_id + age + gender, metrics impressions, clicks
          tiktok_vid_<advertiserId>_<YYYY-MM>*.json  TikTok BASIC report for that month,
                               dims campaign_id, metrics video_play_actions, video_views_p25,
                               video_views_p50, video_views_p75, video_views_p100
          google_video_<customerId>*.json  GAQL: segments.month, campaign.id, metrics.impressions,
                               metrics.video_quartile_p25_rate .. p100_rate, metrics.video_trueview_views
                               FROM campaign WHERE campaign.advertising_channel_type = 'VIDEO'
Every day in [start, end] is replaced for the platforms whose raw files are present.
The run FAILS (exit 1, nothing written) if any day's campaign rows do not add up to
that day's account-level check, or if a Meta / Google answer was truncated.
"""
import argparse, glob, json, os, re, sys

META_ACCOUNT = 'act_3326957687582017'
A = {'landing_page_view': 'lpv', 'video_view': 'vv', 'post_engagement': 'pe', 'lead': 'leads',
     'offsite_conversion.fb_pixel_lead': 'leads', 'click_to_call_native_call_placed': 'calls',
     'onsite_conversion.messaging_conversation_started_7d': 'msgs'}
CH = {'SEARCH': 'Search', 'DISPLAY': 'Display', 'VIDEO': 'YouTube', 'MULTI_CHANNEL': 'App',
      'PERFORMANCE_MAX': 'Performance Max', 'SHOPPING': 'Shopping', 'DEMAND_GEN': 'Demand Gen'}


def load(fn):
    d = json.load(open(fn))
    if isinstance(d, list) and d and isinstance(d[0], dict) and 'text' in d[0] and 'type' in d[0]:
        d = json.loads(d[0]['text'])
    if isinstance(d, str):
        d = json.loads(d)
    trunc = False
    if isinstance(d, dict):
        trunc = bool(d.get('truncated'))
        for k in ('items', 'list', 'rows', 'data', 'results'):
            if k in d and isinstance(d[k], list):
                return d[k], trunc
        return [], trunc
    return d, trunc


def files(raw, pattern):
    return sorted(glob.glob(os.path.join(raw, pattern)))


def main():
    ap = argparse.ArgumentParser()
    for a in ('data', 'raw', 'start', 'end', 'out'):
        ap.add_argument('--' + a, required=True)
    o = ap.parse_args()
    S, E = o.start, o.end
    inwin = lambda d: S <= d <= E
    J = lambda n: json.load(open(os.path.join(o.data, n + '.json')))
    camps, meta, goog, tt = J('campaigns'), J('meta_daily'), J('google_daily'), J('tiktok_daily')
    known = {(c['platform'], c['campaign_id']) for c in camps}
    problems, report, new_camps = [], [], []

    # ---------- Meta ----------
    mf = files(o.raw, 'meta_rows*.json')
    if mf:
        rows = {}
        for fn in mf:
            items, tr = load(fn)
            if tr:
                problems.append(f'{os.path.basename(fn)} was truncated: pull a shorter date range')
            for r in items:
                if not inwin(r['date_start']):
                    continue
                x = dict(d=r['date_start'], cid=r['campaign_id'], imp=int(r['impressions']), clk=int(r['clicks']),
                         lc=int(r.get('inline_link_clicks', 0)), spend=round(float(r['spend']), 2),
                         lpv=0, vv=0, tp=0, pe=0, leads=0, calls=0, msgs=0)
                for a in r.get('actions', []):
                    k = A.get(a['action_type'])
                    if k:
                        x[k] += int(float(a['value']))
                for a in r.get('video_thruplay_watched_actions', []):
                    x['tp'] += int(float(a['value']))
                rows[(x['d'], x['cid'])] = x
                if ('Meta', x['cid']) not in known and x['imp'] > 0:
                    new_camps.append(('Meta', META_ACCOUNT, x['cid'], r.get('campaign_name', '')))
                    known.add(('Meta', x['cid']))
        chk = {}
        for fn in files(o.raw, 'meta_check*.json'):
            for r in load(fn)[0]:
                chk[r['date_start']] = (int(r['impressions']), round(float(r['spend']), 2))
        for d, (ci, cs) in sorted(chk.items()):
            if not inwin(d):
                continue
            si = sum(x['imp'] for (dd, _), x in rows.items() if dd == d)
            ss = round(sum(x['spend'] for (dd, _), x in rows.items() if dd == d), 2)
            if si != ci or abs(ss - cs) > 0.05:
                problems.append(f'Meta {d}: campaign rows {si} impr / ${ss} vs account {ci} / ${cs}')
        if not chk:
            problems.append('Meta: no account-level check file (meta_check*.json)')
        meta = [r for r in meta if not inwin(r['d'])] + list(rows.values())
        meta.sort(key=lambda x: (x['d'], x['cid']))
        report.append(f'Meta: {len(rows)} campaign-days for {S}..{E}')

    # ---------- Google ----------
    gfs = files(o.raw, 'google_rows_*.json')
    if gfs:
        custs = sorted({re.match(r'google_rows_(\d+)', os.path.basename(f)).group(1) for f in gfs})
        rows = {}
        for fn in gfs:
            cust = re.match(r'google_rows_(\d+)', os.path.basename(fn)).group(1)
            items, tr = load(fn)
            if tr:
                problems.append(f'{os.path.basename(fn)} was truncated: pull a shorter date range')
            for r in items:
                d = r['segments']['date']
                if not inwin(d):
                    continue
                c, m = r['campaign'], r['metrics']
                x = dict(d=d, cust=cust, cid=c['id'], imp=int(m.get('impressions', 0)), clk=int(m.get('clicks', 0)),
                         cost=round(int(m.get('costMicros', 0)) / 1e6, 2), conv=round(float(m.get('conversions', 0)), 2),
                         aconv=round(float(m.get('allConversions', 0)), 2))
                rows[(d, cust, c['id'])] = x
                if ('Google Ads', c['id']) not in known:
                    new_camps.append(('Google Ads', cust, c['id'], c.get('name', ''), CH.get(c.get('advertisingChannelType', ''), c.get('advertisingChannelType', '').title())))
                    known.add(('Google Ads', c['id']))
        for cust in custs:
            cf = files(o.raw, f'google_check_{cust}*.json')
            if not cf:
                problems.append(f'Google {cust}: no check file')
                continue
            for fn in cf:
                for r in load(fn)[0]:
                    d = r['segments']['date']
                    if not inwin(d):
                        continue
                    ci, cm = int(r['metrics'].get('impressions', 0)), int(r['metrics'].get('costMicros', 0))
                    si = sum(x['imp'] for k, x in rows.items() if k[0] == d and k[1] == cust)
                    sm = sum(round(x['cost'] * 1e6) for k, x in rows.items() if k[0] == d and k[1] == cust)
                    if si != ci or abs(sm - cm) > 20000:
                        problems.append(f'Google {cust} {d}: campaign rows {si} impr vs account {ci}')
        goog = [r for r in goog if not (inwin(r['d']) and r['cust'] in custs)] + [x for x in rows.values() if x['imp'] > 0]
        goog.sort(key=lambda x: (x['d'], x['cust'], x['cid']))
        report.append(f'Google Ads: {len(rows)} campaign-days for {S}..{E} across {len(custs)} accounts')

    # ---------- TikTok ----------
    tfs = files(o.raw, 'tiktok_rows_*.json')
    if tfs:
        advs = sorted({re.match(r'tiktok_rows_(\d+)', os.path.basename(f)).group(1) for f in tfs})
        tcid = {c['campaign_id']: c['account'] for c in camps if c['platform'] == 'TikTok'}
        rows = {}
        for fn in tfs:
            adv = re.match(r'tiktok_rows_(\d+)', os.path.basename(fn)).group(1)
            for r in load(fn)[0]:
                d = r['dimensions']['stat_time_day'][:10]
                if not inwin(d):
                    continue
                m = r['metrics']
                cid = r['dimensions']['campaign_id']
                x = dict(d=d, cid=cid, imp=int(m['impressions']), clk=int(m['clicks']), spend=round(float(m['spend']), 2),
                         plays=int(m.get('video_play_actions', 0)), p100=int(m.get('video_views_p100', 0)))
                if x['imp'] or x['spend']:
                    rows[(d, cid)] = x
                    tcid.setdefault(cid, adv)
                if ('TikTok', cid) not in known and x['imp'] > 0:
                    new_camps.append(('TikTok', adv, cid, m.get('campaign_name', '')))
                    known.add(('TikTok', cid))
        tt = [r for r in tt if not (inwin(r['d']) and tcid.get(r['cid']) in advs)] + list(rows.values())
        tt.sort(key=lambda x: (x['d'], x['cid']))
        report.append(f'TikTok: {len(rows)} campaign-days for {S}..{E} across {len(advs)} advertisers')


    # ---------- monthly audience + video ----------
    monthly = J('monthly') if os.path.exists(os.path.join(o.data, 'monthly.json')) else []
    newm, replace = [], set()
    AGE = {'AGE_13_17': '13-17', 'AGE_18_24': '18-24', 'AGE_25_34': '25-34', 'AGE_35_44': '35-44', 'AGE_45_54': '45-54',
           'AGE_55_100': '55+', 'NONE': 'Unknown', 'Unknown': 'Unknown'}
    GEN = {'MALE': 'Male', 'FEMALE': 'Female', 'NONE': 'Unknown', 'male': 'Male', 'female': 'Female', 'unknown': 'Unknown'}
    av = lambda x, f: sum(int(float(a['value'])) for a in x.get(f, []) or [])
    for kind in ('age', 'gender', 'video'):
        for fn in files(o.raw, f'meta_{kind}*.json'):
            items, tr = load(fn)
            if tr:
                problems.append(f'{os.path.basename(fn)} was truncated: pull fewer months')
            for x in items:
                m = x['date_start'][:7]
                replace.add(('Meta', kind, m))
                if kind == 'video':
                    pl = av(x, 'video_play_actions')
                    if pl:
                        newm.append(dict(platform='Meta', cid=x['campaign_id'], m=m, kind='video', b='', plays=pl,
                                         p25=av(x, 'video_p25_watched_actions'), p50=av(x, 'video_p50_watched_actions'),
                                         p75=av(x, 'video_p75_watched_actions'), p100=av(x, 'video_p100_watched_actions')))
                else:
                    b = x[kind]
                    b = b.capitalize() if kind == 'gender' else b
                    newm.append(dict(platform='Meta', cid=x['campaign_id'], m=m, kind=kind, b=b,
                                     imp=int(x['impressions']), clk=int(x.get('inline_link_clicks', 0))))
    for fn in files(o.raw, 'tiktok_aud_*.json'):
        mm = re.match(r'tiktok_aud_(\d+)_(\d{4}-\d{2})', os.path.basename(fn))
        if not mm:
            problems.append(f'{os.path.basename(fn)}: name must be tiktok_aud_<advertiserId>_<YYYY-MM>.json')
            continue
        m = mm.group(2)
        replace.update({('TikTok', 'age', m), ('TikTok', 'gender', m)})
        acc = {}
        for x in load(fn)[0]:
            d, mt = x['dimensions'], x['metrics']
            for kind, b in (('age', AGE.get(d.get('age'), d.get('age'))), ('gender', GEN.get(d.get('gender'), d.get('gender')))):
                k = (d['campaign_id'], kind, b)
                a = acc.setdefault(k, [0, 0])
                a[0] += int(float(mt['impressions']))
                a[1] += int(float(mt['clicks']))
        for (cid, kind, b), (i, c) in acc.items():
            if i:
                newm.append(dict(platform='TikTok', cid=cid, m=m, kind=kind, b=b, imp=i, clk=c))
    for fn in files(o.raw, 'tiktok_vid_*.json'):
        mm = re.match(r'tiktok_vid_(\d+)_(\d{4}-\d{2})', os.path.basename(fn))
        if not mm:
            problems.append(f'{os.path.basename(fn)}: name must be tiktok_vid_<advertiserId>_<YYYY-MM>.json')
            continue
        m = mm.group(2)
        replace.add(('TikTok', 'video', m))
        for x in load(fn)[0]:
            mt = x['metrics']
            pl = int(float(mt.get('video_play_actions', 0)))
            if pl:
                newm.append(dict(platform='TikTok', cid=x['dimensions']['campaign_id'], m=m, kind='video', b='', plays=pl,
                                 **{f'p{q}': int(float(mt.get(f'video_views_p{q}', 0))) for q in (25, 50, 75, 100)}))
    for fn in files(o.raw, 'google_video_*.json'):
        items, tr = load(fn)
        if tr:
            problems.append(f'{os.path.basename(fn)} was truncated')
        for x in items:
            m = x['segments']['month'][:7]
            replace.add(('Google Ads', 'video', m))
            mt = x['metrics']
            imp = int(mt.get('impressions', 0))
            if imp:
                r = {q: float(mt.get(f'videoQuartileP{q}Rate', 0)) for q in (25, 50, 75, 100)}
                newm.append(dict(platform='Google Ads', cid=x['campaign']['id'], m=m, kind='video', b='', plays=imp,
                                 p25=round(r[25] * imp), p50=round(r[50] * imp), p75=round(r[75] * imp), p100=round(r[100] * imp),
                                 views=int(mt.get('videoTrueviewViews', 0))))
    if replace:
        monthly = [r for r in monthly if (r['platform'], r['kind'], r['m']) not in replace] + newm
        monthly.sort(key=lambda r: (r['m'], r['platform'], r['kind'], r['cid'], r['b']))
        report.append(f'Monthly audience/video: {len(newm)} rows for ' + ', '.join(sorted({f"{p} {k} {m}" for p, k, m in replace})))

    for nc in new_camps:
        plat, acct, cid, name = nc[:4]
        ch = nc[4] if len(nc) > 4 else ('Meta' if plat == 'Meta' else plat)
        camps.append(dict(platform=plat, account=acct, campaign_id=cid, campaign=name or cid,
                          client='Unassigned — ' + (name or cid), channel=ch))
        report.append(f'NEW campaign needs a client: {plat} {cid} "{name}"')

    if problems:
        print('CHECK FAILED — nothing written:')
        for p in problems:
            print(' -', p)
        sys.exit(1)
    os.makedirs(o.out, exist_ok=True)
    outs = [('campaigns', camps), ('meta_daily', meta), ('google_daily', goog), ('tiktok_daily', tt)]
    if monthly:
        outs.append(('monthly', monthly))
    for n, v in outs:
        json.dump(v, open(os.path.join(o.out, n + '.json'), 'w'), separators=(',', ':'))
    latest = max(r['d'] for r in meta + goog + tt)
    print('OK — all days add up to the account-level checks. Latest day:', latest)
    for r in report:
        print(' -', r)


if __name__ == '__main__':
    main()

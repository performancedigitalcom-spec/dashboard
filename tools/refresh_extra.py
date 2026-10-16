#!/usr/bin/env python3
"""PD Client Performance - refresh for the warehouse, creative and pixel datasets.

Usage:
  python3 refresh_extra.py --data DIR --raw DIR --out DIR

--data  folder with the dashboard's current campaigns.json, monthly.json, ads_monthly.json
        (campaigns.json should be the one refresh_merge.py just wrote).
--raw   folder of raw answers saved as files (the tool's saved-output file is fine as-is):
  bq_illumin*.json   BigQuery answer for QUERY_ILLUMIN below (one 'camps' row + one row per month)
  bq_demo*.json      BigQuery answer for QUERY_DEMO
  bq_ga4*.json       BigQuery answer for QUERY_GA4
  bq_creatives*.json BigQuery answer for QUERY_CREATIVES (programmatic creatives by month)
  bq_ctv*.json       BigQuery answer for QUERY_CTV (CTV networks + household income by month, journeys, conversion definitions)
  meta_ads_<YYYY-MM>*.json   Meta runRawInsights, level ad, timeIncrement 'monthly', ONE calendar month,
                     fields ad_id, ad_name, campaign_id, campaign_name, impressions, inline_link_clicks, spend,
                     actions, video_thruplay_watched_actions, video_p100_watched_actions, filtered to the
                     action types in A below. Must not be truncated.
  tiktok_ads_<advertiserId>_<YYYY-MM>*.json   TikTok report dataLevel AUCTION_AD, dims ['ad_id'],
                     metrics ad_name, campaign_id, impressions, clicks, spend, video_play_actions,
                     video_views_p25, video_views_p50, video_views_p75, video_views_p100, for that month.
  meta_pixel_<pixelId>*.json  Graph read '<pixelId>/stats?aggregation=event_total_counts&start_time=..&end_time=..'
  meta_pixels_list*.json      Graph read 'act_3326957687582017/adspixels' fields id,name,last_fired_time
Whatever kinds are present are rebuilt; the rest is copied through unchanged.
"""
import argparse, glob, json, os, re, sys, collections

QUERY_ILLUMIN = """SELECT 'camps' m, COUNT(*) n, TO_JSON_STRING(ARRAY_AGG(STRUCT(pd_client_id AS pd, advertiser AS adv, campaign_id AS cid, campaign_name AS name, days, vs, imp))) AS r FROM (
 SELECT pd_client_id, advertiser, campaign_id, campaign_name, COUNT(*) days, SUM(video_start) vs, SUM(impressions) imp FROM `pd-client-analytics.client_reporting.illumin_campaign_daily_dashboard` GROUP BY 1,2,3,4)
UNION ALL
SELECT FORMAT_DATE('%Y-%m', date), COUNT(*), STRING_AGG(FORMAT('%s,%s,%d,%d,%.2f,%g,%g,%d,%d,%d,%d,%d,%g,%g,%g,%g', FORMAT_DATE('%d',date), campaign_id, IFNULL(impressions,0), IFNULL(clicks,0), IFNULL(spend,0), IFNULL(conversions,0), IFNULL(primary_conv,0), IFNULL(video_start,0), IFNULL(video_first_quartile,0), IFNULL(video_midpoint,0), IFNULL(video_third_quartile,0), IFNULL(video_complete,0), IFNULL(secondary_conv,0), IFNULL(tertiary_conv,0), IFNULL(cconv,0), IFNULL(avconv,0)), ';' ORDER BY date, campaign_id)
FROM `pd-client-analytics.client_reporting.illumin_campaign_daily_dashboard` GROUP BY 1"""
QUERY_DEMO = """SELECT 'age' kind, STRING_AGG(FORMAT('%s|%s|%s|%d|%d', m, campaign_id, b, imp, clk), ';') AS r, COUNT(*) n FROM (
  SELECT FORMAT_DATE('%Y-%m', date) m, campaign_id, age_range b, SUM(views) imp, SUM(clicks) clk FROM `pd-client-analytics.client_reporting.illumin_age_daily_clean` GROUP BY 1,2,3)
UNION ALL
SELECT 'gender', STRING_AGG(FORMAT('%s|%s|%s|%d|%d', m, campaign_id, b, imp, clk), ';'), COUNT(*) FROM (
  SELECT FORMAT_DATE('%Y-%m', date) m, campaign_id, gender b, SUM(views) imp, SUM(clicks) clk FROM `pd-client-analytics.client_reporting.illumin_gender_daily_clean` GROUP BY 1,2,3)"""
QUERY_GA4 = """SELECT 'daily' k, COUNT(*) n, STRING_AGG(FORMAT('%t|%s|%d|%d|%d|%d|%d|%d', report_date, pd_client_id, sessions, engaged_sessions, active_users, new_users, IFNULL(page_views,0), IFNULL(key_events,0)), ';') AS r FROM `pd-client-analytics.client_reporting.ga4_daily`
UNION ALL
SELECT 'chan', COUNT(*), STRING_AGG(FORMAT('%t|%s|%s|%d|%d|%d', report_date, pd_client_id, ch, s, e, ke), ';') FROM (
 SELECT report_date, pd_client_id, IFNULL(default_channel_group,'Unassigned') ch, SUM(sessions) s, SUM(engaged_sessions) e, SUM(IFNULL(key_events,0)) ke FROM `pd-client-analytics.client_reporting.ga4_source_medium_daily` WHERE pd_client_id IS NOT NULL GROUP BY 1,2,3)"""

QUERY_CREATIVES = """SELECT 'creatives' k, COUNT(*) n, SUM(v) tv, STRING_AGG(FORMAT('%s|%s|%d|%s|%s|%d|%d|%g|%d', m, IFNULL(pd,''), cid, REPLACE(IFNULL(name,''),'|','/'), IFNULL(typ,''), IFNULL(v,0), IFNULL(c,0), IFNULL(cv,0), IFNULL(vc,0)), '\\n') AS r FROM (
 SELECT FORMAT_DATE('%Y-%m', date) m, pd_client_id pd, creative_id cid, ANY_VALUE(creative_name) name, ANY_VALUE(creative_type) typ, SUM(views) v, SUM(clicks) c, SUM(IFNULL(conv,0)) cv, SUM(IFNULL(video_complete,0)) vc
 FROM `pd-client-analytics.client_reporting.illumin_creative_breakdown_clean` GROUP BY 1,2,3)"""
QUERY_CTV = """SELECT 'net' k, COUNT(*) n, STRING_AGG(FORMAT('%s|%s|%s|%d|%d|%g|%g|%g|%g', m, cid, REPLACE(net,'|','/'), v, c, cv, p1, p2, p3), '\\n') r FROM (
 SELECT m, cid, IF(rn <= 20 OR net = '', net, '~other') net, SUM(v) v, SUM(c) c, SUM(cv) cv, SUM(p1) p1, SUM(p2) p2, SUM(p3) p3 FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY m, cid ORDER BY IF(net = '', -1, v) DESC) rn FROM (
   SELECT FORMAT_DATE('%Y-%m', date) m, campaign_id cid, MIN(REGEXP_REPLACE(TRIM(IFNULL(ctv_network, '')), r'_+', ' ')) net, SUM(IFNULL(views,0)) v, SUM(IFNULL(clicks,0)) c, SUM(IFNULL(conversions,0)) cv, SUM(IFNULL(primary_conv,0)) p1, SUM(IFNULL(secondary_conv,0)) p2, SUM(IFNULL(tertiary_conv,0)) p3
   FROM `pd-client-analytics.client_reporting.illumin_ctv_network_daily_clean` GROUP BY 1,2, LOWER(REGEXP_REPLACE(TRIM(IFNULL(ctv_network, '')), r'[_\\s]+', ' '))))
 GROUP BY 1,2,3 HAVING v > 0)
UNION ALL
SELECT 'hhi', COUNT(*), STRING_AGG(FORMAT('%s|%s|%s|%d|%d|%g|%g|%g|%g', m, cid, b, v, c, cv, p1, p2, p3), '\\n') FROM (
 SELECT FORMAT_DATE('%Y-%m', date) m, campaign_id cid, IFNULL(NULLIF(TRIM(household_income), ''), 'Unknown') b, SUM(IFNULL(views,0)) v, SUM(IFNULL(clicks,0)) c, SUM(IFNULL(conversions,0)) cv, SUM(IFNULL(primary_conv,0)) p1, SUM(IFNULL(secondary_conv,0)) p2, SUM(IFNULL(tertiary_conv,0)) p3
 FROM `pd-client-analytics.client_reporting.illumin_household_income_daily_clean` GROUP BY 1,2,3 HAVING v > 0)
UNION ALL
SELECT 'jmap', COUNT(*), STRING_AGG(FORMAT('%s|%s|%s', cid, j, REPLACE(jn,'|','/')), '\\n') FROM (
 SELECT campaign_id cid, ANY_VALUE(journey_id) j, ANY_VALUE(journey_name) jn FROM `pd-client-analytics.client_reporting.illumin_ctv_network_daily_clean` GROUP BY 1)
UNION ALL
SELECT 'cfg', COUNT(*), TO_JSON_STRING(ARRAY_AGG(STRUCT(pd_client_id AS pd, journey_id AS j, journey_name AS jn, FORMAT_DATE('%F', effective_start_date) AS s, FORMAT_DATE('%F', effective_end_date) AS e, mapping_status AS st, primary_conversion_label AS l1, secondary_conversion_label AS l2, tertiary_conversion_label AS l3, notes) ORDER BY pd_client_id, journey_id, effective_start_date))
FROM `pd-client-analytics.client_reporting.illumin_conversion_config`
"""

NAME = {'PD-00001': "Controlled Comfort", 'PD-00003': 'AM 590 WOW', 'PD-00005': 'Boomstock', 'PD-00013': 'Great Plains State Bank',
        'PD-00015': 'Jill of All Trades', 'PD-00020': 'No Name Nutrition', 'PD-00025': "Today's Dental", 'PD-00027': 'OIBSTS',
        'PD-00028': 'Nabity Business Advisors', 'PD-00029': 'Performance Digital', 'PD-00031': "Gorat's Steakhouse",
        'PD-00034': 'Green Beans Coffee', 'PD-00036': 'Leash', 'PD-00038': 'SAC Museum', 'PD-00039': 'Spaghetti Works',
        'PD-00041': 'Three Rivers Public Health', 'PD-00045': 'Walnut Media', 'PD-00046': 'Roof Revive'}
FIX = {'120797': 'Omaha · Upper Funnel - CTV', '120801': 'Omaha · Middle Funnel - Native Display', '120809': 'Omaha · Lower Funnel - Display',
       '120811': 'Kansas City · Upper Funnel - CTV', '120813': 'Kansas City · Middle Funnel - Native Display', '120815': 'Kansas City · Lower Funnel - Display'}
AGE = {'18-20': '18-24', '21-24': '18-24', '25-29': '25-34', '30-34': '25-34', '35-39': '35-44', '40-44': '35-44',
       '45-49': '45-54', '50-54': '45-54', '55-64': '55-64', '65+': '65+', 'Unknown': 'Unknown', '': 'Unknown'}
PIXEL_CLIENT = {'26705403229077194': 'Controlled Comfort', '2773027266422748': "Cubby's", '1090397750548265': 'Freed By Real Estate',
                '1008630261537627': 'Mobility Plus Omaha', '38674666638843963': 'Omaha Homes For Cash', '1234814772146842': "Today's Dental",
                '1081736514820616': "Today's Dental", '25414581354858936': 'Spaghetti Works', '1219132950419646': 'OIBSTS',
                '3918976575073506': 'Nebraska City Historical Society', '770635845781517': 'Greater Fremont Development Council',
                '1979180292998206': 'Jill of All Trades'}
A = {'landing_page_view': 'lpv', 'video_view': 'vv', 'lead': 'res', 'offsite_conversion.fb_pixel_lead': 'res',
     'click_to_call_native_call_placed': 'res', 'onsite_conversion.messaging_conversation_started_7d': 'res'}

NET_ALIAS = {
    'samsung tv plus': 'Samsung TV Plus', 'samsung+tv+plus': 'Samsung TV Plus', 'samsung+tv+plus+content+network': 'Samsung TV Plus',
    'samsung content network': 'Samsung TV Plus', 'samsung network': 'Samsung TV Plus',
    'roku': 'The Roku Channel', 'the roku channel': 'The Roku Channel', 'tubi': 'Tubi', 'pluto': 'Pluto TV', 'pluto tv': 'Pluto TV',
    'wbd': 'Warner Bros. Discovery', 'wbd streaming': 'Warner Bros. Discovery', 'wbd discovery': 'Warner Bros. Discovery',
    'warnerbrothersdiscovery': 'Warner Bros. Discovery', 'warner bros. discovery': 'Warner Bros. Discovery',
    'nbcu': 'NBCUniversal', 'nbcu streaming inventory': 'NBCUniversal', 'nbcustreaminginventory': 'NBCUniversal', 'nbc': 'NBCUniversal',
    'fox': 'Fox', 'fox corp': 'Fox', 'onefox': 'Fox', 'fox networks': 'Fox', 'fox news': 'Fox News',
    'fox television stations affiliates': 'Fox Television Stations',
    'a+e global media': 'A+E Networks', 'a&e television networks': 'A+E Networks', 'aetv': 'A+E Networks', 'ae': 'A+E Networks', 'a&e': 'A+E Networks',
    'iontv': 'ION', 'ionplus': 'ION Plus', 'ionmystery': 'ION Mystery', 'scripps': 'Scripps', 'ew scripps': 'Scripps', 'scripps networks': 'Scripps',
    'amc': 'AMC Networks', 'amc networks': 'AMC Networks', 'univision': 'TelevisaUnivision', 'televisaunivision': 'TelevisaUnivision',
    'filmrise': 'FilmRise', 'lg channels': 'LG Channels', 'lg networks': 'LG Channels', 'estrellatv': 'EstrellaTV', 'vizio': 'Vizio',
    'nativeforeign': 'NativeForeignTV', 'nativeforeigntv': 'NativeForeignTV', 'lionsgate': 'Lionsgate', 'bloomberg': 'Bloomberg',
    'flosports': 'FloSports', 'msnbc': 'MSNBC', 'cnn': 'CNN', 'courttv': 'Court TV', 'disney': 'Disney', 'the walt disney co.': 'Disney',
    'viacom': 'Paramount', 'paramount': 'Paramount', 'turner': 'Warner Bros. Discovery', 'spectrum': 'Spectrum', 'twc-prod': 'Spectrum',
    'very local by hearst television': 'Very Local (Hearst)', 'graytelevision': 'Gray Television', 'odkmedia': 'OnDemandKorea',
    'xumo: production houses': 'Xumo', 'fetv': 'FETV', 'gritxtra': 'Grit Xtra', 'bouncexl': 'Bounce XL', 'knxv': 'KNXV (ABC15)',
    'nexstar local tv stations': 'Nexstar', 'itvstudios': 'ITV Studios', 'broadcaststreaminginventory': 'Broadcast streaming',
    'echelonstudio': 'Echelon Studios', 'investigation discovery': 'Investigation Discovery', 'syfy': 'Syfy',
    'unknown 1': '', 'unknown': '', '~other': '~other'}
HHI_ORDER = ['Under $25,000', '$25,000-$50,000', '$50,001-$75,000', '$75,001-$100,000', '$100,001-$150,000', '$150,001-$200,000', '$200,001+', 'Unknown']


def net_name(n):
    n = (n or '').strip()
    k = re.sub(r'\s+', ' ', n.replace('_', ' ')).lower()
    if k in NET_ALIAS:
        return NET_ALIAS[k]
    if n.islower():
        return ' '.join(w.capitalize() for w in k.split(' '))
    return n


def raw_load(fn):
    d = json.load(open(fn))
    if isinstance(d, list) and d and isinstance(d[0], dict) and 'text' in d[0] and 'type' in d[0]:
        d = json.loads(d[0]['text'])
    if isinstance(d, str):
        d = json.loads(d)
    return d


def bq_rows(fn):
    d = raw_load(fn)
    if not d.get('jobComplete', True):
        raise SystemExit(f'{fn}: BigQuery job not complete')
    return {row['f'][0]['v']: [c['v'] for c in row['f']] for row in d['rows']}


def items_of(d):
    if isinstance(d, dict):
        for k in ('items', 'list', 'data', 'rows'):
            if isinstance(d.get(k), list):
                return d[k], bool(d.get('truncated'))
        return [], bool(d.get('truncated'))
    return d, False


def main():
    ap = argparse.ArgumentParser()
    for a in ('data', 'raw', 'out'):
        ap.add_argument('--' + a, required=True)
    o = ap.parse_args()
    F = lambda pat: sorted(glob.glob(os.path.join(o.raw, pat)))
    J = lambda n, dflt=None: json.load(open(os.path.join(o.data, n + '.json'))) if os.path.exists(os.path.join(o.data, n + '.json')) else dflt
    camps, monthly, ads = J('campaigns'), J('monthly', []), J('ads_monthly', [])
    out, problems, report = {}, [], []

    # ---------- Illumin ----------
    if F('bq_illumin*.json'):
        R = bq_rows(F('bq_illumin*.json')[-1])
        meta = json.loads(R.pop('camps')[2])
        by = collections.defaultdict(list)
        for m in meta:
            m['vs'], m['imp'], m['days'] = int(m['vs'] or 0), int(m['imp'] or 0), int(m['days'])
            by[m['cid']].append(m)
        def tactic(name, vs, imp):
            n = name.lower()
            for k, t in (('ctv', 'CTV'), ('connected tv', 'CTV'), ('audio', 'Audio'), ('dooh', 'DOOH'), ('native', 'Native'), ('display', 'Display')):
                if k in n:
                    return t
            return 'CTV' if imp and vs / imp > 0.5 else 'Display'
        old = {c['campaign_id']: c for c in camps if c['platform'] == 'Programmatic'}
        camps = [c for c in camps if c['platform'] != 'Programmatic']
        for cid, lst in by.items():
            best = max(lst, key=lambda x: x['days'])
            vs, imp = sum(x['vs'] for x in lst), sum(x['imp'] for x in lst)
            if not imp:
                continue
            if cid in old:
                camps.append(old[cid])
                continue
            client = NAME.get(best['pd'], best['adv'])
            camps.append(dict(platform='Programmatic', account=best['pd'], campaign_id=cid,
                              campaign=FIX.get(cid) or re.sub(r'^Performance Digital_', '', best['name']).replace('_', ' · '),
                              client=client, channel=tactic(best['name'], vs, imp)))
            report.append(f'New programmatic campaign {cid} "{best["name"]}" filed under {client}')
        daily = []
        for m, f in R.items():
            rr = f[2].split(';') if f[2] else []
            if int(f[1]) != len(rr):
                problems.append(f'Illumin {m}: {len(rr)} rows but BigQuery counted {f[1]}')
            for x in rr:
                f12 = x.split(',')
                dd, cid, imp, clk, sp, conv, pconv, vs, a, b, c, d = f12[:12]
                p2, p3, cc, av = (float(v) for v in (f12[12:16] if len(f12) >= 16 else (0, 0, 0, 0)))
                if int(imp) == 0 and float(sp) == 0 and float(conv) == 0:
                    continue
                row = dict(d=f'{m}-{dd}', cid=cid, imp=int(imp), clk=int(clk), spend=float(sp), conv=float(conv), pconv=float(pconv),
                           vs=int(vs), v25=int(a), v50=int(b), v75=int(c), v100=int(d))
                if len(f12) >= 16:  # Primary = pconv; Secondary, Tertiary; after a click / after only seeing an ad
                    row.update(p2=p2, p3=p3, cc=cc, av=av)
                daily.append(row)
        daily.sort(key=lambda r: (r['d'], r['cid']))
        out['programmatic_daily'] = daily
        monthly = [r for r in monthly if not (r['platform'] == 'Programmatic' and r['kind'] == 'video')]
        vacc = collections.defaultdict(lambda: [0] * 5)
        for r in daily:
            if r['vs']:
                a = vacc[(r['d'][:7], r['cid'])]
                for i, k in enumerate(('vs', 'v25', 'v50', 'v75', 'v100')):
                    a[i] += r[k]
        for (m, cid), a in vacc.items():
            monthly.append(dict(platform='Programmatic', cid=cid, m=m, kind='video', b='', plays=a[0], p25=a[1], p50=a[2], p75=a[3], p100=a[4]))
        report.append(f'Programmatic: {len(daily)} campaign-days through {daily[-1]["d"] if daily else "-"}')
    if F('bq_demo*.json'):
        D = bq_rows(F('bq_demo*.json')[-1])
        monthly = [r for r in monthly if not (r['platform'] == 'Programmatic' and r['kind'] in ('age', 'gender'))]
        for kind in ('age', 'gender'):
            acc = collections.defaultdict(lambda: [0, 0])
            for x in (D[kind][1] or '').split(';'):
                if not x:
                    continue
                m, cid, b, i, c = x.split('|')
                b = AGE.get(b, b) if kind == 'age' else (b or 'Unknown')
                acc[(m, cid, b)][0] += int(i)
                acc[(m, cid, b)][1] += int(c)
            for (m, cid, b), (i, c) in acc.items():
                if i:
                    monthly.append(dict(platform='Programmatic', cid=cid, m=m, kind=kind, b=b, imp=i, clk=c))
        report.append('Programmatic audience rebuilt')
    if F('bq_ga4*.json'):
        G = bq_rows(F('bq_ga4*.json')[-1])
        ga = []
        for x in (G['daily'][2] or '').split(';'):
            d, pd, s, es, u, nu, pv, ke = x.split('|')
            ga.append(dict(d=d, client=NAME.get(pd, pd), kind='total', ch='', s=int(s), es=int(es), u=int(u), nu=int(nu), pv=int(pv), ke=int(ke)))
        for x in (G['chan'][2] or '').split(';'):
            d, pd, ch, s, es, ke = x.split('|')
            ga.append(dict(d=d, client=NAME.get(pd, pd), kind='channel', ch=ch, s=int(s), es=int(es), u=0, nu=0, pv=0, ke=int(ke)))
        ga.sort(key=lambda r: (r['d'], r['client'], r['kind'], r['ch']))
        out['ga4_daily'] = ga
        unknown = sorted({r['client'] for r in ga if r['client'].startswith('PD-')})
        if unknown:
            report.append('GA4 clients without a name yet: ' + ', '.join(unknown))
        report.append(f'GA4: {len(ga)} rows through {max(r["d"] for r in ga)}')

    # ---------- CTV networks, household income, conversion definitions ----------
    if F('bq_ctv*.json'):
        d = raw_load(F('bq_ctv*.json')[-1])
        R = {r['f'][0]['v']: [c['v'] for c in r['f']] for r in d['rows']}
        chan = {c['campaign_id']: c['channel'] for c in camps if c['platform'] == 'Programmatic'}
        pdname = {c['account']: c['client'] for c in camps if c['platform'] == 'Programmatic'}
        monthly = [r for r in monthly if not (r['platform'] == 'Programmatic' and r['kind'] in ('ctvnet', 'hhi', 'journey', 'convcfg'))]
        for kind, key in (('ctvnet', 'net'), ('hhi', 'hhi')):
            lines = (R[key][2] or '').split('\n') if R.get(key) else []
            if not R.get(key) or int(R[key][1]) != len([x for x in lines if x]):
                problems.append(f'CTV {key}: {len(lines)} rows but BigQuery counted {R.get(key, [0, 0])[1]}')
                continue
            acc = collections.defaultdict(lambda: [0, 0, 0.0, 0.0, 0.0, 0.0])
            for x in lines:
                if not x:
                    continue
                m, cid, b, v, c, cv, p1, p2, p3 = x.split('|')
                if kind == 'ctvnet':
                    if chan.get(cid, 'CTV') != 'CTV':
                        continue
                    b = net_name(b)
                else:
                    b = b if b in HHI_ORDER else 'Unknown'
                a = acc[(m, cid, b)]
                for i, val in enumerate((int(v), int(c), float(cv), float(p1), float(p2), float(p3))):
                    a[i] += val
            for (m, cid, b), a in acc.items():
                if a[0]:
                    monthly.append(dict(platform='Programmatic', cid=cid, m=m, kind=kind, b=b, imp=a[0], clk=a[1], conv=a[2], p1=a[3], p2=a[4], p3=a[5]))
            report.append(f'CTV {key}: {len(acc)} rows')
        for x in (R['jmap'][2] or '').split('\n') if R.get('jmap') else []:
            if x:
                cid, j, jn = x.split('|', 2)
                monthly.append(dict(platform='Programmatic', cid=cid, m='', kind='journey', b=j, name=jn))
        for c in json.loads(R['cfg'][2] or '[]') if R.get('cfg') else []:
            monthly.append(dict(platform='Programmatic', cid='', m='', kind='convcfg', b=c['j'], client=pdname.get(c['pd'], NAME.get(c['pd'], c['pd'])),
                                journey=c.get('jn') or '', s=c['s'], e=c.get('e') or '', st=c.get('st') or '', l1=c.get('l1') or '', l2=c.get('l2') or '',
                                l3=c.get('l3') or '', notes=c.get('notes') or ''))
        report.append(f'Conversion definitions: {len(json.loads(R["cfg"][2] or "[]")) if R.get("cfg") else 0}')
    # ---------- creatives ----------
    info = {(c['platform'], c['campaign_id']) for c in camps}
    by_month = collections.defaultdict(list)
    for fn in F('meta_ads_*.json'):
        by_month[re.match(r'meta_ads_(\d{4}-\d{2})', os.path.basename(fn)).group(1)].append(fn)
    for m, fns in sorted(by_month.items()):
        items = []
        for fn in fns:
            it, tr = items_of(raw_load(fn))
            if tr:
                problems.append(f'{os.path.basename(fn)} was truncated: pull the month in two halves of the ad list')
            items += it
        seen = set()
        items = [x for x in items if not ((x['ad_id'], x['date_start']) in seen or seen.add((x['ad_id'], x['date_start'])))]
        ads = [r for r in ads if not (r['platform'] == 'Meta' and r['m'] == m)]
        av = lambda x, f: sum(int(float(a['value'])) for a in x.get(f, []) or [])
        n = 0
        for x in items:
            if x['date_start'][:7] != m:
                continue
            r = dict(platform='Meta', cid=x['campaign_id'], m=m, ad=x['ad_id'], name=x['ad_name'], imp=int(x['impressions']),
                     clk=int(x.get('inline_link_clicks', 0)), spend=round(float(x['spend']), 2), lpv=0, vv=0, res=0,
                     tp=av(x, 'video_thruplay_watched_actions'), p100=av(x, 'video_p100_watched_actions'))
            for a in x.get('actions', []):
                k = A.get(a['action_type'])
                if k:
                    r[k] += int(float(a['value']))
            if r['imp'] or r['spend']:
                ads.append(r)
                n += 1
        report.append(f'Meta creatives {m}: {n} ads')
    for fn in F('tiktok_ads_*.json'):
        mm = re.match(r'tiktok_ads_(\d+)_(\d{4}-\d{2})', os.path.basename(fn))
        if not mm:
            problems.append(f'{os.path.basename(fn)}: name must be tiktok_ads_<advertiserId>_<YYYY-MM>.json')
            continue
        m = mm.group(2)
        items, _ = items_of(raw_load(fn))
        cids = {x['metrics'].get('campaign_id') for x in items}
        ads = [r for r in ads if not (r['platform'] == 'TikTok' and r['m'] == m and r['cid'] in cids)]
        for x in items:
            mt = x['metrics']
            if int(float(mt.get('impressions', 0))) == 0 and float(mt.get('spend', 0)) == 0:
                continue
            name = re.sub(r'^.*\.mp4_', '', mt.get('ad_name', '')).replace('_Ad', '').strip() or mt.get('ad_name', '')
            ads.append(dict(platform='TikTok', cid=mt.get('campaign_id'), m=m, ad=x['dimensions']['ad_id'], name=name,
                            imp=int(float(mt['impressions'])), clk=int(float(mt['clicks'])), spend=round(float(mt['spend']), 2),
                            plays=int(float(mt.get('video_play_actions', 0))), p25=int(float(mt.get('video_views_p25', 0))),
                            p50=int(float(mt.get('video_views_p50', 0))), p75=int(float(mt.get('video_views_p75', 0))),
                            p100=int(float(mt.get('video_views_p100', 0))), lpv=0, res=0))
        report.append(f'TikTok creatives {m}: advertiser {mm.group(1)}')
    if F('meta_ads_*.json') or F('tiktok_ads_*.json'):
        ads.sort(key=lambda r: (r['m'], r['platform'], r['cid'], r['ad']))
        out['ads_monthly'] = ads

    if F('bq_creatives*.json'):
        d = raw_load(F('bq_creatives*.json')[-1])
        k, n, tv, r = [c['v'] for c in d['rows'][0]['f']]
        lines = r.split('\n') if r else []
        if int(n) != len(lines):
            problems.append(f'Programmatic creatives: {len(lines)} rows but BigQuery counted {n}')
        pdname = {c['account']: c['client'] for c in camps if c['platform'] == 'Programmatic'}
        TAC = {'Display Standard': 'Display', 'Native Display': 'Native', 'CTV Video': 'CTV', 'Audio': 'Audio', 'Digital Out-Of-Home Display': 'DOOH'}
        ads = [x for x in ads if x['platform'] != 'Programmatic']
        for x in lines:
            m, pd, cid, name, typ, v, c, cv, vc = x.split('|')
            if int(v) == 0:
                continue
            size = re.search(r'\d{2,4}x\d{2,4}', name)
            ads.append(dict(platform='Programmatic', client=pdname.get(pd, NAME.get(pd, pd)), cid='', m=m, ad=cid, name=name, tactic=TAC.get(typ, typ),
                            size=size.group(0) if size else '', imp=int(v), clk=int(c), spend=0, conv=float(cv), p100=int(vc), lpv=0, res=0))
        out['ads_monthly'] = ads
        report.append(f'Programmatic creatives: {len(lines)} creative-months')
    # ---------- pixels ----------
    if F('meta_pixel_*.json'):
        names, last = {}, {}
        for fn in F('meta_pixels_list*.json'):
            for p in items_of(raw_load(fn))[0]:
                names[p['id']] = p.get('name', p['id'])
                last[p['id']] = (p.get('last_fired_time') or '')[:10]
        rows = []
        for fn in F('meta_pixel_*.json'):
            pid = re.match(r'meta_pixel_(\d+)', os.path.basename(fn)).group(1)
            if pid not in PIXEL_CLIENT:
                continue
            for blk in items_of(raw_load(fn))[0]:
                since = blk.get('start_time', '')[:10]
                for e in blk.get('data', []):
                    rows.append(dict(client=PIXEL_CLIENT[pid], pixel_id=pid, pixel=names.get(pid, pid), last_fired=last.get(pid, ''),
                                     since=since, until=__import__('datetime').date.today().isoformat(), event=e['value'], count=int(e['count'])))
        out['meta_pixels'] = rows
        report.append(f'Meta pixels: {len({r["pixel_id"] for r in rows})} pixels')

    if problems:
        print('CHECK FAILED - nothing written:')
        for p in problems:
            print(' -', p)
        sys.exit(1)
    os.makedirs(o.out, exist_ok=True)
    out['campaigns'] = camps
    out['monthly'] = monthly
    for n, v in out.items():
        json.dump(v, open(os.path.join(o.out, n + '.json'), 'w'), separators=(',', ':'))
    print('OK - wrote', ', '.join(sorted(out)))
    for r in report:
        print(' -', r)


if __name__ == '__main__':
    main()

"""Daily ad-platform refresh for the colleague site, straight from the Meta, Google Ads and TikTok APIs.

Runs in GitHub Actions (see .github/workflows/ads-refresh.yml) with permanent API credentials stored as
repository secrets, so it needs no Claude connector, no approvals and no open conversation.

Steps: decrypt the site's current data -> pull the last 8 days of campaign rows (+ account-level checks),
this and last month's audience / video / creative breakdowns and Meta pixel stats -> merge with the same
refresh_merge.py / refresh_extra.py the dashboard uses (which refuse to write if campaign rows don't add up
to the account totals) -> never let a daily dataset go backwards -> re-encrypt into data/.

A platform whose secrets are missing, or whose API call fails, is skipped and keeps its previous data;
the reason is printed as a GitHub annotation.

Secrets / environment:
  PD_DATA_KEY, PD_TEAM_PASSWORD                     site encryption (same as the BigQuery job)
  META_TOKEN                                        Meta system-user access token (ads_read)
  GADS_SA_KEY (service-account JSON, preferred) or GADS_CLIENT_ID + GADS_CLIENT_SECRET + GADS_REFRESH_TOKEN
                                                    Google Ads API (manager login 3978171358). Google no longer
                                                    needs a developer token; GADS_DEVELOPER_TOKEN is sent only if set.
                                                    Access level comes from the Cloud project that owns the
                                                    credentials (pd-client-analytics, Explorer access or higher).
  TIKTOK_TOKEN                                      TikTok for Business long-term access token
"""
import argparse, base64, datetime, glob, gzip, importlib.util, json, os, shutil, subprocess, sys, tempfile, time
import urllib.parse, urllib.request, urllib.error
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
META_ACCOUNT = 'act_3326957687582017'
META_API = 'https://graph.facebook.com/' + os.environ.get('META_API_VERSION', 'v23.0')
GADS_LOGIN = '3978171358'
GADS_CUSTOMERS = ['1617465645', '2297433325', '3759382237', '5323277935', '5696694303', '5794801121',
                  '6720136131', '7016721023', '8220148603', '8416419143', '9131703505']
GADS_VERSIONS = [v for v in [os.environ.get('GADS_API_VERSION'), 'v27', 'v26', 'v25', 'v24', 'v23', 'v22'] if v]
TIKTOK_ADVERTISERS = ['7140363181553205250', '7283126073947127809', '7288330476199149570']
TIKTOK_API = 'https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/'


def warn(title, msg):
    print(f'::warning title={title}::{str(msg).replace(chr(10), " ")[:700]}')


def http(url, data=None, headers=None, tries=3):
    body = None if data is None else (data if isinstance(data, bytes) else json.dumps(data).encode())
    for i in range(tries):
        req = urllib.request.Request(url, data=body, headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            txt = e.read().decode(errors='replace')[:600]
            if e.code in (429, 500, 502, 503) and i < tries - 1:
                time.sleep(5 * (i + 1))
                continue
            raise RuntimeError(f'HTTP {e.code}: {txt}')
        except urllib.error.URLError as e:
            if i < tries - 1:
                time.sleep(5)
                continue
            raise


def save(raw, name, obj):
    json.dump(obj, open(os.path.join(raw, name), 'w'))


# ---------------- Meta ----------------
def meta_get(path, params):
    params = dict(params, access_token=os.environ['META_TOKEN'])
    url = f'{META_API}/{path}?' + urllib.parse.urlencode({k: (json.dumps(v) if isinstance(v, (dict, list)) else v) for k, v in params.items()})
    out = []
    while url:
        d = http(url)
        out.extend(d.get('data', []))
        url = (d.get('paging') or {}).get('next')
    return out


def meta(raw, S, E, months, today, pixels):
    rng = lambda a, b: {'since': a, 'until': b}
    base = {'limit': 500}
    save(raw, 'meta_rows.json', meta_get(f'{META_ACCOUNT}/insights', dict(base, level='campaign', time_increment=1, time_range=rng(S, E),
         fields='campaign_id,campaign_name,impressions,clicks,inline_link_clicks,spend,actions,video_thruplay_watched_actions')))
    save(raw, 'meta_check.json', meta_get(f'{META_ACCOUNT}/insights', dict(base, level='account', time_increment=1, time_range=rng(S, E),
         fields='impressions,spend')))
    m0, m1 = months[0][0], months[-1][1]
    for kind in ('age', 'gender'):
        save(raw, f'meta_{kind}.json', meta_get(f'{META_ACCOUNT}/insights', dict(base, level='campaign', time_increment='monthly',
             time_range=rng(m0, m1), breakdowns=kind, fields='campaign_id,impressions,inline_link_clicks')))
    save(raw, 'meta_video.json', meta_get(f'{META_ACCOUNT}/insights', dict(base, level='campaign', time_increment='monthly', time_range=rng(m0, m1),
         fields='campaign_id,video_play_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions')))
    for a, b in months:
        save(raw, f'meta_ads_{a[:7]}.json', meta_get(f'{META_ACCOUNT}/insights', dict(base, level='ad', time_increment='monthly', time_range=rng(a, b),
             fields='ad_id,ad_name,campaign_id,campaign_name,impressions,inline_link_clicks,spend,actions,video_thruplay_watched_actions,video_p100_watched_actions')))
    bad = []
    try:
        save(raw, 'meta_pixels_list.json', meta_get(f'{META_ACCOUNT}/adspixels', {'fields': 'id,name,last_fired_time'}))
    except Exception as e:
        bad.append(f'pixel list ({META_ACCOUNT}/adspixels): {e}')
    t0 = (today - datetime.timedelta(days=28)).isoformat()
    for pid in pixels:
        try:
            d = http(f'{META_API}/{pid}/stats?' + urllib.parse.urlencode({'aggregation': 'event_total_counts', 'start_time': f'{t0}T00:00:00-0500',
                     'end_time': f'{today.isoformat()}T00:00:00-0500', 'access_token': os.environ['META_TOKEN']}))
            save(raw, f'meta_pixel_{pid}.json', d)
        except Exception as e:
            bad.append(f'pixel {pid} ({pixels[pid]}): {str(e)[:80]}')
    if bad:  # all-or-nothing: the pixel table is rebuilt as a whole, so keep the previous one
        for f in glob.glob(os.path.join(raw, 'meta_pixel*.json')):
            os.remove(f)
        warn(f'Meta pixels skipped ({len(bad)} of {len(pixels) + 1} calls failed)', ' || '.join(bad))


# ---------------- Google Ads ----------------
def b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def gads_token():
    sa = os.environ.get('GADS_SA_KEY', '').strip()
    if sa:  # service account added as a user in the Google Ads manager account
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding
        k = json.loads(sa)
        now = int(time.time())
        head = b64u(json.dumps({'alg': 'RS256', 'typ': 'JWT'}).encode())
        body = b64u(json.dumps({'iss': k['client_email'], 'scope': 'https://www.googleapis.com/auth/adwords',
                                'aud': 'https://oauth2.googleapis.com/token', 'iat': now, 'exp': now + 3600}).encode())
        key = serialization.load_pem_private_key(k['private_key'].encode(), None)
        sig = b64u(key.sign(f'{head}.{body}'.encode(), padding.PKCS1v15(), hashes.SHA256()))
        form = {'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion': f'{head}.{body}.{sig}'}
    else:
        form = {'client_id': os.environ['GADS_CLIENT_ID'], 'client_secret': os.environ['GADS_CLIENT_SECRET'],
                'refresh_token': os.environ['GADS_REFRESH_TOKEN'], 'grant_type': 'refresh_token'}
    d = http('https://oauth2.googleapis.com/token', urllib.parse.urlencode(form).encode(),
             {'Content-Type': 'application/x-www-form-urlencoded'})
    return d['access_token']


def gads_query(tok, cust, q, ver):
    h = {'Authorization': 'Bearer ' + tok, 'login-customer-id': GADS_LOGIN, 'Content-Type': 'application/json'}
    if os.environ.get('GADS_DEVELOPER_TOKEN'):
        h['developer-token'] = os.environ['GADS_DEVELOPER_TOKEN']
    out = []
    for chunk in http(f'https://googleads.googleapis.com/{ver}/customers/{cust}/googleAds:searchStream', {'query': q}, h):
        out.extend(chunk.get('results', []))
    return out


def google(raw, S, E, months):
    tok = gads_token()
    ver = None
    for v in GADS_VERSIONS:  # first API version Google still accepts
        try:
            gads_query(tok, GADS_CUSTOMERS[0], "SELECT customer.id FROM customer LIMIT 1", v)
            ver = v
            break
        except RuntimeError as e:
            if 'HTTP 404' not in str(e):
                raise
    if not ver:
        raise RuntimeError('no supported Google Ads API version found')
    rows_q = ("SELECT segments.date, campaign.id, campaign.name, campaign.advertising_channel_type, metrics.impressions, metrics.clicks, "
              f"metrics.cost_micros, metrics.conversions, metrics.all_conversions FROM campaign WHERE segments.date BETWEEN '{S}' AND '{E}' "
              "AND metrics.impressions > 0")
    chk_q = f"SELECT segments.date, metrics.impressions, metrics.cost_micros FROM customer WHERE segments.date BETWEEN '{S}' AND '{E}'"
    vid_q = ("SELECT segments.month, campaign.id, metrics.impressions, metrics.video_quartile_p25_rate, metrics.video_quartile_p50_rate, "
             "metrics.video_quartile_p75_rate, metrics.video_quartile_p100_rate, metrics.video_trueview_views FROM campaign "
             f"WHERE campaign.advertising_channel_type = 'VIDEO' AND segments.date BETWEEN '{months[0][0]}' AND '{months[-1][1]}'")
    for c in GADS_CUSTOMERS:
        rows = gads_query(tok, c, rows_q, ver)
        save(raw, f'google_rows_{c}.json', rows)
        save(raw, f'google_check_{c}.json', gads_query(tok, c, chk_q, ver))
        if any(r['campaign'].get('advertisingChannelType') == 'VIDEO' for r in rows):
            try:
                save(raw, f'google_video_{c}.json', gads_query(tok, c, vid_q, ver))
            except Exception as e:
                warn(f'Google video {c} skipped', e)


# ---------------- TikTok ----------------
def tt_report(adv, a, b, data_level, dims, metrics, report_type='BASIC'):
    out, page = [], 1
    while True:
        q = urllib.parse.urlencode({'advertiser_id': adv, 'report_type': report_type, 'data_level': data_level, 'dimensions': json.dumps(dims),
                                    'metrics': json.dumps(metrics), 'start_date': a, 'end_date': b, 'page': page, 'page_size': 1000})
        d = http(f'{TIKTOK_API}?{q}', headers={'Access-Token': os.environ['TIKTOK_TOKEN']})
        if d.get('code') != 0:
            raise RuntimeError(f"TikTok {adv}: {d.get('code')} {d.get('message')}")
        data = d.get('data') or {}
        out.extend(data.get('list', []))
        info = data.get('page_info') or {}
        if page >= int(info.get('total_page') or 1):
            return out
        page += 1


def tiktok(raw, S, E, months):
    for adv in TIKTOK_ADVERTISERS:
        save(raw, f'tiktok_rows_{adv}.json', {'list': tt_report(adv, S, E, 'AUCTION_CAMPAIGN', ['campaign_id', 'stat_time_day'],
             ['campaign_name', 'spend', 'impressions', 'clicks', 'video_play_actions', 'video_views_p100'])})
        for a, b in months:
            m = a[:7]
            vid = tt_report(adv, a, b, 'AUCTION_CAMPAIGN', ['campaign_id'], ['video_play_actions', 'video_views_p25', 'video_views_p50',
                            'video_views_p75', 'video_views_p100'])
            if not vid:
                continue
            save(raw, f'tiktok_vid_{adv}_{m}.json', {'list': vid})
            save(raw, f'tiktok_aud_{adv}_{m}.json', {'list': tt_report(adv, a, b, 'AUCTION_CAMPAIGN', ['campaign_id', 'age', 'gender'],
                 ['impressions', 'clicks'], 'AUDIENCE')})
            save(raw, f'tiktok_ads_{adv}_{m}.json', {'list': tt_report(adv, a, b, 'AUCTION_AD', ['ad_id'], ['ad_name', 'campaign_id', 'impressions',
                 'clicks', 'spend', 'video_play_actions', 'video_views_p25', 'video_views_p50', 'video_views_p75', 'video_views_p100'])})


# ---------------- site data ----------------
def decrypt_all(data_dir, out_dir, key):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    aes = AESGCM(key)
    for fn in glob.glob(os.path.join(data_dir, '*.enc')):
        name = os.path.basename(fn)[:-4]
        if name == 'check':
            continue
        raw = open(fn, 'rb').read()
        json.dump(json.loads(gzip.decompress(aes.decrypt(raw[:12], raw[12:], None))), open(os.path.join(out_dir, name + '.json'), 'w'))


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def latest(path):
    d = json.load(open(path))
    return max((r['d'] for r in d if 'd' in r), default='')


def run(script, *args):
    r = subprocess.run([sys.executable, '-I', os.path.join(HERE, script), *args], capture_output=True, text=True)
    print(r.stdout, r.stderr)
    if r.returncode != 0:
        import re
        lines = [re.sub(r'\$[\d.,]+', '$-', l.strip(' -')) for l in r.stdout.splitlines() if l.startswith(' - ')]
        raise SystemExit(f'{script} refused the data - site data left unchanged: ' + ' || '.join(lines[:8]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', default=os.path.dirname(HERE))
    ap.add_argument('--raw', help='use saved raw answers from this folder instead of calling the APIs (testing)')
    o = ap.parse_args()
    key_b64 = os.environ['PD_DATA_KEY']
    today = datetime.datetime.now(ZoneInfo('America/New_York')).date()
    end = today - datetime.timedelta(days=1)
    S, E = (end - datetime.timedelta(days=7)).isoformat(), end.isoformat()
    cur0 = end.replace(day=1)
    prev0 = (cur0 - datetime.timedelta(days=1)).replace(day=1)
    months = [(prev0.isoformat(), (cur0 - datetime.timedelta(days=1)).isoformat()), (cur0.isoformat(), E)]

    work = tempfile.mkdtemp()
    data, raw, out1, out2 = (os.path.join(work, x) for x in ('data', 'raw', 'out1', 'out2'))
    os.makedirs(data)
    os.makedirs(raw)
    decrypt_all(os.path.join(o.repo, 'data'), data, base64.b64decode(key_b64))
    ex = load(os.path.join(HERE, 'refresh_extra.py'), 'refresh_extra')

    done = []
    if o.raw:
        for f in glob.glob(os.path.join(o.raw, '*.json')):
            shutil.copy(f, raw)
        done = ['raw']
    else:
        for name, fn, need in (('Meta', lambda: meta(raw, S, E, months, today, dict(ex.PIXEL_CLIENT)), ['META_TOKEN']),
                               ('Google Ads', lambda: google(raw, S, E, months), ['GADS_SA_KEY'] if os.environ.get('GADS_SA_KEY') else ['GADS_SA_KEY (or GADS_CLIENT_ID + GADS_CLIENT_SECRET + GADS_REFRESH_TOKEN)']),
                               ('TikTok', lambda: tiktok(raw, S, E, months), ['TIKTOK_TOKEN'])):
            missing = [v for v in need if not os.environ.get(v.split(' ')[0])]
            if missing:
                warn(f'{name} skipped', 'secret(s) not set yet: ' + ', '.join(missing))
                continue
            before = set(os.listdir(raw))
            try:
                fn()
                done.append(name)
                print(name, 'pulled')
            except Exception as e:
                for f in set(os.listdir(raw)) - before:  # drop this platform's partial answers
                    os.remove(os.path.join(raw, f))
                warn(f'{name} skipped', f'{type(e).__name__}: {e}')
    if not done:
        print('Nothing pulled - site data unchanged')
        return

    run('refresh_merge.py', '--data', data, '--raw', raw, '--start', S, '--end', E, '--out', out1)
    for f in glob.glob(os.path.join(data, '*.json')):
        if not os.path.exists(os.path.join(out1, os.path.basename(f))):
            shutil.copy(f, out1)
    run('refresh_extra.py', '--data', out1, '--raw', raw, '--out', out2)
    for f in glob.glob(os.path.join(out1, '*.json')):
        if not os.path.exists(os.path.join(out2, os.path.basename(f))):
            shutil.copy(f, out2)
    for n in ('meta_daily', 'google_daily', 'tiktok_daily', 'programmatic_daily', 'ga4_daily'):
        b, a = latest(os.path.join(data, n + '.json')), latest(os.path.join(out2, n + '.json'))
        print(n, 'latest day', b, '->', a)
        if a < b:
            raise SystemExit(f'{n} would go back from {b} to {a} - site data left unchanged')
    site = load(os.path.join(HERE, 'build_site.py'), 'build_site')
    print('OK - site data encrypted, latest day', site.encrypt_all(out2, os.path.join(o.repo, 'data'), key_b64, os.environ.get('PD_TEAM_PASSWORD') or None))


if __name__ == '__main__':
    try:
        if not os.environ.get('PD_DATA_KEY'):
            raise SystemExit('PD_DATA_KEY is not set')
        main()
    except BaseException as e:
        if isinstance(e, SystemExit) and e.code in (0, None):
            raise
        print(f'::error title=Ad refresh failed::{type(e).__name__}: {str(e)[:900]}')
        sys.exit(1)

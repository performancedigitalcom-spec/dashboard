"""One-time TikTok for Business connection.

tools/tiktok.enc holds the app credentials (and, after connecting, the long-term access token),
encrypted with the site data key (PD_DATA_KEY), so nothing readable sits in the public repo.

  python tools/tiktok_connect.py --set-app APP_ID SECRET     (local, writes the app credentials)
  AUTH_CODE=... python tools/tiktok_connect.py               (GitHub Actions: exchanges the code for the token)
"""
import argparse, base64, gzip, json, os, re, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, 'tiktok.enc')
URL = 'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/'


def key():
    return base64.b64decode(os.environ['PD_DATA_KEY'])


def read():
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    if not os.path.exists(PATH):
        return {}
    raw = open(PATH, 'rb').read()
    return json.loads(gzip.decompress(AESGCM(key()).decrypt(raw[:12], raw[12:], None)))


def write(d):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    n = os.urandom(12)
    open(PATH, 'wb').write(n + AESGCM(key()).encrypt(n, gzip.compress(json.dumps(d).encode()), None))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--set-app', nargs=2, metavar=('APP_ID', 'SECRET'))
    o = ap.parse_args()
    d = read()
    if o.set_app:
        d.update(app_id=o.set_app[0], secret=o.set_app[1])
        write(d)
        print('app credentials saved')
        return
    code = os.environ.get('AUTH_CODE', '').strip()
    m = re.search(r'auth_code=([^&\s]+)', code)
    code = m.group(1) if m else code
    if not code:
        sys.exit('AUTH_CODE is empty')
    req = urllib.request.Request(URL, data=json.dumps({'app_id': d['app_id'], 'secret': d['secret'], 'auth_code': code}).encode(),
                                 headers={'Content-Type': 'application/json'})
    r = json.load(urllib.request.urlopen(req, timeout=60))
    if r.get('code') != 0:
        sys.exit(f"TikTok refused the code: {r.get('code')} {r.get('message')}")
    data = r['data']
    d.update(token=data['access_token'], advertisers=data.get('advertiser_ids', []))
    write(d)
    print('Connected. Advertisers authorized:', ', '.join(map(str, d['advertisers'])))


if __name__ == '__main__':
    main()

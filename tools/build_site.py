#!/usr/bin/env python3
"""Build or refresh the standalone PD Client Performance site (GitHub Pages).

  python3 build_site.py --repo DIR --data DIR --password PW [--page DIR] [--assets DIR]

--repo    the cloned GitHub Pages repo (site root)
--data    folder with campaigns.json, meta_daily.json, google_daily.json, tiktok_daily.json,
          programmatic_daily.json, ga4_daily.json, monthly.json, ads_monthly.json, meta_pixels.json
--password  the team password; every data file is gzipped and encrypted with AES-256-GCM
          (key from PBKDF2-SHA256), so the public repo never holds readable client data.
--page    (full build only) folder with the dashboard's index.html, calcs.js, render.js, extras.js, pdf.js
--assets  (full build only) folder with shim.js, pd-display.woff2, pd-text.woff2, mark.png
Without --page only the data is re-encrypted (the daily refresh).
"""
import argparse, base64, datetime, gzip, json, os, re, secrets, sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

NAMES = ['campaigns', 'meta_daily', 'google_daily', 'tiktok_daily', 'programmatic_daily', 'ga4_daily', 'monthly', 'ads_monthly', 'meta_pixels']
ITER = 210000

TOKENS = """
:root { color-scheme: light; }
html, body { margin: 0; background: #F4F6F9; }
body { padding: 28px clamp(16px, 4vw, 48px) 48px; }
#dash-root { max-width: 1320px; margin: 0 auto;
  --color-fg: #0F172A; --color-fg-muted: #64748B; --color-panel: #FFFFFF; --color-bg: #F4F6F9; --color-border-line: #E3E7ED;
  --color-ok: #15803D; --color-warn: #B45309; --color-bad: #C62828;
  --cds-chart-grid: #EEF1F5; --cds-chart-axis: #CBD5E1; --cds-surface-popover: #FFFFFF; --cds-border: #E3E7ED; --cds-text-secondary: #64748B;
  --cds-shadow-popover: 0 8px 24px -8px rgba(15,23,42,.25);
  --cds-gap-xs: 4px; --cds-gap-sm: 8px; --cds-gap-md: 16px; --cds-gap-lg: 24px; --cds-pad-xs: 4px; --cds-pad-sm: 8px; --cds-pad-md: 12px; --cds-pad-lg: 16px; --cds-radius: 8px;
  --cds-font-size-caption: 12px; --cds-font-size-body: 14px; --cds-font-size-heading: 17px; --cds-font-size-title: 30px; --cds-font-weight-medium: 600; --cds-dur-slow: .3s;
  --font-anthropic-sans: 'PD Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; --font-anthropic-serif: 'PD Display', 'PD Text', sans-serif;
  color: var(--color-fg); }
#dash-root * { box-sizing: border-box; }
.dash-skeleton { color: transparent !important; background: linear-gradient(90deg, #EEF1F5 25%, #F7F8FA 50%, #EEF1F5 75%); background-size: 200% 100%; animation: pd-skel 1.2s infinite; border-radius: 6px; }
@keyframes pd-skel { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }
[hidden] { display: none !important; }
.pd-gate { position: fixed; inset: 0; z-index: 80; display: flex; align-items: center; justify-content: center; padding: 16px; background: radial-gradient(1200px 600px at 20% 0%, #E6F1FB 0%, #F4F6F9 55%); }
.pd-gate form { width: min(380px, 100%); background: #fff; border: 1px solid #E3E7ED; border-radius: 20px; padding: 32px 28px 26px; box-shadow: 0 24px 60px -24px rgba(15,23,42,.35); display: flex; flex-direction: column; gap: 14px; font-family: 'PD Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color: #0F172A; }
.pd-gate img { width: 190px; align-self: center; margin-bottom: 6px; }
.pd-gate h1 { margin: 0; text-align: center; font-family: 'PD Display', 'PD Text', -apple-system, 'Segoe UI', Arial, sans-serif; font-weight: 800; font-size: 20px; letter-spacing: -.02em; }
.pd-gate p { margin: -6px 0 4px; text-align: center; color: #64748B; font-size: 13px; }
.pd-gate input[type=password] { font: inherit; font-size: 15px; padding: 12px 14px; border: 1px solid #CBD5E1; border-radius: 12px; outline: none; }
.pd-gate input[type=password]:focus { border-color: #1B75BC; box-shadow: 0 0 0 4px rgba(27,117,188,.15); }
.pd-gate label { display: flex; gap: 8px; align-items: center; font-size: 13px; color: #475569; }
.pd-gate button { font: inherit; font-weight: 700; font-size: 15px; padding: 12px; border: 0; border-radius: 12px; background: #1B75BC; color: #fff; cursor: pointer; }
.pd-gate button:disabled { opacity: .6; cursor: progress; }
.pd-gate .err { min-height: 1.2em; color: #C62828; font-size: 13px; text-align: center; margin: -4px 0 0; }
.pd-foot { max-width: 1320px; margin: 24px auto 0; font-family: 'PD Text', -apple-system, 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #94A3B8; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.pd-foot a { color: #64748B; }
"""


def encrypt_all(data_dir, out_dir, password):
    os.makedirs(out_dir, exist_ok=True)
    salt = secrets.token_bytes(16)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(password.encode())
    aes = AESGCM(key)
    def put(name, obj):
        iv = secrets.token_bytes(12)
        blob = gzip.compress(json.dumps(obj, separators=(',', ':')).encode(), 9)
        open(os.path.join(out_dir, name + '.enc'), 'wb').write(iv + aes.encrypt(iv, blob, None))
    latest = ''
    for n in NAMES:
        obj = json.load(open(os.path.join(data_dir, n + '.json')))
        if n.endswith('_daily'):
            latest = max([latest] + [r['d'] for r in obj if 'd' in r])
        put(n, obj)
    put('check', {'ok': True})
    now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    json.dump({'salt': base64.b64encode(salt).decode(), 'iterations': ITER, 'version': now.replace(':', ''), 'updated': now, 'latest': latest},
              open(os.path.join(out_dir, 'meta.json'), 'w'))
    return latest


def full_build(repo, page, assets):
    os.makedirs(os.path.join(repo, 'app'), exist_ok=True)
    os.makedirs(os.path.join(repo, 'fonts'), exist_ok=True)
    for f in ('calcs.js', 'render.js', 'extras.js', 'pdf.js'):
        open(os.path.join(repo, 'app', f), 'w').write(open(os.path.join(page, f)).read())
    open(os.path.join(repo, 'app', 'shim.js'), 'w').write(open(os.path.join(assets, 'shim.js')).read())
    open(os.path.join(repo, 'app', 'fonts.js'), 'w').write(
        "(function(){var s=document.createElement('style');s.textContent=\"@font-face{font-family:'PD Display';font-weight:200 800;font-display:swap;src:url('fonts/pd-display.woff2') format('woff2')}@font-face{font-family:'PD Text';font-weight:100 900;font-display:swap;src:url('fonts/pd-text.woff2') format('woff2')}\";document.head.appendChild(s);})();\n")
    for f in ('pd-display.woff2', 'pd-text.woff2'):
        open(os.path.join(repo, 'fonts', f), 'wb').write(open(os.path.join(assets, f), 'rb').read())
    mark = 'data:image/png;base64,' + base64.b64encode(open(os.path.join(assets, 'mark.png'), 'rb').read()).decode()
    body = open(os.path.join(page, 'index.html')).read()
    body = re.sub(r'\s*<script src="[^"]+"></script>', '', body)
    logo = re.search(r'id="pd-logo" alt="[^"]*" src="([^"]+)"', body).group(1)
    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>PD Client Performance</title>
<link rel="icon" href="{mark}">
<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>
<script src="app/fonts.js"></script>
<style>{TOKENS}</style>
</head>
<body>
<div class="pd-gate" id="pd-gate" hidden>
  <form id="pd-gate-form" autocomplete="on">
    <img src="{logo}" alt="Performance Digital">
    <h1>Client Performance</h1>
    <p>Enter the team password to open the dashboard.</p>
    <input type="text" name="username" value="pd-dashboard" autocomplete="username" hidden>
    <input type="password" id="pd-gate-pw" autocomplete="current-password" placeholder="Password" required>
    <label><input type="checkbox" id="pd-gate-remember" checked> Remember me on this device</label>
    <button type="submit">Open dashboard</button>
    <div class="err" id="pd-gate-err" role="alert"></div>
  </form>
</div>
<div id="dash-root">
{body}
</div>
<div class="pd-foot"><span id="pd-updated"></span><a href="#" id="pd-signout">Sign out on this device</a></div>
<script src="app/shim.js"></script>
<script src="app/calcs.js"></script>
<script src="app/render.js"></script>
<script src="app/extras.js"></script>
<script src="app/pdf.js"></script>
<script>
document.getElementById('pd-signout').addEventListener('click', function (e) {{ e.preventDefault(); try {{ localStorage.removeItem('pd-dash-key'); }} catch (x) {{}} location.reload(); }});
dash.onData(function () {{ var u = window.PD_UPDATED; if (u) document.getElementById('pd-updated').textContent = 'Data refreshed ' + new Date(u).toLocaleString('en-US', {{ dateStyle: 'medium', timeStyle: 'short' }}); }});
</script>
</body>
</html>
"""
    open(os.path.join(repo, 'index.html'), 'w').write(html)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', required=True)
    ap.add_argument('--data', required=True)
    ap.add_argument('--password', required=True)
    ap.add_argument('--page')
    ap.add_argument('--assets')
    o = ap.parse_args()
    if o.page:
        full_build(o.repo, o.page, o.assets)
    latest = encrypt_all(o.data, os.path.join(o.repo, 'data'), o.password)
    print('OK - site data encrypted, latest day', latest)


if __name__ == '__main__':
    main()

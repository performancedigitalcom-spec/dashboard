"""Assign (or rename) the client for one or more campaigns in the encrypted site data.

  CAMPAIGN_IDS="123,456" CLIENT="Prairie Sage" python tools/assign_client.py --repo .
Runs in GitHub Actions with PD_DATA_KEY / PD_TEAM_PASSWORD, so no key is needed locally.
"""
import argparse, base64, json, os, shutil, sys, tempfile, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, name + '.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', default='.')
    o = ap.parse_args()
    ids = {x.strip() for x in os.environ.get('CAMPAIGN_IDS', '').split(',') if x.strip()}
    client = os.environ.get('CLIENT', '').strip()
    if not ids or not client:
        sys.exit('CAMPAIGN_IDS and CLIENT are required')
    key_b64 = os.environ['PD_DATA_KEY']
    ar, site = load('ads_refresh'), load('build_site')
    tmp = tempfile.mkdtemp()
    ar.decrypt_all(os.path.join(o.repo, 'data'), tmp, base64.b64decode(key_b64))
    p = os.path.join(tmp, 'campaigns.json')
    camps = json.load(open(p))
    hit = 0
    for c in camps:
        if str(c.get('campaign_id')) in ids:
            print(f"{c['platform']} {c['campaign_id']} \"{c.get('campaign')}\": {c.get('client')} -> {client}")
            c['client'] = client
            hit += 1
    missing = ids - {str(c.get('campaign_id')) for c in camps}
    if missing:
        sys.exit('Not found in site data: ' + ', '.join(sorted(missing)))
    json.dump(camps, open(p, 'w'))
    print('OK -', hit, 'campaign(s) updated; latest day', site.encrypt_all(tmp, os.path.join(o.repo, 'data'), key_b64, os.environ.get('PD_TEAM_PASSWORD') or None))
    shutil.rmtree(tmp)


if __name__ == '__main__':
    main()

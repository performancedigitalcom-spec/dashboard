"""Refresh the warehouse-based parts of the colleague site straight from BigQuery.

Runs in GitHub Actions every morning (see .github/workflows/bigquery-refresh.yml), independent of
Claude's connectors, so programmatic (Illumin), GA4 and CTV network / household income data stay
current even when a Claude connector has been signed out.

Steps: decrypt the site's current data -> run the warehouse queries from refresh_extra.py with a
service account -> merge with refresh_extra.py -> sanity checks -> re-encrypt into data/.

Environment: PD_DATA_KEY (base64 data key), PD_TEAM_PASSWORD (optional, keeps the team-password
sign-in working), GOOGLE_APPLICATION_CREDENTIALS (service-account JSON file).
Use --raw DIR to skip BigQuery and use saved answers instead (for testing).
"""
import argparse, base64, glob, gzip, importlib.util, json, os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = 'pd-client-analytics'


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def decrypt_all(data_dir, out_dir, key):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    aes = AESGCM(key)
    for fn in glob.glob(os.path.join(data_dir, '*.enc')):
        name = os.path.basename(fn)[:-4]
        if name == 'check':
            continue
        raw = open(fn, 'rb').read()
        obj = json.loads(gzip.decompress(aes.decrypt(raw[:12], raw[12:], None)))
        json.dump(obj, open(os.path.join(out_dir, name + '.json'), 'w'), separators=(',', ':'))


def run_queries(ex, raw_dir):
    from google.cloud import bigquery
    client = bigquery.Client(project=PROJECT)
    for fname, q in (('bq_illumin.json', ex.QUERY_ILLUMIN), ('bq_demo.json', ex.QUERY_DEMO), ('bq_ga4.json', ex.QUERY_GA4),
                     ('bq_creatives.json', ex.QUERY_CREATIVES), ('bq_ctv.json', ex.QUERY_CTV)):
        try:
            rows = client.query(q).result()
        except Exception as e:  # keep that part's previous data, carry on with the rest
            msg = str(e).replace('\n', ' ')[:600]
            print(f'::warning title={fname} skipped::{type(e).__name__}: {msg}')
            continue
        out = {'jobComplete': True, 'rows': [{'f': [{'v': None if v is None else str(v)} for v in r.values()]} for r in rows]}
        json.dump(out, open(os.path.join(raw_dir, fname), 'w'))
        print('queried', fname, len(out['rows']), 'rows')


def latest(path):
    d = json.load(open(path))
    return max((r['d'] for r in d if 'd' in r), default='')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', default=os.path.dirname(HERE))
    ap.add_argument('--raw', help='use saved BigQuery answers from this folder instead of querying')
    o = ap.parse_args()
    key_b64 = os.environ['PD_DATA_KEY']
    key = base64.b64decode(key_b64)
    work = tempfile.mkdtemp()
    data, raw, out = (os.path.join(work, x) for x in ('data', 'raw', 'out'))
    for d in (data, raw):
        os.makedirs(d)
    decrypt_all(os.path.join(o.repo, 'data'), data, key)
    ex = load(os.path.join(HERE, 'refresh_extra.py'), 'refresh_extra')
    if o.raw:
        for f in glob.glob(os.path.join(o.raw, 'bq_*.json')):
            shutil.copy(f, raw)
    else:
        run_queries(ex, raw)
    r = subprocess.run([sys.executable, '-I', os.path.join(HERE, 'refresh_extra.py'), '--data', data, '--raw', raw, '--out', out], capture_output=True, text=True)
    print(r.stdout, r.stderr)
    if r.returncode != 0:
        sys.exit('refresh_extra failed - site data left unchanged')
    for f in glob.glob(os.path.join(data, '*.json')):
        if not os.path.exists(os.path.join(out, os.path.basename(f))):
            shutil.copy(f, out)
    # never move backwards
    if not glob.glob(os.path.join(raw, 'bq_*.json')):
        sys.exit('no BigQuery answers - site data left unchanged')
    for n in ('programmatic_daily', 'ga4_daily'):
        before, after = latest(os.path.join(data, n + '.json')), latest(os.path.join(out, n + '.json'))
        print(n, 'latest day', before, '->', after)
        if after < before:
            sys.exit(f'{n} would go back from {before} to {after} - site data left unchanged')
    site = load(os.path.join(HERE, 'build_site.py'), 'build_site')
    print('OK - site data encrypted, latest day', site.encrypt_all(out, os.path.join(o.repo, 'data'), key_b64, os.environ.get('PD_TEAM_PASSWORD') or None))


if __name__ == '__main__':
    try:
        for v in ('PD_DATA_KEY', 'GOOGLE_APPLICATION_CREDENTIALS'):
            if not os.environ.get(v):
                raise SystemExit(f'{v} is not set')
        cred = os.environ['GOOGLE_APPLICATION_CREDENTIALS']
        if not (os.path.exists(cred) and os.path.getsize(cred) > 100):
            raise SystemExit('service-account key (GCP_SA_KEY secret) is empty or missing')
        main()
    except BaseException as e:  # surface the reason as a GitHub annotation (no secrets in messages)
        if isinstance(e, SystemExit) and e.code in (0, None):
            raise
        msg = (str(e) or type(e).__name__).replace('\n', ' ')[:900]
        print(f'::error title=BigQuery refresh failed::{type(e).__name__}: {msg}')
        sys.exit(1)

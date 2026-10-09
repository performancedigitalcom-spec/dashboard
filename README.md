# PD Client Performance

Live client dashboard for Performance Digital: Meta, Google Ads, TikTok, programmatic (Illumin) and GA4.

- Open it at the GitHub Pages address for this repo and enter the team password.
- Data refreshes every morning (~7:50am ET) from the ad platforms and the PD reporting warehouse.
- Every file in `data/` is encrypted (AES-256-GCM, key derived from the team password), so nothing readable is stored in this repo.
- `tools/build_site.py` rebuilds the site or re-encrypts fresh data. `old/` holds the previous dashboard.

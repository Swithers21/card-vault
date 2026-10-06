#!/usr/bin/env python3
"""One-off look, round 5: may another website read the shops' search and collection data? (temporary)"""
import json, os, time, urllib.request, urllib.error, urllib.parse
OUT = "probe-out5"
os.makedirs(OUT, exist_ok=True)
UA_BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1"
URLS = [
  ("goc_suggest", "https://godofcards.com/en-int/search/suggest.json?q=phantom%20nightmare%20korean&resources%5Btype%5D=product&resources%5Blimit%5D=10", 90),
  ("ym_suggest", "https://yugi-market.com/search/suggest.json?q=phantom%20nightmare&resources%5Btype%5D=product&resources%5Blimit%5D=10", 90),
  ("ym_collections", "https://yugi-market.com/collections.json?limit=250", 90),
  ("ym_box", "https://yugi-market.com/collections/yu-gi-oh-box/products.json?limit=250", 90),
  ("goc_suggest_box", "https://godofcards.com/en-int/search/suggest.json?q=korean%20booster%20box&resources%5Btype%5D=product&resources%5Blimit%5D=10", 90),
]
summary = {}
for key, url, gap in URLS:
    time.sleep(gap)
    req = urllib.request.Request(url, headers={"User-Agent": UA_BROWSER, "Accept": "application/json, */*;q=0.8", "Origin": "https://swithers21.github.io",
                                               "Accept-Language": "en-US,en;q=0.9", "Referer": "https://swithers21.github.io/", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Site": "cross-site"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            status, headers, body = r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        status, headers, body = e.code, dict(e.headers or {}), e.read()
    except Exception as e:
        status, headers, body = 0, {}, str(e).encode()
    summary[key] = {"url": url, "status": status, "headers": headers, "bytes": len(body)}
    open(os.path.join(OUT, key + ".txt"), "wb").write(body[:400000])
    print(key, status, len(body), flush=True)
json.dump(summary, open(os.path.join(OUT, "summary.json"), "w"), ensure_ascii=False, indent=1)

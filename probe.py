#!/usr/bin/env python3
"""One-off look at the Japanese and Korean shop data, round 4 (temporary workflow; not part of Card Vault)."""
import json, os, time, urllib.request, urllib.error, urllib.parse
OUT = "probe-out4"
os.makedirs(OUT, exist_ok=True)
UA_APP = "CardVault/1.0 (personal collection tracker; one-off check)"
UA_BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"
def yp(query):
    return "https://yugipedia.com/api.php?" + urllib.parse.urlencode({"action": "ask", "format": "json", "formatversion": "2", "query": query})
URLS = [
  ("goc_kr_int", "https://godofcards.com/en-int/collections/korean-yugioh-cards/products.json?limit=250", UA_BROWSER, 75),
  ("goc_cart_int", "https://godofcards.com/en-int/cart.js", UA_BROWSER, 75),
  ("ym_collections", "https://yugi-market.com/collections.json?limit=250", UA_BROWSER, 75),
  ("goc_kr_us", "https://godofcards.com/en-us/collections/korean-yugioh-cards/products.json?limit=250", UA_BROWSER, 75),
  ("bw_set_p2", "https://api.bigweb.co.jp/products?game_id=9&cardsets=7858&page=2", UA_APP, 2),
  ("bw_sealed", "https://api.bigweb.co.jp/products?game_id=9&cardsets=6671", UA_APP, 2),
  ("yp_jp_index", yp("[[Japanese set prefix::+]]|?Japanese set prefix|?Japanese release date|?Korean set prefix|?Korean release date|?Set type|?Series|?Japanese name|sort=Japanese release date|order=desc|limit=500"), UA_APP, 2),
  ("yp_jp_index2", yp("[[Japanese set prefix::+]]|?Japanese set prefix|?Japanese release date|sort=Japanese release date|order=desc|limit=500|offset=500"), UA_APP, 2),
  ("yp_kr_index", yp("[[Korean set prefix::+]]|?Korean set prefix|?Korean release date|?Japanese set prefix|?Set type|?Series|?Korean name|sort=Korean release date|order=desc|limit=500"), UA_APP, 2),
]
def get(url, ua):
    req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "application/json, */*;q=0.8", "Origin": "https://swithers21.github.io",
                                               "Api-User-Agent": UA_APP, "Accept-Language": "en-US,en;q=0.9"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers or {}), e.read()
    except Exception as e:
        return 0, {}, str(e).encode()
summary = {}
for key, url, ua, gap in URLS:
    time.sleep(gap)
    status, headers, body = get(url, ua)
    keep = {k: v for k, v in headers.items() if k.lower() in ("content-type", "access-control-allow-origin", "retry-after")}
    info = {"url": url, "status": status, "headers": keep, "bytes": len(body)}
    text = body.decode("utf-8", "replace")
    try:
        j = json.loads(text)
        with open(os.path.join(OUT, key + ".json"), "w") as f: json.dump(j, f, ensure_ascii=False, indent=1)
    except Exception:
        with open(os.path.join(OUT, key + ".txt"), "w") as f: f.write(text[:400000])
    summary[key] = info
    print(key, status, len(body), flush=True)
json.dump(summary, open(os.path.join(OUT, "summary.json"), "w"), ensure_ascii=False, indent=1)

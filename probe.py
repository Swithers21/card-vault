#!/usr/bin/env python3
"""One-off look at the Japanese and Korean shop data, round 2 (temporary workflow; not part of Card Vault)."""
import json, os, time, urllib.request, urllib.error, urllib.parse
OUT = "probe-out2"
os.makedirs(OUT, exist_ok=True)
UA_APP = "CardVault/1.0 (personal collection tracker; one-off check)"
UA_BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"
def yp(query):
    return "https://yugipedia.com/api.php?" + urllib.parse.urlencode({"action": "ask", "format": "json", "formatversion": "2", "query": query})
URLS = [
  # Shopify, gently: a browser-like request with an Origin, long gaps
  ("ym_box_ua", "https://yugi-market.com/collections/yu-gi-oh-booster-box/products.json?limit=250", UA_BROWSER, 20),
  ("ym_box_myshop", "https://yugi-market.myshopify.com/collections/yu-gi-oh-booster-box/products.json?limit=250", UA_BROWSER, 20),
  ("ym_atom", "https://yugi-market.com/collections/yu-gi-oh-booster-box.atom", UA_BROWSER, 20),
  ("ym_sitemap", "https://yugi-market.com/sitemap.xml", UA_BROWSER, 20),
  ("goc_kr_ua", "https://godofcards.com/collections/korean-yugioh-cards/products.json?limit=250", UA_BROWSER, 20),
  ("goc_kr_app", "https://godofcards.com/collections/korean-yugioh-cards/products.json?limit=250", UA_APP, 20),
  # BIGWEB: one set sorted by price, the sealed listings
  ("bw_set_sorted", "https://api.bigweb.co.jp/products?game_id=9&cardset_id=7858&sort=price&direction=desc&limit=30", UA_APP, 2),
  ("bw_set_plain", "https://api.bigweb.co.jp/products?game_id=9&cardset_id=7858", UA_APP, 2),
  ("bw_sealed", "https://api.bigweb.co.jp/products?game_id=9&cardset_id=6671", UA_APP, 2),
  ("bw_sealed_old", "https://api.bigweb.co.jp/products?game_id=9&cardset_id=6985", UA_APP, 2),
  ("bw_sealed_sorted", "https://api.bigweb.co.jp/products?game_id=9&cardset_id=6671&sort=price&direction=desc&limit=100", UA_APP, 2),
  # Yugipedia: sets with their prefixes and release dates
  ("yp_ocg_sets", yp("[[Category:OCG sets]][[Japanese release date::+]]|?Japanese release date|?Set prefix|?Korean release date|?English name|sort=Japanese release date|order=desc|limit=200"), UA_APP, 2),
  ("yp_kr_sets", yp("[[Korean release date::+]]|?Korean release date|?Set prefix|?Japanese release date|sort=Korean release date|order=desc|limit=200"), UA_APP, 2),
  ("yp_kr_list", yp("[[Card number::~PHNI-KR*]]|?Card number|?Rarity|?Set contains|limit=500"), UA_APP, 2),
  # Bunjang: one set, more listings, newest first
  ("bj_set_date", "https://api.bunjang.co.kr/api/1/find_v2.json?q=PHNI-KR&order=date&page=0&n=200", UA_APP, 2),
  ("bj_set_p1", "https://api.bunjang.co.kr/api/1/find_v2.json?q=PHNI-KR&order=score&page=1&n=100", UA_APP, 2),
]
def get(url, ua):
    req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "application/json, */*;q=0.8", "Origin": "https://swithers21.github.io",
                                               "Api-User-Agent": UA_APP, "Accept-Language": "en-US,en;q=0.9"})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers or {}), e.read()
    except Exception as e:
        return 0, {}, str(e).encode()
summary = {}
for key, url, ua, gap in URLS:
    time.sleep(gap)
    status, headers, body = get(url, ua)
    keep = {k: v for k, v in headers.items() if k.lower() in ("content-type", "access-control-allow-origin", "retry-after", "x-shopify-stage", "server", "cf-ray")}
    info = {"url": url, "status": status, "headers": keep, "bytes": len(body)}
    text = body.decode("utf-8", "replace")
    try:
        j = json.loads(text)
        if isinstance(j, dict) and isinstance(j.get("products"), list):
            info["n_products"] = len(j["products"])
        with open(os.path.join(OUT, key + ".json"), "w") as f:
            json.dump(j, f, ensure_ascii=False, indent=1)
    except Exception:
        with open(os.path.join(OUT, key + ".txt"), "w") as f:
            f.write(text[:400000])
    summary[key] = info
    print(key, status, len(body), flush=True)
json.dump(summary, open(os.path.join(OUT, "summary.json"), "w"), ensure_ascii=False, indent=1)

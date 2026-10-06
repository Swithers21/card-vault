#!/usr/bin/env python3
"""One-off look at the Japanese and Korean shop data (run by a temporary workflow; not part of Card Vault)."""
import json, os, sys, time, urllib.request, urllib.error, urllib.parse
OUT = "probe-out"
os.makedirs(OUT, exist_ok=True)
UA = "CardVault/1.0 (personal collection tracker; one-off check)"
URLS = {
  "ym_meta": "https://yugi-market.com/meta.json",
  "ym_collections": "https://yugi-market.com/collections.json?limit=250",
  "ym_boosterbox": "https://yugi-market.com/collections/yu-gi-oh-booster-box/products.json?limit=250",
  "ym_box": "https://yugi-market.com/collections/yu-gi-oh-box/products.json?limit=250",
  "ym_singles1": "https://yugi-market.com/collections/yu-gi-oh-single-cards/products.json?limit=250&page=1",
  "ym_singles2": "https://yugi-market.com/collections/yu-gi-oh-single-cards/products.json?limit=250&page=2",
  "ym_all1": "https://yugi-market.com/products.json?limit=250&page=1",
  "goc_meta": "https://godofcards.com/meta.json",
  "goc_collections": "https://godofcards.com/collections.json?limit=250",
  "goc_kr": "https://godofcards.com/collections/korean-yugioh-cards/products.json?limit=250",
  "goc_kr_int": "https://godofcards.com/en-int/collections/korean-yugioh-cards/products.json?limit=250",
  "goc_kr_us": "https://godofcards.com/en-us/collections/korean-yugioh-cards/products.json?limit=250",
  "goc_kr_page": "https://godofcards.com/en-int/collections/korean-yugioh-cards",
  "bw_name_code": "https://api.bigweb.co.jp/products?game_id=9&name=DUNE-JP004",
  "bw_name_prefix": "https://api.bigweb.co.jp/products?game_id=9&name=PHNI-JP",
  "bw_cardsets": "https://api.bigweb.co.jp/cardsets?game_id=9",
  "bw_cardsets2": "https://api.bigweb.co.jp/cardsets?game_id=9&limit=2000",
  "bw_games_cardsets": "https://api.bigweb.co.jp/games/9/cardsets",
  "bw_products_page": "https://api.bigweb.co.jp/products?game_id=9&page=1",
  "bj_set": "https://api.bunjang.co.kr/api/1/find_v2.json?q=PHNI-KR&order=score&page=0&n=100",
  "bj_set_box": "https://api.bunjang.co.kr/api/1/find_v2.json?q=%EC%9C%A0%ED%9D%AC%EC%99%95%20%EB%B6%80%EC%8A%A4%ED%84%B0%20%EB%B0%95%EC%8A%A4&order=score&page=0&n=60",
  "yp_set_ask": "https://yugipedia.com/api.php?" + urllib.parse.urlencode({"action": "ask", "format": "json", "formatversion": "2",
      "query": "[[Card number::~PHNI-JP*]]|?Card number|?Rarity|?Set contains|limit=500"}),
  "yp_kr_ask": "https://yugipedia.com/api.php?" + urllib.parse.urlencode({"action": "ask", "format": "json", "formatversion": "2",
      "query": "[[Card number::~PHNI-KR*]]|?Card number|?Rarity|limit=500"}),
  "yp_jp_sets_cat": "https://yugipedia.com/api.php?" + urllib.parse.urlencode({"action": "query", "format": "json", "formatversion": "2",
      "list": "categorymembers", "cmtitle": "Category:OCG sets", "cmlimit": "50"}),
  "yp_set_page_ask": "https://yugipedia.com/api.php?" + urllib.parse.urlencode({"action": "ask", "format": "json", "formatversion": "2",
      "query": "[[Category:OCG sets]][[Japanese release date::+]]|?Japanese release date|?Set prefix|?Japanese name|?Korean release date|sort=Japanese release date|order=desc|limit=30"}),
}
def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json, text/html;q=0.8", "Api-User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers or {}), e.read()
    except Exception as e:
        return 0, {}, str(e).encode()
summary = {}
for key, url in URLS.items():
    status, headers, body = get(url)
    keep = {k: v for k, v in headers.items() if k.lower() in ("content-type", "access-control-allow-origin", "x-shopid", "content-length")}
    text = body.decode("utf-8", "replace")
    info = {"url": url, "status": status, "headers": keep, "bytes": len(body)}
    try:
        j = json.loads(text)
        if isinstance(j, dict) and isinstance(j.get("products"), list):
            info["n_products"] = len(j["products"])
            info["titles"] = [p.get("title") for p in j["products"]][:400]
        if isinstance(j, dict) and isinstance(j.get("collections"), list):
            info["collections"] = [[c.get("handle"), c.get("title"), c.get("products_count")] for c in j["collections"]]
        if isinstance(j, dict) and isinstance(j.get("list"), list):
            info["n_list"] = len(j["list"])
            info["names"] = [[x.get("name"), x.get("price")] for x in j["list"]][:100]
        if isinstance(j, dict) and isinstance(j.get("items"), list):
            info["n_items"] = len(j["items"])
        with open(os.path.join(OUT, key + ".json"), "w") as f:
            json.dump(j, f, ensure_ascii=False, indent=1)
    except Exception:
        with open(os.path.join(OUT, key + ".txt"), "w") as f:
            f.write(text[:300000])
    summary[key] = info
    print(key, status, len(body), flush=True)
    time.sleep(1.5)
# BIGWEB: follow up on whatever the cardsets listing gave
try:
    cs = json.load(open(os.path.join(OUT, "bw_cardsets.json")))
    items = cs.get("items") if isinstance(cs, dict) else cs
    if items:
        first = items[0]
        sid = first.get("id")
        for key, url in {"bw_set_products": "https://api.bigweb.co.jp/products?game_id=9&cardset_id=%s" % sid,
                         "bw_set_products2": "https://api.bigweb.co.jp/products?game_id=9&cardset_id=%s&page=2" % sid}.items():
            status, headers, body = get(url)
            open(os.path.join(OUT, key + ".txt"), "wb").write(body[:400000])
            summary[key] = {"url": url, "status": status, "bytes": len(body)}
            time.sleep(1.5)
except Exception as e:
    summary["bw_followup_error"] = str(e)
json.dump(summary, open(os.path.join(OUT, "summary.json"), "w"), ensure_ascii=False, indent=1)

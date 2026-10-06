#!/usr/bin/env python3
"""One-off look at the Japanese and Korean shop data, round 3 (temporary workflow; not part of Card Vault)."""
import json, os, time, urllib.request, urllib.error, urllib.parse
OUT = "probe-out3"
os.makedirs(OUT, exist_ok=True)
UA_APP = "CardVault/1.0 (personal collection tracker; one-off check)"
UA_BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"
BW = "https://api.bigweb.co.jp/products?game_id=9&"
URLS = [
  ("goc_kr_int", "https://godofcards.com/en-int/collections/korean-yugioh-cards/products.json?limit=250", UA_BROWSER, 5),
  ("ym_box", "https://yugi-market.com/collections/yu-gi-oh-booster-box/products.json?limit=250", UA_BROWSER, 65),
  ("goc_jp_try", "https://godofcards.com/en-int/collections/japanese-yugioh-cards/products.json?limit=250", UA_BROWSER, 65),
  ("ym_box2", "https://yugi-market.com/collections/yu-gi-oh-box/products.json?limit=250", UA_BROWSER, 65),
  ("bw_cardset", BW + "cardset=7858", UA_APP, 2),
  ("bw_cardsets", BW + "cardsets=7858", UA_APP, 2),
  ("bw_cardset_ids", BW + "cardset_ids=7858", UA_APP, 2),
  ("bw_cardset_arr", BW + "cardset_id%5B%5D=7858", UA_APP, 2),
  ("bw_cardsetid", BW + "cardsetid=7858", UA_APP, 2),
  ("bw_cardsetId", BW + "cardsetId=7858", UA_APP, 2),
  ("bw_cardset_id_str", BW + "cardset_id=7858&page=1", UA_APP, 2),
  ("bw_sealed_name", BW + "cardset=6671", UA_APP, 2),
  ("bw_sort1", BW + "name=PHNI-JP&sort=price&direction=desc", UA_APP, 2),
  ("bw_sort2", BW + "name=PHNI-JP&order=price_desc", UA_APP, 2),
  ("bw_sort3", BW + "name=PHNI-JP&sort=-price", UA_APP, 2),
  ("bw_limit", BW + "name=PHNI-JP&limit=200", UA_APP, 2),
  ("bw_box_word", BW + "name=" + urllib.parse.quote("ファントム・ナイトメア"), UA_APP, 2),
  ("yp_browse", "https://yugipedia.com/api.php?" + urllib.parse.urlencode({"action": "browsebysubject", "format": "json", "subject": "Phantom Nightmare"}), UA_APP, 2),
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
    keep = {k: v for k, v in headers.items() if k.lower() in ("content-type", "access-control-allow-origin", "retry-after")}
    info = {"url": url, "status": status, "headers": keep, "bytes": len(body)}
    text = body.decode("utf-8", "replace")
    try:
        j = json.loads(text)
        if isinstance(j, dict) and isinstance(j.get("products"), list): info["n_products"] = len(j["products"])
        if isinstance(j, dict) and isinstance(j.get("items"), list):
            info["n_items"] = len(j["items"]); info["count"] = (j.get("pagenate") or {}).get("count")
            info["first"] = [[i.get("fname"), i.get("name"), i.get("price"), (i.get("cardset") or {}).get("web")] for i in j["items"][:8]]
        with open(os.path.join(OUT, key + ".json"), "w") as f: json.dump(j, f, ensure_ascii=False, indent=1)
    except Exception:
        with open(os.path.join(OUT, key + ".txt"), "w") as f: f.write(text[:400000])
    summary[key] = info
    print(key, status, len(body), flush=True)
json.dump(summary, open(os.path.join(OUT, "summary.json"), "w"), ensure_ascii=False, indent=1)

"""One-time look at how Overframe cards (Limit Over Collection, LOCH/LOCR) show up in each source (round 6). Writes probe/out6.json."""
import json, re, time, urllib.error, urllib.parse, urllib.request
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 CardVault/1.0"
def get(url, headers=None):
    h = {"User-Agent": UA, "Accept": "*/*", "Accept-Language": "ja,en"}
    h.update(headers or {})
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=60) as r:
            return r.status, r.read(30000000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read(1500).decode("utf-8", "replace")
    except Exception as e:
        return 0, str(e)
def js(url, headers=None):
    s, t = get(url, headers)
    try:
        return s, json.loads(t)
    except ValueError:
        return s, t[:1500]
out = {}
# 1) Card Vault's own daily list, as built now
s, t = get("https://swithers21.github.io/card-vault/ocg-cards.js")
out["ocg_cards_status"] = s
try:
    raw = json.loads(t[t.index("=") + 1:].strip().rstrip(";"))
    rar = raw.get("rar") or []
    out["rar_all"] = rar
    names = raw.get("names") or []
    for region in ("jp", "kr"):
        for row in raw.get(region) or []:
            if row and str(row[0]) in ("LOCH", "LOCR", "QCAC", "RC04"):
                out["cards_%s_%s" % (region, row[0])] = [[c[0], names[c[1]] if isinstance(c[1], int) and c[1] < len(names) else c[1],
                                                          [[rar[x[0]] if isinstance(x[0], int) and x[0] < len(rar) else x[0]] + x[1:4] for x in c[2]]] for c in row[2][:25]]
except Exception as e:
    out["ocg_cards_error"] = repr(e)
s, t = get("https://swithers21.github.io/card-vault/ocg-market.js")
try:
    raw = json.loads(t[t.index("=") + 1:].strip().rstrip(";"))
    out["market_LOC"] = [r for region in ("jp", "kr") for r in raw.get(region) or [] if r and str(r[0]).startswith("LOC")]
except Exception as e:
    out["market_error"] = repr(e)
# 2) Yugipedia
YP = "https://yugipedia.com/api.php?"
def yp(params):
    params = dict(params, format="json", formatversion="2")
    time.sleep(1.5)
    return js(YP + urllib.parse.urlencode(params), {"Accept": "application/json"})[1]
out["yp_ask_LOCH"] = yp({"action": "ask", "query": "[[Card number::~LOCH-JP0*]]|?Card number|?Rarity|?Set contains|?Print|limit=60"})
out["yp_ask_LOCH_KR"] = yp({"action": "ask", "query": "[[Card number::~LOCH-KR*]]|?Card number|?Rarity|limit=5"})
out["yp_search_overframe"] = yp({"action": "query", "list": "search", "srsearch": "Overframe", "srlimit": "30"})
for title in ("Set Card Lists:Limit Over Collection: The Heroes (OCG-JP)", "Limit Over Collection: The Heroes", "Overframe"):
    out["yp_wikitext " + title] = yp({"action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main", "titles": title, "redirects": "1"})
# 3) BIGWEB
for q in ("LOCH-JP001", "LOCH-JP002", "LOCH-JP010", "LOCR-JP001", "オーバーフレーム", "LOCH"):
    time.sleep(1.5)
    s, j = js("https://api.bigweb.co.jp/products?game_id=9&name=" + urllib.parse.quote(q), {"Accept": "application/json", "Origin": "https://bigweb.co.jp", "Referer": "https://bigweb.co.jp/"})
    if isinstance(j, dict):
        items = j.get("items") or []
        out["bigweb " + q] = {"status": s, "n": len(items), "keys": sorted(items[0].keys()) if items else [],
                              "items": [{"fname": it.get("fname"), "name": it.get("name"), "rarity": it.get("rarity"), "condition": (it.get("condition") or {}).get("web"),
                                         "price": it.get("price"), "stock": it.get("stock_count"), "image": it.get("image"),
                                         "other": {k: v for k, v in it.items() if isinstance(v, str) and re.search("フレーム|frame|OF", v, re.I)}} for it in items[:40]]}
    else:
        out["bigweb " + q] = {"status": s, "raw": j}
# 4) Bunjang (Korean)
for q in ("LOCH-KR", "오버프레임", "LOCH"):
    time.sleep(3)
    s, j = js("https://api.bunjang.co.kr/api/search/v8/web/search?" + urllib.parse.urlencode({"policyKey": "mw.product.keyword", "q": q, "size": 30}), {"Accept": "application/json"})
    try:
        data = j["data"]["responses"]["mainGrid"]["searchResponse"]["data"]
        out["bunjang " + q] = {"status": s, "names": [(x.get("name"), x.get("price")) for x in data if x.get("type") == "PRODUCT"][:30]}
    except Exception:
        out["bunjang " + q] = {"status": s, "raw": str(j)[:800]}
# 5) TCGplayer (TCGCSV): an English Limit Over, or Overframe products?
s, j = js("https://tcgcsv.com/tcgplayer/2/groups")
groups = [g for g in (j.get("results") or [])] if isinstance(j, dict) else []
hits = [g for g in groups if re.search(r"limit over|overframe|quarter century art", g.get("name", ""), re.I)]
out["tcg_groups"] = [(g.get("groupId"), g.get("name"), g.get("abbreviation"), g.get("publishedOn")) for g in hits]
for g in hits[:3]:
    time.sleep(1)
    s, p = js("https://tcgcsv.com/tcgplayer/2/%s/products" % g["groupId"])
    res = p.get("results") or [] if isinstance(p, dict) else []
    out["tcg_products %s" % g["name"]] = [(x.get("name"), {e.get("name"): e.get("value") for e in x.get("extendedData") or [] if e.get("name") in ("Number", "Rarity")}) for x in res[:40]]
json.dump(out, open("probe/out6.json", "w"), ensure_ascii=False, indent=1)
print("done")

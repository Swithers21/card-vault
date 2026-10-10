"""One-time look at Overframe / extended art (round 7): Yugipedia's row properties, TCGplayer's names, BIGWEB's other sets. Writes probe/out7.json."""
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
YP = "https://yugipedia.com/api.php?"
def yp(params):
    params = dict(params, format="json", formatversion="2")
    time.sleep(1.5)
    return js(YP + urllib.parse.urlencode(params), {"Accept": "application/json"})[1]
# 1) Yugipedia: what a set-list row (subobject) carries, for a normal and an extended-art line
rows = yp({"action": "ask", "query": "[[Card number::LOCH-JP001]]|?Card number|?Rarity|limit=10"})
out["rows_JP001"] = rows
keys = list(((rows.get("query") or {}).get("results") or {}).keys()) if isinstance(rows, dict) else []
for k in keys[:3]:
    out["browse " + k] = yp({"action": "browsebysubject", "subject": k})
cands = ["Description", "Card description", "Print notes", "Notes", "Set list description", "Artwork", "Extended art", "Art", "Print", "Print type", "Alternate artwork", "Variant"]
out["ask_props"] = yp({"action": "ask", "query": "[[Card number::LOCH-JP001]]|" + "|".join("?" + c for c in cands) + "|limit=10"})
out["ask_ext"] = yp({"action": "ask", "query": "[[Card number::~LOCH-JP00*]][[Description::~*xtended*]]|?Card number|?Rarity|limit=20"})
# sets with extended art (TCG and OCG), from the Extended art page's set links, and their prefixes
for title in ("Rarity Collection 5", "Magnificent Monsters", "Magnificent Maestros", "Limit Over Special Pack Vol.1", "Limit Over Collection: The Rivals"):
    out["yp_set " + title] = yp({"action": "ask", "query": "[[%s]]|?Prefix|?English prefix|?Japanese prefix|?Korean prefix" % title})
s, j = js(YP + urllib.parse.urlencode({"action": "query", "prop": "revisions", "rvprop": "content", "titles": "Set Card Lists:Rarity Collection 5 (TCG-EN)", "format": "json", "formatversion": "2"}))
try:
    out["rc5_list"] = j["query"]["pages"][0]["revisions"][0]["content"][:5000]
except Exception:
    out["rc5_list"] = str(j)[:500]
# 2) TCGplayer (TCGCSV): extended-art products
s, j = js("https://tcgcsv.com/tcgplayer/2/groups")
groups = [g for g in (j.get("results") or [])] if isinstance(j, dict) else []
hits = [g for g in groups if re.search(r"rarity collection 5|magnificent m|limit over", g.get("name", ""), re.I)]
out["tcg_groups"] = [(g.get("groupId"), g.get("name"), g.get("abbreviation"), g.get("publishedOn")) for g in hits]
for g in hits[:4]:
    time.sleep(1)
    s, p = js("https://tcgcsv.com/tcgplayer/2/%s/products" % g["groupId"])
    res = p.get("results") or [] if isinstance(p, dict) else []
    ext = {x.get("productId"): x for x in res}
    out["tcg_products %s" % g["name"]] = {"n": len(res), "sample": [(x.get("productId"), x.get("name"), x.get("cleanName"), {e.get("name"): e.get("value") for e in x.get("extendedData") or [] if e.get("name") in ("Number", "Rarity")}) for x in res if re.search(r"extend|over.?frame|alternate|\(.*art", x.get("name", ""), re.I)][:40],
                                          "first": [(x.get("productId"), x.get("name"), {e.get("name"): e.get("value") for e in x.get("extendedData") or [] if e.get("name") in ("Number", "Rarity")}) for x in res[:30]]}
# 3) BIGWEB: other Overframe cards, and a rarity filter
for q in ("YAC1-JP004", "LOCR-JP002", "LOCH-JP019"):
    time.sleep(1.5)
    s, j = js("https://api.bigweb.co.jp/products?game_id=9&name=" + urllib.parse.quote(q), {"Accept": "application/json", "Origin": "https://bigweb.co.jp", "Referer": "https://bigweb.co.jp/"})
    items = j.get("items") or [] if isinstance(j, dict) else []
    out["bigweb " + q] = [(it.get("fname"), it.get("name"), (it.get("rarity") or {}).get("web"), (it.get("rarity") or {}).get("slip"), (it.get("condition") or {}).get("web"), it.get("price"), it.get("stock_count")) for it in items[:30]]
for params in ({"rarity_id": 3578}, {"rarity": 3578}, {"rarity_ids[]": 3578}):
    time.sleep(1.5)
    s, j = js("https://api.bigweb.co.jp/products?game_id=9&" + urllib.parse.urlencode(params), {"Accept": "application/json", "Origin": "https://bigweb.co.jp", "Referer": "https://bigweb.co.jp/"})
    items = j.get("items") or [] if isinstance(j, dict) else []
    out["bigweb rarity %s" % params] = {"status": s, "n": len(items), "pagenate": j.get("pagenate") if isinstance(j, dict) else None,
                                        "items": [(it.get("fname"), (it.get("rarity") or {}).get("web"), it.get("price")) for it in items[:30]]}
json.dump(out, open("probe/out7.json", "w"), ensure_ascii=False, indent=1)
print("done")

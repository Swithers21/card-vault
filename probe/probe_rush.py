"""One-time look at where Rush Duel cards' data lives (BIGWEB, Yugipedia, Bunjang, TCGCSV). Writes probe/out.json."""
import json, re, time, urllib.error, urllib.parse, urllib.request
UA = "CardVault/1.0 (personal Yu-Gi-Oh! collection tracker; one-time check)"
BW = "https://api.bigweb.co.jp"
YP = "https://yugipedia.com/api.php"
def get(url, headers=None, limit=400000):
    req = urllib.request.Request(url, headers=dict({"User-Agent": UA, "Accept": "application/json"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.status, r.read(limit).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read(2000).decode("utf-8", "replace")
    except Exception as e:
        return 0, str(e)
def js(t):
    try: return json.loads(t)
    except Exception: return None
out = {"bw_games": {}, "bw_sets": {}, "bw_rush": {}, "yp": {}, "bunjang": {}, "tcgcsv": {}}
for path in ("/games", "/game_titles", "/categories", "/cardsets"):
    s, t = get(BW + path); out["bw_games"][path] = [s, t[:1500]]; time.sleep(1)
rush_gid, rush_sets = None, []
for gid in range(1, 41):
    s, t = get(BW + "/cardsets?game_id=%d" % gid); time.sleep(0.8)
    j = js(t) or {}
    sets = j.get("cardsets") or []
    names = [str(c.get("name") or "") for c in sets]
    rd = [n for n in names if "RD/" in n.upper() or "ラッシュ" in n]
    out["bw_sets"][gid] = {"status": s, "n": len(sets), "sample": names[:4], "rush": rd[:12], "rush_n": len(rd)}
    if rd and (rush_gid is None or len(rd) > len(rush_sets)):
        rush_gid, rush_sets = gid, [c for c in sets if "RD/" in str(c.get("name") or "").upper() or "ラッシュ" in str(c.get("name") or "")]
out["bw_rush"]["game_id"] = rush_gid
if rush_gid:
    out["bw_rush"]["sets"] = [{"id": c.get("id"), "name": c.get("name"), "keys": sorted(c.keys())} for c in rush_sets[:40]]
    for c in rush_sets[:3]:
        s, t = get(BW + "/products?game_id=%d&cardsets=%s&page=1" % (rush_gid, c.get("id"))); time.sleep(1.5)
        j = js(t) or {}
        items = j.get("items") or []
        out["bw_rush"]["products_%s" % c.get("id")] = {"status": s, "n": len(items), "pagenate": j.get("pagenate"),
            "items": [{k: it.get(k) for k in ("fname", "name", "price", "stock_count", "image")} | {"rarity": (it.get("rarity") or {}).get("web"), "cond": (it.get("condition") or {}).get("web")} for it in items[:12]],
            "rarities": sorted({str((it.get("rarity") or {}).get("web")) for it in items})}
def ask(q):
    s, t = get(YP + "?" + urllib.parse.urlencode({"action": "ask", "format": "json", "formatversion": "2", "query": q}), {"Api-User-Agent": UA}); time.sleep(1.2)
    j = js(t) or {}
    res = (j.get("query") or {}).get("results") or {}
    rows = list(res.values()) if isinstance(res, dict) else res
    return {"status": s, "n": len(rows), "more": j.get("query-continue-offset"), "rows": [{"t": r.get("fulltext"), "p": {k: [x.get("fulltext") if isinstance(x, dict) else x for x in v][:4] for k, v in (r.get("printouts") or {}).items()}} for r in rows[:25]], "err": t[:300] if not rows else ""}
out["yp"]["jp_sets"] = ask("[[Japanese set prefix::~RD/*]]|?Japanese set prefix|?Japanese release date|?Set type|?Series|?Japanese name|sort=Japanese release date|order=desc|limit=500")
out["yp"]["kr_sets"] = ask("[[Korean set prefix::~RD/*]]|?Korean set prefix|?Korean release date|?Set type|?Korean name|sort=Korean release date|order=desc|limit=200")
out["yp"]["en_sets"] = ask("[[English set prefix::~RD/*]]|?English set prefix|?English release date|limit=50")
# the newest Japanese Rush set's cards, and an early one
pfx = [r["p"].get("Japanese set prefix", [""])[0] for r in out["yp"]["jp_sets"]["rows"]]
out["yp"]["prefixes"] = pfx
for p in [x for x in pfx if x][:1] + ["RD/KP01"]:
    out["yp"]["cards_" + p] = ask("[[Card number::~%s-JP*]]|?Card number|?Rarity|?Set contains|limit=40" % p)
out["yp"]["cards_KR_sample"] = ask("[[Card number::~RD/*-KR*]]|?Card number|?Rarity|?Set contains|limit=20")
out["yp"]["rush_card_page"] = ask("[[Card number::RD/KP01-JP001]]|?Card number|?Rarity|?Set contains|?Card type|limit=10")
for q in ("RD/KP01-KR", "러시듀얼"):
    s, t = get("https://api.bunjang.co.kr/api/search/v8/web/search?" + urllib.parse.urlencode({"policyKey": "mw.product.keyword", "q": q, "size": 60, "status": "SOLD_OUT"})); time.sleep(3)
    j = js(t) or {}
    sr = ((((j.get("data") or {}).get("responses") or {}).get("mainGrid") or {}).get("searchResponse")) or {}
    out["bunjang"][q] = {"status": s, "total": sr.get("totalCount"), "names": [[x.get("name"), x.get("price"), x.get("status")] for x in (sr.get("data") or []) if x.get("type") == "PRODUCT"][:25]}
s, t = get("https://tcgcsv.com/tcgplayer/2/groups")
j = js(t) or {}
out["tcgcsv"]["rush_groups"] = [[g.get("groupId"), g.get("name"), g.get("abbreviation"), g.get("publishedOn")] for g in (j.get("results") or []) if "rush" in str(g.get("name")).lower()]
s, t = get("https://tcgcsv.com/tcgplayer/categories")
j = js(t) or {}
out["tcgcsv"]["categories"] = [[c.get("categoryId"), c.get("name")] for c in (j.get("results") or []) if "rush" in str(c.get("name")).lower() or "yu" in str(c.get("name")).lower()]
json.dump(out, open("probe/out.json", "w"), ensure_ascii=False, indent=1)
print("done")

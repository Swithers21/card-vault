"""One-time look at BIGWEB's Rush Duel listings (round 2). Writes probe/out2.json."""
import json, time, urllib.error, urllib.parse, urllib.request
UA = "CardVault/1.0 (personal Yu-Gi-Oh! collection tracker; one-time check)"
BW = "https://api.bigweb.co.jp"
def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.status, r.read(600000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read(1500).decode("utf-8", "replace")
    except Exception as e:
        return 0, str(e)
def js(t):
    try: return json.loads(t)
    except Exception: return None
def items_of(j):
    return [{"fname": it.get("fname"), "name": it.get("name"), "price": it.get("price"), "stock": it.get("stock_count"), "img": it.get("image"),
             "rarity": (it.get("rarity") or {}).get("web"), "cond": (it.get("condition") or {}).get("web"), "cardset": it.get("cardset_id") or (it.get("cardset") or {}).get("id") if isinstance(it.get("cardset"), dict) else it.get("cardset_id"),
             "keys": sorted(it.keys())} for it in (j.get("items") or [])]
out = {}
s, t = get(BW + "/games"); g = js(t) or []
out["games"] = [x for x in g if x.get("id") in (9, 10)] + [x for x in g if "ラッシュ" in str(x.get("title"))]
s, t = get(BW + "/cardsets?game_id=10"); j = js(t) or {}
sets = j.get("cardsets") or []
out["sets10_keys"] = sorted(sets[0].keys()) if sets else []
out["sets10"] = [{k: c.get(k) for k in c.keys() if k not in ("description",)} for c in sets]
time.sleep(1)
for q in ("/products?game_id=10&page=1", "/products?game_id=10&page=2", "/products?game_id=10&page=1&keyword=KP26", "/products?game_id=10&keyword=" + urllib.parse.quote("RD/KP26") + "&page=1"):
    s, t = get(BW + q); time.sleep(1.5); j = js(t) or {}
    out[q] = {"status": s, "pagenate": j.get("pagenate"), "items": items_of(j)[:15], "raw": t[:400] if not j else ""}
tried = 0
for c in sets:
    if tried >= 8: break
    name = str(c.get("name") or "")
    if not name or name.startswith("-"): continue
    s, t = get(BW + "/products?game_id=10&cardsets=%s&page=1" % c.get("id")); time.sleep(1.5); j = js(t) or {}
    its = items_of(j)
    out["set_%s" % c.get("id")] = {"name": name, "status": s, "count": (j.get("pagenate") or {}).get("count"), "items": its[:6], "rarities": sorted({str(x["rarity"]) for x in its})}
    tried += 1
json.dump(out, open("probe/out2.json", "w"), ensure_ascii=False, indent=1)
print("done")

"""One-time look at last night's Rush Duel and Overframe results on the website, and Fullahead's last pages (round 9). Writes probe/out9.json."""
import json, os, re, sys, time, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault("CARDVAULT_OCG_CACHE", "/tmp/ocgcache")
import ocg_market_copy as om
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 CardVault/1.0"
def get(url, enc="utf-8"):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as r:
            return r.status, r.read(40000000).decode(enc, "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception as e:
        return 0, str(e)
def js(t):
    return json.loads(t[t.index("=") + 1:].strip().rstrip(";"))
out = {}
B = "https://swithers21.github.io/card-vault/"
s, t = get(B + "update-status.json"); out["status"] = json.loads(t) if s == 200 else s
s, t = get(B + "ocg-market.js"); mk = js(t)
out["market_rush"] = {r: [len([x for x in mk[r] if str(x[0]).startswith("RD/")]), len([x for x in mk[r] if str(x[0]).startswith("RD/") and x[5]])] for r in ("jp", "kr")}
out["market_rush_sample"] = [x[:5] + [x[5][:3]] for x in mk["jp"] if str(x[0]).startswith("RD/") and x[5]][:6]
out["market_LOC"] = [x[:4] + [[c[:4] for c in x[5][:6]]] for x in mk["jp"] if x[0] in ("LOCH", "LOCR", "YAC1", "UT01")]
s, t = get(B + "ocg-cards.js"); cd = js(t)
rar, names = cd["rar"], cd["names"]
out["rar_overframe"] = [r for r in rar if "Overframe" in r or "Grand Master" in r or "Rush" in r]
def card(region, prefix, tail):
    sset = next((x for x in cd[region] if x[0] == prefix), None)
    c = next((r for r in sset[2] if r[0] == tail), None) if sset else None
    return [names[c[1]], [[rar[x[0]]] + x[1:3] + x[7:] for x in c[2]]] if c else None
for region, prefix, tail in (("jp", "LOCH", "001"), ("jp", "LOCH", "014"), ("jp", "LOCH", "017"), ("jp", "LOCR", "012"), ("jp", "YAC1", "004"), ("jp", "UT01", "001"), ("kr", "LOCH", "001"), ("jp", "BETB", "028")):
    out["card %s %s-%s" % (region, prefix, tail)] = card(region, prefix, tail)
rush_jp = [x for x in cd["jp"] if x[0].startswith("RD/")]
out["rush_jp_priced"] = sum(1 for x in rush_jp for c in x[2] if any(r[1] for r in c[2]))
out["rush_jp_cards"] = sum(len(x[2]) for x in rush_jp)
out["rush_kr_priced"] = sum(1 for x in cd["kr"] if x[0].startswith("RD/") for c in x[2] if any(r[1] for r in c[2]))
out["rush_jp_sample"] = [[x[0], c[0], names[c[1]], [[rar[r[0]], r[1], r[2], r[3]] for r in c[2]]] for x in rush_jp[:40] for c in x[2] if any(r[1] for r in c[2])][:8]
# Fullahead's list: how many pages, what's past the end
pages = {}
for n in (1, 2, 60, 61, 62, 63, 64, 80, 94, 95, 96, 120, 130):
    time.sleep(2.5)
    s, t = get("https://fullahead-yugi.com/shopbrand/yugi-rd/" + ("page%d/order/" % n if n > 1 else ""), "euc_jp")
    rows = om.parse_fullahead_page(t)
    pages[n] = {"status": s, "len": len(t), "rows": len(rows), "first": [r["number"] + " " + r["rarity"] for r in rows[:2]], "last": [r["number"] for r in rows[-1:]],
                "raw_items": len(re.findall(r'class="itemName"', t)), "pager": sorted(set(re.findall(r'page(\d+)/order', t)), key=int)[-5:]}
out["fa_pages"] = pages
json.dump(out, open(os.path.join(os.path.dirname(__file__), "out9.json"), "w"), ensure_ascii=False, indent=1)
print("done")

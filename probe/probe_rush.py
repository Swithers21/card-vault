"""One-time look at Overframe / extended art (round 8): a set-list row's own properties, and other sets' lists. Writes probe/out8.json."""
import json, re, time, urllib.error, urllib.parse, urllib.request
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 CardVault/1.0"
def js(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"}), timeout=60) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except Exception as e:
        return {"error": str(e)}
YP = "https://yugipedia.com/api.php?"
def yp(params):
    time.sleep(1.5)
    return js(YP + urllib.parse.urlencode(dict(params, format="json", formatversion="2")))
out = {}
page = "Set Card Lists:Limit Over Collection: The Heroes (OCG-JP)"
out["browse_sub_param"] = yp({"action": "browsebysubject", "subject": page, "subobject": "_b01a39b5a03477caba9dde2e905ed6bd"})
out["browse_sub_hash"] = yp({"action": "browsebysubject", "subject": page + "#_b01a39b5a03477caba9dde2e905ed6bd"})
out["browse_sub_hash_normal"] = yp({"action": "browsebysubject", "subject": page + "#_893f81d3bba50ce319bf6612d8b6f9c1"})
# how other sets with extended art look in their lists
for title in ("Set Card Lists:Limit Over Collection: The Heroes (OCG-KR)", "Set Card Lists:Limit Over Collection: The Rivals (OCG-JP)"):
    j = yp({"action": "query", "prop": "revisions", "rvprop": "content", "titles": title})
    try:
        t = j["query"]["pages"][0]["revisions"][0]["content"]
        out["list " + title] = [l for l in t.splitlines() if re.search(r"description|extended|JP00[1-3]|KR00[1-3]", l)][:20]
    except Exception:
        out["list " + title] = str(j)[:300]
# which sets have a YAC1 / UT01 / BETB prefix, and their lists
for prefix in ("YAC1", "UT01", "BETB"):
    j = yp({"action": "ask", "query": "[[Card number::~%s-JP0*]]|?Card number|?Rarity|limit=8" % prefix})
    res = (j.get("query") or {}).get("results") or {}
    titles = sorted({k.split("#")[0] for k in res})
    out["ask " + prefix] = {k: [res[k]["printouts"]["Card number"], [x["fulltext"] for x in res[k]["printouts"]["Rarity"]]] for k in list(res)[:8]}
    for title in titles[:1]:
        jj = yp({"action": "query", "prop": "revisions", "rvprop": "content", "titles": title})
        try:
            t = jj["query"]["pages"][0]["revisions"][0]["content"]
            out["list " + title] = t.splitlines()[:30] + [l for l in t.splitlines() if "description" in l][:20]
        except Exception:
            out["list " + title] = str(jj)[:300]
json.dump(out, open("probe/out8.json", "w"), ensure_ascii=False, indent=1)
print("done")

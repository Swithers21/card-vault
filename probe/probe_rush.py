"""One-time look at the Fullahead items the parser misses (round 10). Writes probe/out10.json."""
import html, json, os, re, sys, time, unicodedata, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault("CARDVAULT_OCG_CACHE", "/tmp/ocgcache")
import ocg_market_copy as om
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 CardVault/1.0"
def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as r:
        return r.read().decode("euc_jp", "replace")
out = {}
for n in (60, 61, 62, 2, 130):
    time.sleep(2.5)
    t = get("https://fullahead-yugi.com/shopbrand/yugi-rd/page%d/order/" % n)
    names = re.findall(r'<span class="itemName">(.*?)</span>', t, re.S)
    items = om.FA_ITEM.findall(t)
    parsed = {r["number"] for r in om.parse_fullahead_page(t)}
    out[n] = {"names": [unicodedata.normalize("NFKC", html.unescape(re.sub(r"<[^>]+>", "", x))).strip() for x in names],
              "fa_item_matches": len(items),
              "unparsed_raw": [],
              }
    # the raw markup around the first few items the parser misses
    for m in re.finditer(r'<span class="itemName">(.*?)</span>', t, re.S):
        nm = unicodedata.normalize("NFKC", html.unescape(re.sub(r"<[^>]+>", "", m.group(1)))).strip()
        if not any(nm.startswith(p) for p in parsed) and len(out[n]["unparsed_raw"]) < 3:
            out[n]["unparsed_raw"].append(t[max(0, m.start() - 1500): m.end() + 900])
json.dump(out, open(os.path.join(os.path.dirname(__file__), "out10.json"), "w"), ensure_ascii=False, indent=1)
print("done")

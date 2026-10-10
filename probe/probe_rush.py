"""One-time look at Rush Duel single shops (round 4). Writes probe/out4.json."""
import json, re, time, urllib.error, urllib.request
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 CardVault/1.0"
def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,*/*", "Accept-Language": "ja,en"})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.status, r.read(4000000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read(1500).decode("utf-8", "replace")
    except Exception as e:
        return 0, str(e)
def squeeze(h):
    h = re.sub(r"(?is)<(script|style|svg|noscript)\b.*?</\1>", " ", h)
    return re.sub(r"\s+", " ", h)
out = {}
for url in ("https://dorasuta.jp/robots.txt", "https://dorasuta.jp/yugioh-rushduel/series-list", "https://dorasuta.jp/yugioh-rushduel/product-list?sid=13394",
            "https://dorasuta.jp/yugioh-rushduel/product-list?sid=13394&page=2", "https://dorasuta.jp/yugioh-rushduel/product?pid=707685",
            "https://fullahead-yugi.com/shopbrand/yugi-rd/", "https://mastersguild.net/?mode=cate&cbid=2596062&csid=0"):
    s, t = get(url); time.sleep(3)
    h = squeeze(t)
    i = h.find("RD/")
    out[url] = {"status": s, "len": len(t), "first_rd": i, "head": h[:1500] if url.endswith("robots.txt") else "",
                "around": h[max(0, i - 2500): i + 7000] if i >= 0 else h[:5000],
                "sids": sorted(set(re.findall(r'product-list\?sid=(\d+)', t)))[:600],
                "links": re.findall(r'<a[^>]+href="([^"]*product-list\?sid=\d+[^"]*)"[^>]*>(.*?)</a>', t)[:400] if "series-list" in url else []}
json.dump(out, open("probe/out4.json", "w"), ensure_ascii=False, indent=1)
print("done")

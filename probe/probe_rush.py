"""One-time look at Fullahead's Rush Duel singles (round 5). Writes probe/out5.json."""
import json, re, time, urllib.error, urllib.request
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 CardVault/1.0"
def get(url, enc="euc_jp"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,*/*", "Accept-Language": "ja,en"})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            raw = r.read(4000000)
            ct = r.headers.get("Content-Type", "")
            m = re.search(r"charset=([\w-]+)", ct) or re.search(rb'charset=["\']?([\w-]+)', raw[:3000])
            cs = (m.group(1).decode() if isinstance(m.group(1), bytes) else m.group(1)) if m else enc
            return r.status, raw.decode(cs.replace("-", "_").lower() if cs else enc, "replace"), cs
    except urllib.error.HTTPError as e:
        return e.code, e.read(1500).decode("utf-8", "replace"), ""
    except Exception as e:
        return 0, str(e), ""
out = {}
for url in ("https://fullahead-yugi.com/robots.txt", "https://fullahead-yugi.com/shopbrand/yugi-rd/", "https://fullahead-yugi.com/shopbrand/yugi-rd/page2/order/"):
    s, t, cs = get(url); time.sleep(3)
    out[url] = {"status": s, "charset": cs, "len": len(t),
                "text": t[:3000] if "robots" in url else "",
                "pager": sorted(set(re.findall(r'href="(/shopbrand/yugi-rd/[^"]*)"', t)))[:80],
                "cats": sorted(set(re.findall(r'href="(/shopbrand/[^"]*)"[^>]*>([^<]{1,60})<', t)))[:200]}
    i = t.find("RD/")
    out[url]["raw_item"] = t[max(0, i - 2500): i + 2500] if i >= 0 else ""
    out[url]["items"] = re.findall(r"(RD/[A-Z0-9]+-[A-Z]{2}\d{3}[^<]{0,80})", t)[:60]
    out[url]["prices"] = re.findall(r"([\d,]+)円", t)[:60]
    out[url]["imgs"] = re.findall(r'<img[^>]+src="([^"]+)"', t)[:30]
    out[url]["shopdetail"] = sorted(set(re.findall(r'href="(/shopdetail/[^"]+)"', t)))[:20]
json.dump(out, open("probe/out5.json", "w"), ensure_ascii=False, indent=1)
print("done")

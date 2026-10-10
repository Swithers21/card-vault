"""One-time look at Yuyu-tei's Rush Duel pages (round 3). Writes probe/out3.json."""
import json, re, time, urllib.error, urllib.request
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 CardVault/1.0"
def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,*/*", "Accept-Language": "ja,en"})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.status, r.read(3000000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read(1500).decode("utf-8", "replace")
    except Exception as e:
        return 0, str(e)
def squeeze(h):
    h = re.sub(r"(?is)<(script|style|svg|noscript)\b.*?</\1>", " ", h)
    h = re.sub(r"\s+", " ", h)
    return h
out = {}
s, t = get("https://yuyu-tei.jp/robots.txt"); out["robots"] = [s, t[:1500]]
for url in ("https://yuyu-tei.jp/sell/yrd/s/rdca01", "https://yuyu-tei.jp/sell/yrd/s/rdkp26", "https://yuyu-tei.jp/top/yrd", "https://yuyu-tei.jp/sell/yrd/s/search?search_word=RD%2FKP01-JP001"):
    s, t = get(url); time.sleep(3)
    h = squeeze(t)
    i = h.find("RD/")
    out[url] = {"status": s, "len": len(t), "first_rd": i,
                "around": h[max(0, i - 3000): i + 9000] if i >= 0 else h[:6000],
                "set_links": sorted(set(re.findall(r'href="(https://yuyu-tei\.jp/sell/yrd/s/[a-z0-9]+)"', t)))[:400]}
json.dump(out, open("probe/out3.json", "w"), ensure_ascii=False, indent=1)
print("done")

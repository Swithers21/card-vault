#!/usr/bin/env python3
"""Looks over the finished website before it is published, so a broken night can't replace a good site.

The daily GitHub workflow runs this on the folder it has put together (_site). If it finds a real problem the
workflow stops there: nothing is published, and the website you already have stays up as it was. Things that are only
worth knowing (prices a few days old, fewer Japanese cards than before) are warnings: they show in the run's summary
but don't stop anything.

Stops the publish:
  - a file the website needs is missing or empty (index.html, app.css, app.js, config.js, sw.js, the manifest, icons)
  - index.html points at a file that isn't there
  - app.js, sw.js or config.js has a typing error (checked with Node, when it's there)
  - the TCGplayer prices file is missing, can't be read, or has far fewer products than the last published one

Use:  python check_site.py _site
      python check_site.py _site --counts publish-counts.json          compare with the last good counts
      python check_site.py _site --counts publish-counts.json --save    ...and keep this run's counts if all is well
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timedelta, timezone

REQUIRED = ["index.html", "app.css", "app.js", "config.js", "sw.js", "manifest.webmanifest",
            "icons/icon-192.png", "icons/icon-512.png"]
SCRIPTS = ["app.js", "sw.js", "config.js"]
MIN_PRODUCTS = 1000        # a TCGplayer file with fewer than this isn't the real thing
MAX_DROP = 0.25            # more than this share of products gone since the last good run stops the publish
STALE_DAYS = 3             # TCGplayer prices older than this are a warning (the website shows its own notice too)


def read_text(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def read_window_json(path):
    """The value in a file shaped like  window.NAME = {...};  (what the updaters write)."""
    text = read_text(path)
    m = re.search(r"window\.[A-Za-z_]+\s*=\s*", text)
    if not m:
        raise ValueError("no window.NAME = ... in the file")
    return json.loads(text[m.end():].strip().rstrip(";").strip())


def check_files(site, fails):
    for rel in REQUIRED:
        path = os.path.join(site, rel)
        if not os.path.isfile(path) or os.path.getsize(path) == 0:
            fails.append("%s is missing or empty." % rel)
    index = os.path.join(site, "index.html")
    if os.path.isfile(index):
        page = read_text(index)
        for ref in re.findall(r'<(?:script|link)[^>]+(?:src|href)="([^":?#]+\.(?:js|css|webmanifest))"', page):
            if ref != "tcgplayer-data.js" and not os.path.isfile(os.path.join(site, ref)):   # (the prices file has its own check)
                fails.append("index.html uses %s, which isn't in the website." % ref)
    manifest = os.path.join(site, "manifest.webmanifest")
    if os.path.isfile(manifest):
        try:
            icons = json.loads(read_text(manifest)).get("icons") or []
        except ValueError as err:
            fails.append("manifest.webmanifest isn't valid JSON (%s)." % err)
            icons = []
        for icon in icons:
            if not os.path.isfile(os.path.join(site, icon.get("src", ""))):
                fails.append("The manifest lists %s, which isn't in the website." % icon.get("src"))


def check_scripts(site, fails, warns):
    node = shutil.which("node")
    if not node:
        warns.append("Node isn't installed here, so the website's programs weren't checked for typing errors.")
        return
    for rel in SCRIPTS:
        path = os.path.join(site, rel)
        if not os.path.isfile(path):
            continue
        done = subprocess.run([node, "--check", path], capture_output=True, text=True)
        if done.returncode != 0:
            fails.append("%s has an error: %s" % (rel, (done.stderr.strip().splitlines() or ["?"])[-1][:200]))


def parse_day(text):
    try:
        return datetime.fromisoformat(str(text).replace("Z", "+00:00"))
    except ValueError:
        return None


def check_prices(site, last, fails, warns, now=None):
    """The TCGplayer file. Returns this run's counts."""
    counts = {}
    path = os.path.join(site, "tcgplayer-data.js")
    if not os.path.isfile(path):
        fails.append("tcgplayer-data.js isn't in the website: it would have no prices at all.")
        return counts
    try:
        data = read_window_json(path)
        products = data["products"]
    except (ValueError, KeyError, TypeError) as err:
        fails.append("tcgplayer-data.js can't be read (%s)." % str(err)[:100])
        return counts
    counts["products"] = len(products)
    counts["generated"] = data.get("generated")
    if len(products) < MIN_PRODUCTS:
        fails.append("tcgplayer-data.js has only %d products (a real one has tens of thousands)." % len(products))
    before = (last or {}).get("products")
    if before and len(products) < before * (1 - MAX_DROP):
        fails.append("tcgplayer-data.js has %d products, down from %d in the last published prices." % (len(products), before))
    made = parse_day(data.get("generated"))
    now = now or datetime.now(timezone.utc)
    if made and made.tzinfo is None:
        made = made.replace(tzinfo=timezone.utc)
    if made and now - made > timedelta(days=STALE_DAYS):
        warns.append("The TCGplayer prices are from %s (more than %d days old)." % (str(data.get("generated"))[:10], STALE_DAYS))
    version = os.path.join(site, "tcgplayer-data-version.js")
    if os.path.isfile(version):
        try:
            if read_window_json(version).get("generated") != data.get("generated"):
                warns.append("tcgplayer-data-version.js and tcgplayer-data.js are from different runs.")
        except ValueError:
            warns.append("tcgplayer-data-version.js can't be read.")
    return counts


def check_extras(site, last, warns):
    """The other data files: a problem with one is a warning (the website copes without it)."""
    counts = {}
    for name in ("ocg-market.js", "ocg-cards.js", "banlist.js", "grading-fees.js"):
        path = os.path.join(site, name)
        if not os.path.isfile(path):
            continue
        try:
            data = read_window_json(path)
        except ValueError as err:
            warns.append("%s can't be read (%s)." % (name, str(err)[:80]))
            continue
        if name == "ocg-cards.js":
            n = sum(len(s[2]) for region in ("jp", "kr") for s in (data.get(region) or []) if len(s) > 2)
            counts["ocgCards"] = n
            before = (last or {}).get("ocgCards")
            if before and n < before * (1 - MAX_DROP):
                warns.append("ocg-cards.js has %d cards, down from %d." % (n, before))
    return counts


def run(site, counts_file=None, save=False, now=None):
    fails, warns = [], []
    last = None
    if counts_file and os.path.isfile(counts_file):
        try:
            last = json.loads(read_text(counts_file))
        except ValueError:
            warns.append("The counts kept from the last run couldn't be read; nothing to compare with.")
    check_files(site, fails)
    check_scripts(site, fails, warns)
    counts = check_prices(site, last, fails, warns, now)
    counts.update(check_extras(site, last, warns))
    if save and counts_file and not fails:
        os.makedirs(os.path.dirname(os.path.abspath(counts_file)), exist_ok=True)
        with open(counts_file, "w", encoding="utf-8") as f:
            json.dump(counts, f)
    return fails, warns, counts


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("site", help="the folder to check (_site)")
    ap.add_argument("--counts", help="a file holding the last good run's counts")
    ap.add_argument("--save", action="store_true", help="keep this run's counts in --counts when nothing is wrong")
    args = ap.parse_args(argv)
    fails, warns, counts = run(args.site, args.counts, args.save)
    for w in warns:
        print("::warning title=Before publishing::%s" % w)
    for f in fails:
        print("::error title=Not published::%s" % f)
    print("Checked %s: %s." % (args.site, ", ".join("%s %s" % (k, v) for k, v in counts.items() if k != "generated") or "no counts"))
    if fails:
        print("Stopping: the website that is already published stays as it is.")
        return 1
    print("All good%s." % (" (%d warning%s)" % (len(warns), "" if len(warns) == 1 else "s") if warns else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())

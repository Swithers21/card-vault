#!/usr/bin/env python3
"""Price history files for the Card Vault website, one per set: history/<set id>.json.

The daily GitHub workflow runs this after update_tcgplayer_data.py. The updater saves TCGplayer's market price
for every printing each evening (tcgplayer-cache/history/<day>.json.gz); this turns those snapshots into small
files the website loads when you open a card, to draw its price over time. Nothing is downloaded.

File layout: {"days": ["2026-10-04", ...], "p": {"<product id>": {"<printing>": [price in cents or null, one per day]}}}
"""

import gzip
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(HERE, "tcgplayer-data.js")
SNAPSHOT_DIR = os.path.join(HERE, "tcgplayer-cache", "history")


def read_data(path):
    with open(path, "r", encoding="utf-8") as handle:
        text = handle.read()
    body = text[text.index("=", text.index("window.TCG_DATA")) + 1:].strip()
    return json.loads(body[:-1] if body.endswith(";") else body)


def snapshot_days(folder):
    names = sorted(n for n in os.listdir(folder) if re.match(r"^\d{4}-\d{2}-\d{2}\.json\.gz$", n)) if os.path.isdir(folder) else []
    return [n[:10] for n in names]


def read_snapshot(folder, day):
    try:
        with gzip.open(os.path.join(folder, day + ".json.gz"), "rt", encoding="utf-8") as handle:
            return (json.load(handle) or {}).get("prices") or {}
    except (OSError, ValueError, EOFError):
        return {}


def build(data, folder):
    """{set id: {"days": [...], "p": {...}}} for every set with a saved price."""
    groups = data.get("groups") or []
    set_of = {}
    for row in data.get("products") or []:
        if isinstance(row[1], int) and 0 <= row[1] < len(groups):
            set_of[str(row[0])] = groups[row[1]][0]
    days = snapshot_days(folder)
    out = {}
    for i, day in enumerate(days):
        for printing, prices in read_snapshot(folder, day).items():
            for pid, market in (prices or {}).items():
                gid = set_of.get(pid)
                if gid is None or not isinstance(market, (int, float)):
                    continue
                per_set = out.setdefault(gid, {})
                series = per_set.setdefault(pid, {}).setdefault(printing, [None] * len(days))
                series[i] = int(round(market * 100))
    return days, out


def run(out_dir, data_path=DATA_FILE, folder=SNAPSHOT_DIR):
    if not os.path.exists(data_path):
        print("No tcgplayer-data.js: no price history this time.")
        return 0
    days, sets = build(read_data(data_path), folder)
    os.makedirs(out_dir, exist_ok=True)
    for name in os.listdir(out_dir):   # sets that are gone
        if name.endswith(".json") and name[:-5] not in {str(g) for g in sets}:
            os.remove(os.path.join(out_dir, name))
    size = 0
    for gid, products in sets.items():
        path = os.path.join(out_dir, "%s.json" % gid)
        with open(path, "w", encoding="ascii") as handle:
            json.dump({"days": days, "p": products}, handle, separators=(",", ":"))
        size += os.path.getsize(path)
    print("Price history: %d days (%s to %s), %d sets, %.1f MB." % (len(days), days[0] if days else "-", days[-1] if days else "-", len(sets), size / 1048576))
    return 0


if __name__ == "__main__":
    sys.exit(run(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "_site", "history")))

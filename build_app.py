#!/usr/bin/env python3
"""Puts Card Vault's program together: the files in src/ (in name order) become app.js.

Card Vault's program is one big block of code whose parts share what they know (your collection, the settings, the
prices), so it can't be cut into separate files the browser loads one by one. Instead it is written in smaller files
by topic (src/10-storage.js, src/70-backups.js, ...) and joined into app.js, which is what the website runs.

Change the files in src/, then run:   python build_app.py
(app.js is the result: don't edit it by hand, the next build would undo it. The tests fail if app.js isn't up to
date with src/.)

   python build_app.py --check     says whether app.js is up to date, without changing it
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")
OUT = os.path.join(HERE, "app.js")


def built():
    names = sorted(n for n in os.listdir(SRC) if n.endswith(".js"))
    if not names:
        sys.exit("No .js files in src/.")
    out = []
    for name in names:
        with open(os.path.join(SRC, name), encoding="utf-8", newline="") as f:
            out.append(f.read())
    return "".join(out)


def main(argv):
    text = built()
    try:
        with open(OUT, encoding="utf-8", newline="") as f:
            current = f.read()
    except OSError:
        current = None
    if "--check" in argv:
        if current == text:
            print("app.js is up to date.")
            return 0
        print("app.js is out of date: run  python build_app.py")
        return 1
    if current == text:
        print("app.js was already up to date (%d KB)." % (len(text.encode("utf-8")) // 1024))
        return 0
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    print("Made app.js from %d files in src/ (%d KB)." % (len([n for n in os.listdir(SRC) if n.endswith(".js")]), len(text.encode("utf-8")) // 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

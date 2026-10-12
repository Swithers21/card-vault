#!/usr/bin/env python3
"""Puts Card Vault back into one file ("Card Vault.html"): index.html with app.css and app.js built in.

The website keeps its page, styles and program in three files (index.html, app.css, app.js) so each is easier to
work on. The copy that runs from a folder on your PC (double-click, no website) is one file: run this to make it.
Use:  python build_single_file.py            -> "Card Vault.html" next to this script
      python build_single_file.py OUT.html   -> that file instead
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def read(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        return f.read()


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "Card Vault.html")
    page = read("index.html")
    link, tag = '<link rel="stylesheet" href="app.css">', '<script src="app.js"></script>'
    if link not in page or tag not in page:
        sys.exit("index.html doesn't point at app.css and app.js; nothing to build in.")
    page = page.replace(link, "<style>\n" + read("app.css").rstrip("\n") + "\n</style>", 1)
    page = page.replace(tag, "<script>\n" + read("app.js").rstrip("\n") + "\n</script>", 1)
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write(page)
    print("Made %s (%d KB)." % (out, len(page.encode("utf-8")) // 1024))


if __name__ == "__main__":
    main()

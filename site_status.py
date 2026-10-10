#!/usr/bin/env python3
"""How tonight's price update went, for Card Vault: update-status.json (and update-status.js, for the PC copy).

The daily GitHub workflow runs this last, after the TCGplayer prices, the Japanese and Korean cards
(ocg_market.py) and the grading fees (grading_fees.py). It says, for each part, whether it worked and how much it
found, and lists anything that went wrong in plain words (a site that stopped answering, far fewer cards priced than
the night before, prices that haven't changed in days). Card Vault shows it in Settings and puts a notice at the
top when something broke; the PC's daily update sends it to your phone.

Inputs (all optional; a missing one is a problem in itself only when that part should have run):
  tcgplayer-data-version.js       when TCGCSV's prices are from
  ocg-cache/last-run.json         what ocg_market.py did (written at the end of its run)
  ocg-cache/grading-fees.json     what grading_fees.py read
  ocg-cache/status-history.json   the last runs' numbers, to compare with (this script keeps it)
  TCG_OUTCOME, OCG_OUTCOME, FEES_OUTCOME   each step's outcome in the workflow (success, failure, ...)
  RUN_URL, RUN_STARTED                     the workflow run's page, and when it started
"""

import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.environ.get("CARDVAULT_STATUS_CACHE", os.path.join(HERE, "ocg-cache"))
OUT = os.environ.get("CARDVAULT_STATUS_OUT", os.path.join(HERE, "update-status.json"))
TCG_VERSION = os.environ.get("CARDVAULT_TCG_VERSION", os.path.join(HERE, "tcgplayer-data-version.js"))
SITE_NAMES = {"yugipedia": "Yugipedia (Japanese and Korean card lists)", "bigweb": "BIGWEB (Japanese prices)", "bunjang": "Bunjang (Korean prices)",
              "fullahead": "Fullahead (Japanese Rush Duel prices)", "frankfurter": "the exchange-rate service"}
COMPANY = {"PSA": "PSA", "BGS": "Beckett", "CGC": "CGC", "SGC": "SGC", "TAG": "TAG"}
HISTORY_RUNS = 60


def now():
    t = os.environ.get("CARDVAULT_NOW")
    return datetime.fromisoformat(t) if t else datetime.now(timezone.utc)


def parse_time(s):
    try:
        t = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def read_json(path, fallback):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return fallback


def write_json(path, value):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path + ".tmp", "w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, separators=(",", ":"))
    os.replace(path + ".tmp", path)


def read_js_object(path):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            text = handle.read()
        return json.loads(text[text.index("=") + 1:].strip().rstrip(";"))
    except (OSError, ValueError):
        return None


def day_text(t):
    return "%s %d" % (t.strftime("%b"), t.day) if t else "an unknown day"


def errors_text(errors):
    return ", ".join("%s ×%d" % (k, n) for k, n in sorted((errors or {}).items(), key=lambda x: -x[1]))


def build():
    t_now = now()
    started = parse_time(os.environ.get("RUN_STARTED")) or (t_now - timedelta(hours=1))
    history = read_json(os.path.join(CACHE, "status-history.json"), [])
    history = [h for h in history if isinstance(h, dict)] if isinstance(history, list) else []
    last = history[-1] if history else {}
    problems, news, parts = [], [], {}

    def problem(key, part, text, minor=False):
        problems.append({"key": key, "part": part, "text": text, "minor": minor})

    # ---- TCGplayer prices
    tcg_outcome = os.environ.get("TCG_OUTCOME", "")
    version = read_js_object(TCG_VERSION) or {}
    generated = parse_time(version.get("generated"))
    tcg = {"outcome": tcg_outcome, "generated": version.get("generated"), "builtAt": version.get("builtAt")}
    if tcg_outcome == "failure":
        problem("tcg-failed", "tcg", "The TCGplayer price download didn't finish tonight, so the website keeps the prices from %s." % day_text(generated))
    if generated and t_now - generated > timedelta(hours=54):
        problem("tcg-stale", "tcg", "The TCGplayer prices are from %s: TCGCSV, where they come from, hasn't had newer ones since." % day_text(generated))
    elif not generated:
        problem("tcg-missing", "tcg", "There are no TCGplayer prices on the website.")
    tcg["ok"] = not any(p["part"] == "tcg" for p in problems)
    parts["tcg"] = tcg

    # ---- Japanese and Korean cards
    ocg_outcome = os.environ.get("OCG_OUTCOME", "")
    rep = read_json(os.path.join(CACHE, "last-run.json"), None)
    ran = parse_time((rep or {}).get("ran"))
    fresh = bool(rep and ran and ran >= started - timedelta(minutes=5))
    ocg = {"outcome": ocg_outcome, "ran": (rep or {}).get("ran"), "fresh": fresh}
    if rep:
        ocg.update({k: rep.get(k) for k in ("sets", "cards", "cardsPriced", "krSold", "rush", "lookups", "left", "sites", "blocked")})
    if ocg_outcome in ("failure", "cancelled") or (ocg_outcome == "success" and not fresh):
        problem("ocg-failed", "ocg", "The Japanese and Korean price update didn't finish tonight%s, so those cards keep their last prices%s." %
                (" (it ran out of time)" if ocg_outcome == "cancelled" else "", " (from %s)" % day_text(ran) if ran else ""))
    if rep and fresh:
        for key, site in sorted((rep.get("sites") or {}).items()):
            n, failed = site.get("requests") or 0, site.get("failed") or 0
            if site.get("blocked") or (n >= 5 and failed / n >= 0.5):
                problem("site-" + key, "ocg", "%s isn't answering: %d of %d requests failed%s. Those cards keep their last prices." %
                        (SITE_NAMES.get(key, key), failed, n, " (%s)" % errors_text(site.get("errors")) if site.get("errors") else ""))
        last_ocg = (last.get("ocg") or {}) if isinstance(last.get("ocg"), dict) else {}
        before, now_priced = last_ocg.get("cardsPriced") or {}, rep.get("cardsPriced") or {}
        # (Rush Duel's cards on their own too: they're a small part of each list, from their own shop for Japanese)
        rush_before, rush_now = last_ocg.get("rushPriced") or {}, rush_priced(rep)
        for region, label in (("jp", "Japanese"), ("kr", "Korean")):
            b, a = before.get(region) or 0, now_priced.get(region) or 0
            if b >= 50 and a < 0.7 * b:
                problem(region + "-drop", "ocg", "Far fewer %s cards have prices tonight: %s, down from %s the night before." % (label, format(a, ","), format(b, ",")))
                continue
            b, a = rush_before.get(region) or 0, rush_now.get(region) or 0
            if b >= 50 and a < 0.7 * b:
                problem(region + "-rush-drop", "ocg", "Far fewer %s Rush Duel cards have prices tonight: %s, down from %s the night before." % (label, format(a, ","), format(b, ",")))
    elif ocg_outcome == "success" and not rep:
        problem("ocg-missing", "ocg", "The Japanese and Korean price update left no report.")
    ocg["ok"] = not any(p["part"] == "ocg" for p in problems)
    parts["ocg"] = ocg

    # ---- grading fees
    fees_outcome = os.environ.get("FEES_OUTCOME", "")
    gf = read_json(os.path.join(CACHE, "grading-fees.json"), None)
    gf = gf if isinstance(gf, dict) else None
    fees = {"outcome": fees_outcome, "checked": (gf or {}).get("checked"), "companies": {}}
    checked = parse_time((gf or {}).get("checked"))
    if gf and fees_outcome and (not checked or checked < started - timedelta(minutes=5)):
        problem("fees-stale", "fees", "The grading fees weren't checked tonight; Card Vault uses the ones from %s." % day_text(checked), minor=True)
    if gf:
        for co, c in (gf.get("companies") or {}).items():
            fees["companies"][co] = {"ok": bool(c.get("ok")), "lastOk": c.get("lastOk"), "error": c.get("error", "")}
            if not c.get("ok"):
                since = parse_time(c.get("lastOk"))
                problem("fees-" + co, "fees", "%s's price list couldn't be read (%s); Card Vault uses the one from %s." %
                        (COMPANY.get(co, co), c.get("error") or "unknown", day_text(since) if since else "its built-in list"), minor=True)
        for ch in gf.get("changes") or []:
            co, lvl = COMPANY.get(ch.get("co"), ch.get("co")), ch.get("level", "")
            if ch.get("what") == "fee":
                text = "%s %s: $%s a card, was $%s." % (co, lvl, fmt_money(ch.get("now")), fmt_money(ch.get("was")))
            elif ch.get("what") == "reopened":
                text = "%s %s is open again%s." % (co, lvl, " at $%s a card" % fmt_money(ch["now"]) if ch.get("now") is not None else "")
            elif ch.get("what") == "paused":
                text = "%s paused %s." % (co, lvl)
            else:
                text = "%s has a new level: %s%s." % (co, lvl, " at $%s a card" % fmt_money(ch["now"]) if ch.get("now") is not None else "")
            news.append({"key": "fee-%s-%s-%s-%s" % (ch.get("co"), re.sub(r"\W+", "", lvl), ch.get("what"), ch.get("day")), "part": "fees", "day": ch.get("day"), "text": text})
    elif fees_outcome:
        problem("fees-missing", "fees", "The grading fees weren't checked tonight.", minor=True)
    fees["ok"] = not any(p["part"] == "fees" for p in problems)
    parts["fees"] = fees

    # (a night without a fresh Japanese and Korean report keeps the last real numbers, to compare the next one with)
    last_ocg = (last.get("ocg") or {}) if isinstance(last.get("ocg"), dict) else {}
    priced = (rep or {}).get("cardsPriced") if fresh else last_ocg.get("cardsPriced")
    rushp = rush_priced(rep) if fresh else last_ocg.get("rushPriced")
    entry = {"at": t_now.replace(microsecond=0).isoformat(), "tcg": tcg["ok"], "ocg": {"ok": ocg["ok"], "cardsPriced": priced, "rushPriced": rushp},
             "problems": [p["key"] for p in problems if not p.get("minor")], "notes": [p["key"] for p in problems if p.get("minor")]}
    history = (history + [entry])[-HISTORY_RUNS:]
    status = {"format": 1, "checked": entry["at"], "run": os.environ.get("RUN_URL", ""), "parts": parts, "problems": problems, "news": news,
              "recent": [{"at": h.get("at", ""), "ok": not h.get("problems"), "problems": h.get("problems", [])} for h in history[-14:]]}
    return status, history


def rush_priced(rep):
    """{"jp": n, "kr": n}: how many Rush Duel cards the report says have prices."""
    rush = (rep or {}).get("rush") if isinstance((rep or {}).get("rush"), dict) else {}
    return {region: ((rush.get(region) or {}).get("priced") or 0) for region in ("jp", "kr")}


def fmt_money(v):
    if v is None:
        return "?"
    return ("%d" % v) if float(v) == int(v) else ("%.2f" % v)


def main():
    status, history = build()
    write_json(os.path.join(CACHE, "status-history.json"), history)
    write_json(OUT, status)
    js = os.path.splitext(OUT)[0] + ".js"
    with open(js + ".tmp", "w", encoding="utf-8") as handle:
        handle.write("/* Card Vault: how the latest price update went (site_status.py) */\nwindow.CARDVAULT_STATUS = ")
        json.dump(status, handle, ensure_ascii=True, separators=(",", ":"))
        handle.write(";\n")
    os.replace(js + ".tmp", js)
    serious = [p for p in status["problems"] if not p.get("minor")]
    print("Update status: %s" % ("all good" if not status["problems"] else "; ".join(p["text"] for p in status["problems"])))
    if serious and os.environ.get("GITHUB_ACTIONS"):
        for p in serious:
            print("::warning title=Card Vault update::%s" % p["text"])
    return 0


if __name__ == "__main__":
    sys.exit(main())

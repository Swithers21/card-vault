#!/usr/bin/env python3
"""The Forbidden & Limited lists for the Card Vault website: banlist.json and banlist.js (for Card Vault.html on a PC).

The nightly GitHub workflow runs this once a night. It reads the TCG list (English cards) and the OCG list (Japanese
and Korean cards) from YGOPRODeck, compares each with the last good read, and keeps every change it notices, with
the night it noticed it, for 400 days. Card Vault shows your cards that are on a list (Insights > Ban list &
reprints), puts a notice at the top when one of them changes, and the nightly phone alerts mention it.

A list that can't be read, or comes back far shorter than before (a hiccup on YGOPRODeck's side), keeps the last
good one. What was read is kept in ocg-cache/banlist.json between runs (the workflow saves that folder).

  python banlist.py               read the lists and write banlist.json and banlist.js
  python banlist.py --from-cache  just write banlist.json and banlist.js from the last good read
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
API = os.environ.get("CARDVAULT_BANLIST_URL", "https://db.ygoprodeck.com/api/v7/cardinfo.php?banlist=%s")
STATE = os.environ.get("CARDVAULT_BANLIST_STATE", os.path.join(HERE, "ocg-cache", "banlist.json"))
OUT = os.environ.get("CARDVAULT_BANLIST_OUT", os.path.join(HERE, "banlist.json"))
USER_AGENT = "CardVault/2.1 (personal Yu-Gi-Oh! collection tracker; nightly ban list check)"
LISTS = ("tcg", "ocg")
WORDS = {"Banned": "Forbidden", "Forbidden": "Forbidden", "Limited": "Limited", "Semi-Limited": "Semi-Limited"}
KEEP_DAYS = 400


def now():
    t = os.environ.get("CARDVAULT_NOW")
    return datetime.fromisoformat(t) if t else datetime.now(timezone.utc)


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


def fetch_list(which):
    """{card name: "Forbidden" | "Limited" | "Semi-Limited"} for one list, from YGOPRODeck."""
    url = API % which
    last = None
    # (two tries of 40 seconds at most, so both lists fit in the workflow step's 4 minutes even when YGOPRODeck hangs)
    for attempt in range(2):
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=40) as response:
                data = json.loads(response.read().decode("utf-8"))
            break
        except urllib.error.HTTPError as error:
            last = "HTTP %d" % error.code
            if error.code < 500 and error.code != 429:
                raise RuntimeError(last)
        except (OSError, ValueError) as error:
            last = str(getattr(error, "reason", "") or error)[:120] or "no answer"
        time.sleep(5)
    else:
        raise RuntimeError(last or "no answer")
    if not isinstance(data, dict) or not isinstance(data.get("data"), list):
        raise RuntimeError("an answer that isn't a card list")
    out = {}
    for card in data["data"]:
        if not isinstance(card, dict):
            continue
        status = WORDS.get(((card.get("banlist_info") or {}).get("ban_" + which) or "").strip())
        name = str(card.get("name") or "").strip()
        if status and name:
            out[name] = status
    return out


def compare(which, before, after, day):
    """The cards whose status changed: [{list, name, was, now, day}] ("" is not on the list)."""
    changes = []
    for name in sorted(set(before) | set(after)):
        was, now_ = before.get(name, ""), after.get(name, "")
        if was != now_:
            changes.append({"list": which, "name": name, "was": was, "now": now_, "day": day})
    return changes


def public(state):
    """What the website gets: the lists, the changes, and when each list was last read."""
    return {"format": 1, "checked": state.get("checked"), "lists": state.get("lists") or {},
            "counts": {k: len((state.get("lists") or {}).get(k) or {}) for k in LISTS},
            "lastOk": state.get("lastOk") or {}, "errors": state.get("errors") or {}, "changes": state.get("changes") or []}


def write_site(state):
    data = public(state)
    write_json(OUT, data)
    js = os.path.splitext(OUT)[0] + ".js"
    with open(js + ".tmp", "w", encoding="utf-8") as handle:
        handle.write("/* Card Vault: the Forbidden & Limited lists, from YGOPRODeck (banlist.py) */\nwindow.CARDVAULT_BANLIST = ")
        json.dump(data, handle, ensure_ascii=True, separators=(",", ":"))
        handle.write(";\n")
    os.replace(js + ".tmp", js)


def run():
    t = now()
    stamp, day = t.replace(microsecond=0).isoformat(), t.date().isoformat()
    state = read_json(STATE, {})
    state = state if isinstance(state, dict) else {}
    lists = state.get("lists") if isinstance(state.get("lists"), dict) else {}
    changes = [c for c in state.get("changes") or [] if isinstance(c, dict)]
    errors, last_ok = {}, dict(state.get("lastOk") or {})
    for which in LISTS:
        before = lists.get(which) if isinstance(lists.get(which), dict) else None
        try:
            after = fetch_list(which)
        except RuntimeError as error:
            errors[which] = str(error)
            print("%s list: couldn't read it (%s); keeping the last one" % (which.upper(), error))
            continue
        # (a list far shorter than before is a bad read, not hundreds of cards coming off at once)
        if len(after) < 20 or (before and len(after) < 0.6 * len(before)):
            errors[which] = "only %d cards came back" % len(after)
            print("%s list: only %d cards came back (%d before); keeping the last one" % (which.upper(), len(after), len(before or {})))
            continue
        found = compare(which, before, after, day) if before is not None else []
        if found:
            print("%s list: %d change%s: %s" % (which.upper(), len(found), "" if len(found) == 1 else "s",
                                               "; ".join("%s %s -> %s" % (c["name"], c["was"] or "Unlimited", c["now"] or "Unlimited") for c in found[:20])))
        else:
            print("%s list: %d cards, %s" % (which.upper(), len(after), "no changes" if before is not None else "the first read"))
        changes += found
        lists[which] = after
        last_ok[which] = stamp
    cutoff = (t - timedelta(days=KEEP_DAYS)).date().isoformat()
    changes = sorted([c for c in changes if str(c.get("day") or "") >= cutoff], key=lambda c: (c.get("day") or "", c.get("list") or "", c.get("name") or ""), reverse=True)
    state = {"checked": stamp, "lists": lists, "changes": changes, "lastOk": last_ok, "errors": errors}
    if not lists:
        print("Ban lists: none read yet (%s), so nothing was written." % "; ".join("%s: %s" % (k.upper(), v) for k, v in errors.items()))
        return 1
    write_json(STATE, state)
    write_site(state)
    print("Ban lists: %s; %d change%s noticed tonight%s." % (", ".join("%s %d cards" % (k.upper(), len(lists.get(k) or {})) for k in LISTS),
          sum(1 for c in changes if c.get("day") == day), "" if sum(1 for c in changes if c.get("day") == day) == 1 else "s",
          "; couldn't read " + ", ".join("%s (%s)" % (k.upper(), v) for k, v in errors.items()) if errors else ""))
    return 1 if len(errors) == len(LISTS) else 0


def main():
    if "--from-cache" in sys.argv:
        state = read_json(STATE, None)
        if not isinstance(state, dict) or not state.get("lists"):
            print("No ban list kept yet.")
            return 1
        write_site(state)
        return 0
    return run()


if __name__ == "__main__":
    sys.exit(main())

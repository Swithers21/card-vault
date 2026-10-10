#!/usr/bin/env python3
"""Phone alerts from the nightly update on GitHub, so the PC doesn't need to be on.

The website (Settings > Phone alerts > "Send them without the PC") keeps a locked copy of what the alerts need in
your Google Drive: your cards and want list (names, printings, quantities), your alert settings and your ntfy topic.
It's locked with a key (AES-GCM) that only you and GitHub have: the website shows it, and you save it as the
repository secret CARDVAULT_ALERTS ("<Drive file id>.<key>"). The file itself is shared as "anyone with the link",
which is how this step reads it without signing in to your Google account; without the key it's unreadable.

Each night, after the new prices are in, this sends (through ntfy, like the PC's updater):
  - want-list cards that reached your target price, and big price moves on your cards (once per TCGplayer price day)
  - cards at a grading company past their expected return date (once per card and due date)
  - Forbidden & Limited list changes for cards you own or want (once per change)
It never prints card names, the topic or the file id: a public repository's logs are public.

Status for the website goes to ocg-cache/alerts-status.json (site_status.py adds it to update-status.json);
what was already sent is kept in ocg-cache/alerts-state.json (the workflow saves that folder between runs).
Needs the "cryptography" package (the workflow installs it when the secret is set).
"""

import base64
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone

import update_tcgplayer_data as up

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.environ.get("CARDVAULT_ALERTS_CACHE", os.path.join(HERE, "ocg-cache"))
DATA_FILE = os.environ.get("CARDVAULT_TCG_DATA", os.path.join(HERE, "tcgplayer-data.js"))
BANLIST = os.environ.get("CARDVAULT_BANLIST_OUT", os.path.join(HERE, "banlist.json"))
DOWNLOAD = os.environ.get("CARDVAULT_ALERTS_DOWNLOAD", "https://drive.google.com/uc?export=download&id=%s")
BAN_LISTS = {"tcg": "TCG", "ocg": "OCG"}


class Problem(Exception):
    """Something to say in the status (never a card name or the topic)."""


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


def b64url(text):
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def parse_secret(secret):
    m = re.match(r"^\s*([A-Za-z0-9_-]{10,200})\.([A-Za-z0-9_-]{43})\s*$", secret or "")
    if not m:
        raise Problem("the CARDVAULT_ALERTS secret isn't the key Card Vault showed (copy it again from Settings > Phone alerts)")
    return m.group(1), b64url(m.group(2))


def download(file_id):
    request = urllib.request.Request(DOWNLOAD % file_id, headers={"User-Agent": up.USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        if error.code in (401, 403, 404):
            raise Problem("the alerts file in your Google Drive couldn't be read (HTTP %d): set phone alerts up again in Card Vault's Settings" % error.code)
        raise Problem("Google Drive answered HTTP %d" % error.code)
    except OSError as error:
        raise Problem("Google Drive didn't answer (%s)" % str(getattr(error, "reason", "") or error)[:80])


def unlock(raw, key):
    try:
        box = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise Problem("the alerts file isn't Card Vault's (Google Drive may have sent a sign-in page: check that it's shared with anyone with the link)")
    if not isinstance(box, dict) or box.get("kind") != "alerts" or not box.get("iv") or not box.get("data"):
        raise Problem("the alerts file isn't Card Vault's")
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError:
        raise Problem("the cryptography package isn't installed")
    try:
        plain = AESGCM(key).decrypt(base64.b64decode(box["iv"]), base64.b64decode(box["data"]), None)
    except Exception:  # (InvalidTag and friends: the wrong key)
        raise Problem("the key in the CARDVAULT_ALERTS secret doesn't open the alerts file (copy it again from Settings > Phone alerts)")
    data = json.loads(plain.decode("utf-8"))
    if not isinstance(data, dict):
        raise Problem("the alerts file is empty")
    return data


def read_prices():
    """today_prices {productId: [(subtype, market, low)]}, previous {subtype: {"productId": market}}, price day."""
    try:
        with open(DATA_FILE, "r", encoding="ascii") as handle:
            text = handle.read()
        data = json.loads(text[text.index("=") + 1:].strip().rstrip(";"))
    except (OSError, ValueError):
        raise Problem("there were no TCGplayer prices to compare")
    subtypes = data.get("subtypes") or []
    today, previous = {}, {}
    stride = 6 if (data.get("format") or 0) >= 2 else 3
    for row in data.get("products") or []:
        pid, flat = row[0], row[5] if len(row) > 5 and isinstance(row[5], list) else []
        for i in range(0, len(flat) - stride + 1, stride):
            sub = subtypes[flat[i]] if 0 <= flat[i] < len(subtypes) else None
            if not sub:
                continue
            today.setdefault(pid, []).append((sub, flat[i + 1], flat[i + 2]))
            if stride == 6 and flat[i + 3] is not None:
                previous.setdefault(sub, {})[str(pid)] = flat[i + 3]
    return today, previous, str(data.get("generated") or "")


def norm_name(name):
    """Card Vault's normCardName: lower case letters and digits only, without TCGplayer's "(Starlight Rare)" and the like."""
    s = str(name or "").strip()
    while True:
        t = re.sub(r"\s*\((?:[^()]*?)\)\s*$", "", s).strip()
        if t == s or not t:
            break
        s = t
    return re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKD", s.lower()))


def ban_changes(data, today):
    """Ban list changes in the last 3 days for cards you own or want."""
    ban = read_json(BANLIST, {})
    if not isinstance(ban, dict):
        return []
    mine = {}
    for r in data.get("collection") or []:
        if isinstance(r, dict) and not r.get("sealed") and r.get("name"):
            ocg = not r.get("productId") and str(r.get("language") or "") in ("Japanese", "Korean")
            mine.setdefault(("ocg" if ocg else "tcg", norm_name(r["name"])), "own")
    for w in data.get("wants") or []:
        if isinstance(w, dict) and w.get("name") and (w.get("kind") or "card") == "card":
            ocg = bool(re.search(r"-(JP|JA|KR)\w*\d", str(w.get("number") or "").upper()))
            mine.setdefault(("ocg" if ocg else "tcg", norm_name(w["name"])), "want")
    cutoff = (today - timedelta(days=3)).isoformat()
    out = []
    for c in ban.get("changes") or []:
        if not isinstance(c, dict) or str(c.get("day") or "") < cutoff or c.get("list") not in BAN_LISTS:
            continue
        if (c["list"], norm_name(c.get("name"))) in mine:
            out.append({"key": "ban-%s-%s-%s" % (c["list"], norm_name(c.get("name")), c.get("day")),
                        "text": "%s is %s in the %s (was %s)" % (c.get("name"), "now " + c["now"] if c.get("now") else "no longer on the list",
                                                                 BAN_LISTS[c["list"]], c.get("was") or "Unlimited")})
    return out


def run():
    t = now()
    stamp = t.replace(microsecond=0).isoformat()
    secret = os.environ.get("CARDVAULT_ALERTS", "")
    if not secret.strip():
        print("Phone alerts from GitHub: not set up (no CARDVAULT_ALERTS secret).")
        return {"checked": stamp, "configured": False, "ok": True}, 0
    file_id, key = parse_secret(secret)
    data = unlock(download(file_id), key)
    if data.get("off"):
        print("Phone alerts from GitHub: turned off in Card Vault.")
        return {"checked": stamp, "configured": True, "off": True, "ok": True}, 0
    settings = data.get("settings") or {}
    if not re.match(r"^[A-Za-z0-9_-]{8,64}$", str(settings.get("ntfyTopic") or "")):
        print("Phone alerts from GitHub: no ntfy topic in Card Vault's Settings.")
        return {"checked": stamp, "configured": True, "ok": True, "noTopic": True}, 0
    state = read_json(os.path.join(CACHE, "alerts-state.json"), None)
    first = not isinstance(state, dict)
    state = state if isinstance(state, dict) else {}
    alerted = [k for k in state.get("alerted") or [] if isinstance(k, str)]
    if first:
        # (the first night: cards already late were told about by the PC, and Card Vault shows them anyway)
        alerted += [x["key"] for x in up.late_at_grader(data, t.date())]
    sent, failed = 0, 0

    def send(title, lines, tags):
        nonlocal sent, failed
        if up.send_phone_alert(settings, title, lines, tags):
            sent += 1
            return True
        failed += 1
        return False

    # 1) prices: once per TCGplayer price day, like the PC's updater after it downloads new prices
    today_prices, previous, generated = read_prices()
    if generated and generated != state.get("pricesFrom"):
        alerts = up.compute_alerts(data, today_prices, previous)
        message = up.alert_message(alerts)
        if not message or send(message[0], up.alert_lines(alerts), ["moneybag"]):
            state["pricesFrom"] = generated
    # 2) cards late back from the grader
    late = [x for x in up.late_at_grader(data, t.date()) if x["key"] not in alerted]
    if late:
        title = "Card Vault: %s late back from the grader" % ("%s is" % late[0]["name"] if len(late) == 1 else "%d cards are" % len(late))
        if send(title, ["%s at %s: due back by %s %d" % (x["name"], x["company"], x["due"].strftime("%b"), x["due"].day) for x in late], ["hourglass"]):
            alerted += [x["key"] for x in late]
    # 3) ban list changes for your cards
    bans = [c for c in ban_changes(data, t.date()) if c["key"] not in alerted]
    if bans:
        title = "Card Vault: the ban list changed for %s" % ("one of your cards" if len(bans) == 1 else "%d of your cards" % len(bans))
        if send(title, [c["text"] for c in bans], ["no_entry"]):
            alerted += [c["key"] for c in bans]
    state["alerted"] = alerted[-400:]
    write_json(os.path.join(CACHE, "alerts-state.json"), state)
    print("Phone alerts from GitHub: %d sent%s." % (sent, ", %d couldn't be sent" % failed if failed else ""))
    status = {"checked": stamp, "configured": True, "ok": not failed}
    if failed:
        status["error"] = "ntfy didn't take %d alert%s" % (failed, "" if failed == 1 else "s")
    return status, 0


def main():
    try:
        status, code = run()
    except Problem as problem:
        print("Phone alerts from GitHub: %s." % problem)
        status, code = {"checked": now().replace(microsecond=0).isoformat(), "configured": True, "ok": False, "error": str(problem)}, 1
    write_json(os.path.join(CACHE, "alerts-status.json"), status)
    return code


if __name__ == "__main__":
    sys.exit(main())

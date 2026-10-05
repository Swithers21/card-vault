#!/usr/bin/env python3
"""
Card Vault - TCGplayer data updater
===================================

Downloads TCGplayer's Yu-Gi-Oh! catalog (every printing, with its card number
and rarity) plus current TCGplayer market prices, and saves them next to
"Card Vault.html" as tcgplayer-data.js. Card Vault reads that file when it opens.

Every run also keeps a small snapshot of that day's prices on your computer, so
Card Vault can show how prices changed since the last update, over 7 days and
over 30 days.

The data comes from TCGCSV (https://tcgcsv.com), a free mirror of TCGplayer's
official API that refreshes once a day. This script follows TCGCSV's usage
guidelines (https://tcgcsv.com/docs):
  * it checks last-updated.txt first and stops right away if nothing changed,
  * it identifies itself with its own User-Agent,
  * it pauses between requests and stays far below 10,000 requests a day,
  * it keeps each set's card list on your computer and only downloads it
    again when TCGplayer changes that set.

How to run it
  Windows: double-click "Update TCGplayer Data.bat"
  Anywhere: python update_tcgplayer_data.py
  Options:  --force      rebuild everything, even if TCGCSV hasn't changed
            --scheduled  quiet mode for automatic daily updates (writes a log
                         to tcgplayer-cache/update-log.txt instead of the screen)
            --test-notification  show a sample Windows notification and stop

Windows notifications: when "Windows notifications" is on in Card Vault's
Settings, each update that brings new prices reads your want list and cards
from your Card Vault backup file and shows a notification for want-list cards
that reached your target price and cards whose value moved a lot.

Only Python's standard library is used, so there is nothing extra to install.
"""

import base64
import gzip
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

VERSION = "2.3"
DATA_FORMAT = 4  # tcgplayer-data.js layout; 2 added the older prices for price history, 3 sealed products, 4 marks products with no photo
PRODUCT_LIST_VERSION = 3  # cached set lists; 2 keeps sealed products (booster boxes, tins, decks...) too, 3 notes missing photos
BASE_URL = os.environ.get("CARDVAULT_TCGCSV_BASE", "https://tcgcsv.com").rstrip("/")
CATEGORY_ID = 2  # TCGplayer's category ID for Yu-Gi-Oh!
USER_AGENT = "CardVault/%s (personal Yu-Gi-Oh! collection tracker)" % VERSION
# Phone alerts go through ntfy (a free notification app): the website's Settings picks a private topic name.
NTFY_URL = os.environ.get("CARDVAULT_NTFY", "https://ntfy.sh/")
PAUSE_SECONDS = float(os.environ.get("CARDVAULT_PAUSE", "0.15"))
PRODUCT_CACHE_MAX_AGE_DAYS = 30
HISTORY_KEEP_ALL_DAYS = 120     # keep every daily snapshot this recent (the website charts each card's price)...
HISTORY_KEEP_MONTHLY_DAYS = 400  # ...then one per month back this far

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(HERE, "tcgplayer-cache")
HISTORY_DIR = os.path.join(CACHE_DIR, "history")
STATE_FILE = os.path.join(CACHE_DIR, "state.json")
LOG_FILE = os.path.join(CACHE_DIR, "update-log.txt")
OUT_FILE = os.path.join(HERE, "tcgplayer-data.js")
# A tiny file an open Card Vault checks now and then, to notice new prices without reloading the big one.
VERSION_FILE = os.path.join(HERE, "tcgplayer-data-version.js")

BACKUP_PATH_FILE = os.path.join(CACHE_DIR, "backup-path.txt")
DEFAULT_COND_PCT = {"Near Mint": 100, "Lightly Played": 85, "Moderately Played": 70, "Heavily Played": 50, "Damaged": 30}

request_count = 0
SCHEDULED = "--scheduled" in sys.argv


class Throttled(Exception):
    """TCGCSV asked us to slow down (or blocked us for a while)."""


class Missing(Exception):
    """The file doesn't exist on TCGCSV (it answers 403/404 for missing files)."""


def say(msg=""):
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        print(msg.encode("ascii", "replace").decode("ascii"), flush=True)


def open_log():
    """In scheduled mode there's no window, so send all output to a log file."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    try:
        with open(LOG_FILE, "r", encoding="utf-8") as handle:
            old = handle.readlines()[-400:]  # keep the log small
    except OSError:
        old = []
    log = open(LOG_FILE, "w", encoding="utf-8")
    log.writelines(old)
    log.write("\n=== %s ===\n" % datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    log.flush()
    sys.stdout = log
    sys.stderr = log


def fetch(path, retries=3):
    """GET a TCGCSV path and return the body as bytes."""
    global request_count
    url = BASE_URL + path
    last_error = None
    for attempt in range(1, retries + 1):
        request = urllib.request.Request(
            url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "gzip"}
        )
        request_count += 1
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                body = response.read()
                if (response.headers.get("Content-Encoding") or "").lower() == "gzip":
                    body = gzip.decompress(body)
                return body
        except urllib.error.HTTPError as error:
            if error.code == 429:
                raise Throttled()
            if error.code in (403, 404):
                # TCGCSV sits behind CloudFront + S3, which answers 403 for a
                # missing file. Treat it as missing; the caller decides whether
                # too many of these in a row means we're being blocked.
                raise Missing(url)
            last_error = "HTTP %s" % error.code
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as error:
            last_error = getattr(error, "reason", None) or error
        time.sleep(2 * attempt)
    raise RuntimeError("Couldn't download %s (%s)" % (url, last_error))


def fetch_json(path):
    return json.loads(fetch(path).decode("utf-8"))


def load_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return default


def save_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(data, handle, separators=(",", ":"))
    os.replace(tmp, path)


def iso_timestamp(raw):
    """TCGCSV writes '2026-09-24T20:05:50+0000'; browsers want '+00:00'."""
    raw = (raw or "").strip()
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S.%f%z"):
        try:
            return datetime.strptime(raw, fmt).astimezone(timezone.utc).isoformat()
        except ValueError:
            pass
    return raw


def friendly_date(raw):
    try:
        return datetime.fromisoformat(iso_timestamp(raw)).strftime("%b %d, %Y")
    except ValueError:
        return raw or "unknown date"


def progress(done, total, label):
    if SCHEDULED:
        return
    width = 28
    filled = int(width * done / max(total, 1))
    bar = "#" * filled + "-" * (width - filled)
    label = (label or "")[:38]
    sys.stdout.write("\r  [%s] %3d%%  %-38s" % (bar, int(100 * done / max(total, 1)), label))
    sys.stdout.flush()


def compact_products(results):
    """Single cards (products with a card number): [id, name, number, rarity].
    Everything else in a set (booster boxes and packs, tins, structure decks...): [id, name, "", "", 1].
    A product TCGplayer has no photo of yet gets one more item: [id, name, number, rarity, 0 or 1, 1]."""
    items = []
    for product in results or []:
        extended = {}
        for item in product.get("extendedData") or []:
            extended[item.get("name")] = (item.get("value") or "").strip()
        number = extended.get("Number", "")
        name = (product.get("name") or "").strip()
        if number:
            item = [int(product["productId"]), name, number, extended.get("Rarity", "")]
        elif name:
            item = [int(product["productId"]), name, "", "", 1]
        else:
            continue
        if product.get("imageCount") == 0:
            item += [0] * (5 - len(item)) + [1]
        items.append(item)
    return items


def money(value):
    if value is None:
        return None
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------- price history
def snapshot_path(day):
    return os.path.join(HISTORY_DIR, "%s.json.gz" % day.isoformat())


def saved_snapshot_days():
    days = []
    try:
        names = os.listdir(HISTORY_DIR)
    except OSError:
        return days
    for name in names:
        if name.endswith(".json.gz"):
            try:
                days.append(date.fromisoformat(name[:10]))
            except ValueError:
                pass
    return sorted(days)


def write_snapshot(day, market_by_subtype):
    """market_by_subtype: {"1st Edition": {"714648": 0.41, ...}, ...}"""
    os.makedirs(HISTORY_DIR, exist_ok=True)
    path = snapshot_path(day)
    tmp = path + ".tmp"
    with gzip.open(tmp, "wt", encoding="utf-8") as handle:
        json.dump({"date": day.isoformat(), "prices": market_by_subtype}, handle, separators=(",", ":"))
    os.replace(tmp, path)


def read_snapshot(day):
    try:
        with gzip.open(snapshot_path(day), "rt", encoding="utf-8") as handle:
            return (json.load(handle) or {}).get("prices") or {}
    except (OSError, ValueError, EOFError):
        return {}


def pick_reference_days(today, days):
    """Which saved snapshots to compare today's prices against."""
    past = [d for d in days if d < today]

    def closest(target, earliest, latest):
        window = [d for d in past if earliest <= d <= latest]
        return min(window, key=lambda d: (abs((d - target).days), d)) if window else None

    return {
        "d1": past[-1] if past else None,  # the previous update, however long ago
        "d7": closest(today - timedelta(days=7), today - timedelta(days=10), today - timedelta(days=5)),
        "d30": closest(today - timedelta(days=30), today - timedelta(days=37), today - timedelta(days=24)),
    }


def prune_snapshots(today):
    """Keep every snapshot from the last 40 days, then the first of each month for ~13 months."""
    seen_months = set()
    for day in saved_snapshot_days():
        age = (today - day).days
        keep = age <= HISTORY_KEEP_ALL_DAYS
        if not keep and age <= HISTORY_KEEP_MONTHLY_DAYS:
            month = (day.year, day.month)
            keep = month not in seen_months
            seen_months.add(month)
        if not keep:
            try:
                os.remove(snapshot_path(day))
            except OSError:
                pass

# ---------------------------------------------------------------- notifications
SKIP_DIRS = {"node_modules", "appdata", "tcgplayer-cache", "__pycache__", "$recycle.bin", "system volume information"}


def backup_search_roots():
    """Folders where people usually keep Card Vault's backup file."""
    home = os.path.expanduser("~")
    roots = [HERE]
    try:
        for name in sorted(os.listdir(home)):
            low = name.lower()
            if low.startswith("onedrive") or low in ("dropbox", "google drive", "my drive", "icloud drive", "iclouddrive"):
                roots.append(os.path.join(home, name))
    except OSError:
        pass
    roots += [os.path.join(home, name) for name in ("Documents", "Desktop", "Downloads")]
    # Google Drive for desktop shows your Drive as a drive letter (G: unless you changed it) with a "My Drive" folder.
    if os.name == "nt":
        for letter in "DEFGHIJKLMNOPQRSTUVWXYZ":
            roots.append(letter + ":\\My Drive")
    out, seen = [], set()
    for root in roots:
        key = os.path.normcase(os.path.abspath(root))
        if key not in seen and os.path.isdir(root):
            seen.add(key)
            out.append(root)
    return out


def is_backup_name(name):
    low = name.lower()
    return (low.startswith("card vault backup") and low.endswith(".json")) or \
        (low.startswith("card vault phone copy") and low.endswith((".html", ".htm")))


def find_backup_file(roots=None):
    """The newest Card Vault backup (or phone copy) in the usual folders, a few levels deep."""
    found = []
    try:
        with open(BACKUP_PATH_FILE, encoding="utf-8") as handle:
            remembered = handle.read().strip()
        if remembered and os.path.isfile(remembered):
            found.append(remembered)
    except OSError:
        pass
    budget = [0]

    def walk(folder, depth):
        if depth > 3 or budget[0] <= 0:
            return
        try:
            with os.scandir(folder) as it:
                entries = list(it)
        except OSError:
            return
        budget[0] -= len(entries)
        for entry in entries:
            try:
                if entry.is_file(follow_symlinks=False) and is_backup_name(entry.name):
                    found.append(entry.path)
                elif (entry.is_dir(follow_symlinks=False) and not entry.name.startswith((".", "$"))
                        and entry.name.lower() not in SKIP_DIRS):
                    walk(entry.path, depth + 1)
            except OSError:
                continue

    for root in (roots if roots is not None else backup_search_roots()):
        budget[0] = 30000  # folder entries to look at in each place, at most
        walk(root, 0)
    best = None
    for path in set(found):
        try:
            modified = os.path.getmtime(path)
        except OSError:
            continue
        # a backup file wins over a phone copy, and the live backup over a dated copy of it (saved seconds apart)
        base = os.path.basename(path).lower()
        rank = (int(modified // 600), base == "card vault backup.json", path.lower().endswith(".json"), modified)
        if best is None or rank > best[0]:
            best = (rank, path)
    if not best:
        return None
    try:
        with open(BACKUP_PATH_FILE, "w", encoding="utf-8") as handle:
            handle.write(best[1])
    except OSError:
        pass
    return best[1]


def read_backup(path):
    with open(path, encoding="utf-8") as handle:
        text = handle.read()
    if path.lower().endswith((".html", ".htm")):
        found = re.search(r'<script type="application/json" id="cardvault-backup">(.*?)</script>', text, re.S)
        if not found:
            return None
        text = found.group(1)
    data = json.loads(text)
    if isinstance(data, dict) and data.get("app") == "Card Vault" and isinstance(data.get("collection"), list):
        return data
    return None


def to_number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None


def pick_subtype(subtypes, edition, sealed=False):
    """The TCGplayer price entry for a printing (matches Card Vault's own rule)."""
    if sealed and "Normal" in subtypes:
        return "Normal"
    if edition in subtypes:
        return edition
    if edition == "No edition mark" and "Normal" in subtypes:
        return "Normal"
    if len(subtypes) == 1:
        return next(iter(subtypes))
    return None


def compute_alerts(backup, today_prices, previous):
    """Want-list cards that just reached their target, and cards whose value moved a lot since the last update.
    today_prices: {productId: [(subtype, market, low), ...]}; previous: {subtype: {"productId": market}}."""
    settings = backup.get("settings") or {}
    if not settings.get("alertsOn"):
        return None
    min_dollar = to_number(settings.get("alertMinDollar"))
    min_pct = to_number(settings.get("alertMinPct"))
    min_dollar = 5.0 if min_dollar is None else max(0.0, min_dollar)
    min_pct = 10.0 if min_pct is None else max(0.0, min_pct)
    cond_adjust = settings.get("condAdjust", True) is not False
    cond_pct = dict(DEFAULT_COND_PCT)
    cond_pct.update({k: v for k, v in (settings.get("condPct") or {}).items() if to_number(v) is not None})

    def now_prices(pid):
        return {subtype: (market, low) for subtype, market, low in today_prices.get(pid, [])}

    def before(pid, subtype):
        return (previous.get(subtype) or {}).get(str(pid))

    wants = []
    for want in backup.get("wants") or []:
        pid = to_number(want.get("productId"))
        target = to_number(want.get("target"))
        if not pid or target is None:
            continue
        pid = int(pid)
        subs = now_prices(pid)
        edition = want.get("edition") or "Any"
        if edition == "Any":
            options = [(m if m is not None else lo) for m, lo in subs.values()]
            options = [v for v in options if v is not None]
            price = min(options) if options else None
            earlier = [before(pid, st) for st in subs if before(pid, st) is not None]
            was = min(earlier) if earlier else None
        else:
            subtype = pick_subtype(subs, edition)
            if not subtype:
                continue
            market, low = subs[subtype]
            price = market if market is not None else low
            was = before(pid, subtype)
        # only when it just got there, so the same card doesn't pop up every day
        if price is not None and price <= target and (was is None or was > target):
            wants.append({"name": want.get("name") or "A card", "price": price, "target": target})

    moves = {}
    for record in backup.get("collection") or []:
        pid = to_number(record.get("productId"))
        grade = record.get("grade")
        graded = isinstance(grade, dict) and bool(grade.get("company"))
        if not pid or (graded and to_number(grade.get("value")) is not None):
            continue  # a graded card counts at its own value
        pid = int(pid)
        subs = now_prices(pid)
        subtype = pick_subtype(subs, record.get("edition") or "", bool(record.get("sealed")))
        if not subtype:
            continue
        now, was = subs[subtype][0], before(pid, subtype)
        if now is None or was is None or was <= 0:
            continue
        factor = 1.0
        if cond_adjust and not graded and not record.get("sealed"):
            factor = max(0.0, to_number(cond_pct.get(record.get("condition"), 100)) or 0.0) / 100.0
        qty = int(to_number(record.get("qty")) or 1)
        name = record.get("name") or "A card"
        entry = moves.setdefault(name, {"name": name, "now": 0.0, "was": 0.0})
        entry["now"] += now * factor * qty
        entry["was"] += was * factor * qty
    movers = []
    for entry in moves.values():
        change = entry["now"] - entry["was"]
        if entry["was"] <= 0 or abs(change) < 0.01:
            continue
        pct = change / entry["was"] * 100
        if abs(change) >= min_dollar and abs(pct) >= min_pct:
            movers.append({"name": entry["name"], "change": change, "pct": pct})
    movers.sort(key=lambda m: -abs(m["change"]))
    wants.sort(key=lambda w: w["target"] - w["price"], reverse=True)
    return {"wants": wants, "movers": movers}


def dollars(value):
    return "${:,.2f}".format(abs(value))


def alert_message(alerts):
    """A title and up to two lines for the notification, or None when there's nothing to say."""
    if not alerts or not (alerts["wants"] or alerts["movers"]):
        return None
    parts = []
    if alerts["wants"]:
        count = len(alerts["wants"])
        parts.append("%d want-list card%s at your target price" % (count, "" if count == 1 else "s"))
    if alerts["movers"]:
        count = len(alerts["movers"])
        parts.append("%d big price move%s" % (count, "" if count == 1 else "s"))
    lines = ["%s: %s (your target %s)" % (w["name"], dollars(w["price"]), dollars(w["target"])) for w in alerts["wants"]]
    lines += ["%s %s%s (%.0f%%)" % (m["name"], "up" if m["change"] > 0 else "down", " " + dollars(m["change"]), abs(m["pct"]))
              for m in alerts["movers"]]
    shown = lines[:2]
    extra = len(lines) - len(shown)
    if extra:
        shown[-1] += "; %d more in Card Vault" % extra
    return "Card Vault: " + " and ".join(parts), shown


def toast_xml(title, lines, launch_uri):
    """The notification itself, as Windows toast XML."""
    def xml(text):
        return (text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace('"', "&quot;").replace("'", "&apos;"))
    texts = "".join("<text>%s</text>" % xml(t) for t in [title] + list(lines)[:2])
    return ('<toast activationType="protocol" launch="%s"><visual><binding template="ToastGeneric">%s</binding></visual></toast>'
            % (xml(launch_uri), texts))


def toast_script(title, lines, launch_uri):
    """PowerShell that shows a Windows 10/11 notification (no extra software needed).
    Card names never appear in the script as text: the XML goes in as base64, so no quote
    character in a name (PowerShell also treats curly quotes as quotes) can change the script."""
    packed = base64.b64encode(toast_xml(title, lines, launch_uri).encode("utf-8")).decode("ascii")
    return "\n".join([
        "$ErrorActionPreference = 'Stop'",
        "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
        "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null",
        "$xml = New-Object Windows.Data.Xml.Dom.XmlDocument",
        "$xml.LoadXml([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('%s')))" % packed,
        "$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)",
        "$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show($toast)",
    ])


def send_notification(title, lines):
    say("  Notification: %s" % title)
    for line in lines:
        say("    %s" % line)
    if os.name != "nt":
        return False
    launch = "file:///" + urllib.parse.quote(os.path.join(HERE, "Card Vault.html").replace("\\", "/").lstrip("/"), safe="/:")
    script = toast_script(title, lines, launch)
    encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
    try:
        done = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encoded],
                              capture_output=True, timeout=60, creationflags=0x08000000)
    except (OSError, subprocess.SubprocessError) as error:
        say("  (Windows didn't show the notification: %s)" % error)
        return False
    if done.returncode != 0:
        say("  (Windows didn't show the notification: %s)" % done.stderr.decode("utf-8", "replace").strip()[:300])
        return False
    return True


def alert_lines(alerts):
    """Every alert as a line, for the phone (which has room for more than two)."""
    lines = ["%s: %s (your target %s)" % (w["name"], dollars(w["price"]), dollars(w["target"])) for w in alerts["wants"]]
    lines += ["%s %s%s (%.0f%%)" % (m["name"], "up" if m["change"] > 0 else "down", " " + dollars(m["change"]), abs(m["pct"]))
              for m in alerts["movers"]]
    return lines


def send_phone_alert(settings, title, lines):
    """Sends the alert to the phone through ntfy, if phone alerts are set up in the website's Settings."""
    topic = str((settings or {}).get("ntfyTopic") or "")
    if not re.match(r"^[A-Za-z0-9_-]{8,64}$", topic):
        return False
    site = str((settings or {}).get("siteUrl") or "")
    shown = list(lines)[:12]
    if len(lines) > len(shown):
        shown.append("%d more in Card Vault" % (len(lines) - len(shown)))
    message = {"topic": topic, "title": title[:200], "message": "\n".join(shown)[:3500], "tags": ["moneybag"]}
    if re.match(r"^https://[^\s\"<>]+$", site):
        message["click"] = site
    request = urllib.request.Request(NTFY_URL, data=json.dumps(message).encode("utf-8"), method="POST",
                                     headers={"User-Agent": USER_AGENT, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            ok = 200 <= response.status < 300
    except (OSError, urllib.error.URLError) as error:
        say("  (Couldn't send the phone alert: %s)" % error)
        return False
    say("  Phone alert sent." if ok else "  (The phone alert service didn't accept the alert.)")
    return ok


def notify_about_changes(today_prices, previous):
    path = find_backup_file()
    if not path:
        return
    try:
        backup = read_backup(path)
    except (OSError, ValueError) as error:
        say("  (Couldn't read %s for notifications: %s)" % (path, error))
        return
    if not backup:
        return
    alerts = compute_alerts(backup, today_prices, previous)
    message = alert_message(alerts)
    if message:
        send_notification(*message)
        send_phone_alert(backup.get("settings"), message[0], alert_lines(alerts))



def main():
    force = "--force" in sys.argv
    if "--test-notification" in sys.argv:
        shown = send_notification("Card Vault notifications are working",
                                  ["You'll see messages like this after the daily price update."])
        path = find_backup_file()
        try:
            settings = (read_backup(path) or {}).get("settings") if path else None
        except (OSError, ValueError):
            settings = None
        if settings and settings.get("ntfyTopic"):
            send_phone_alert(settings, "Card Vault phone alerts are working",
                             ["You'll get alerts like this after the daily price update."])
        if not shown and os.name == "nt":
            return 1
        return 0
    started = time.time()
    os.makedirs(CACHE_DIR, exist_ok=True)
    state = load_json(STATE_FILE, {})
    product_state = state.get("products", {})

    say("")
    say("  Card Vault - TCGplayer data updater")
    say("  -----------------------------------")
    say("  Checking TCGCSV for new TCGplayer data...")

    try:
        last_updated = fetch("/last-updated.txt").decode("utf-8").strip()
    except Missing:
        last_updated = ""

    # (A data file from an older version of this updater is rebuilt, so it gets the price history.)
    if (not force and last_updated and last_updated == state.get("lastUpdated")
            and state.get("format") == DATA_FORMAT and os.path.exists(OUT_FILE)):
        say("  Already up to date. Your prices are from %s." % friendly_date(last_updated))
        say("  TCGCSV refreshes once a day, so try again tomorrow for newer prices.")
        return 0

    say("  Downloading the list of Yu-Gi-Oh! sets...")
    try:
        groups = fetch_json("/tcgplayer/%d/groups" % CATEGORY_ID).get("results") or []
    except Missing:
        raise RuntimeError("TCGCSV refused the request. Wait 10 minutes and try again; "
                           "if it keeps happening, TCGCSV may be down for maintenance")
    if not groups:
        raise RuntimeError("TCGCSV returned no Yu-Gi-Oh! sets. Try again later.")
    say("  Found %d sets. Downloading card lists and prices (this takes a few minutes"
        " the first time, then only prices are downloaded)..." % len(groups))

    now_iso = datetime.now(timezone.utc).isoformat()
    now_ts = time.time()
    set_rows = []       # [groupId, name, abbreviation, publishedOn]
    card_rows = []      # [productId, groupIndex, name, number, rarityIndex, prices(, 1 for sealed products)]
    sealed_ids = set()
    no_photo_ids = set()  # products TCGplayer has no photo of (the website shows a stand-in)
    rarity_index = {}
    rarities = []
    skipped_sets = 0
    missing_in_a_row = 0
    today_prices = {}   # {productId: [(subtype, market, low), ...]}

    for position, group in enumerate(groups, start=1):
        group_id = int(group["groupId"])
        progress(position - 1, len(groups), group.get("name", ""))

        # 1) The set's card list, reused from the cache unless the set changed.
        cache_path = os.path.join(CACHE_DIR, "products-%d.json" % group_id)
        cached = product_state.get(str(group_id)) or {}
        fresh_enough = (
            not force
            and cached.get("modifiedOn") == group.get("modifiedOn")
            and cached.get("v") == PRODUCT_LIST_VERSION
            and now_ts - cached.get("fetchedAt", 0) < PRODUCT_CACHE_MAX_AGE_DAYS * 86400
            and os.path.exists(cache_path)
        )
        cards = load_json(cache_path, None) if fresh_enough else None
        if cards is None:
            try:
                cards = compact_products(
                    fetch_json("/tcgplayer/%d/%d/products" % (CATEGORY_ID, group_id)).get("results"))
                missing_in_a_row = 0
            except Missing:
                cards = None
                missing_in_a_row += 1
                skipped_sets += 1
            time.sleep(PAUSE_SECONDS)
            if missing_in_a_row >= 5:
                raise Throttled()
            if cards is None:
                continue
            save_json(cache_path, cards)
            product_state[str(group_id)] = {"modifiedOn": group.get("modifiedOn"), "fetchedAt": now_ts, "v": PRODUCT_LIST_VERSION}
            if position % 50 == 0:  # so an interrupted run doesn't re-download finished sets
                state["products"] = product_state
                save_json(STATE_FILE, state)

        if not cards:
            continue  # nothing in this set to price

        # 2) Today's prices for the set (always downloaded; they change daily).
        try:
            price_results = fetch_json("/tcgplayer/%d/%d/prices" % (CATEGORY_ID, group_id)).get("results") or []
            missing_in_a_row = 0
        except Missing:
            price_results = []
            missing_in_a_row += 1
            if missing_in_a_row >= 5:
                raise Throttled()
        time.sleep(PAUSE_SECONDS)
        for row in price_results:
            subtype = (row.get("subTypeName") or "").strip() or "Normal"
            # Market price is what cards actually sell for. highPrice is ignored on
            # purpose: sellers "price park" listings at absurd amounts.
            today_prices.setdefault(int(row["productId"]), []).append(
                (subtype, money(row.get("marketPrice")), money(row.get("lowPrice"))))

        group_index = len(set_rows)
        set_rows.append([group_id, (group.get("name") or "").strip(),
                         (group.get("abbreviation") or "").strip(),
                         (group.get("publishedOn") or "")[:10]])
        for item in cards:
            product_id, name, number, rarity = item[:4]
            if len(item) > 4 and item[4]:
                sealed_ids.add(product_id)
            if len(item) > 5 and item[5]:
                no_photo_ids.add(product_id)
            if rarity not in rarity_index:
                rarity_index[rarity] = len(rarities)
                rarities.append(rarity)
            card_rows.append([product_id, group_index, name, number, rarity_index[rarity]])

    progress(len(groups), len(groups), "done")
    if not SCHEDULED:
        say("")

    if not card_rows:
        raise RuntimeError("No cards were downloaded, so your existing data was left unchanged.")

    # 3) Price history: save today's snapshot, then look up the comparison days.
    generated = iso_timestamp(last_updated) or now_iso
    try:
        price_day = datetime.fromisoformat(generated).date()
    except ValueError:
        price_day = datetime.now(timezone.utc).date()
    snapshot = {}
    card_ids = {row[0] for row in card_rows}
    for product_id, entries in today_prices.items():
        if product_id not in card_ids:
            continue  # (not in the catalog)
        for subtype, market, _low in entries:
            if market is not None:
                snapshot.setdefault(subtype, {})[str(product_id)] = market
    write_snapshot(price_day, snapshot)
    prune_snapshots(price_day)
    reference_days = pick_reference_days(price_day, saved_snapshot_days())
    references = {key: read_snapshot(day) if day else {} for key, day in reference_days.items()}

    subtypes = []
    subtype_index = {}
    for row in card_rows:
        product_id = row[0]
        prices = []
        for subtype, market, low in today_prices.get(product_id, []):
            if subtype not in subtype_index:
                subtype_index[subtype] = len(subtypes)
                subtypes.append(subtype)
            key = str(product_id)
            prices.extend([subtype_index[subtype], market, low,
                           references["d1"].get(subtype, {}).get(key),
                           references["d7"].get(subtype, {}).get(key),
                           references["d30"].get(subtype, {}).get(key)])
        row.append(prices)
        if product_id in sealed_ids or product_id in no_photo_ids:
            row.append(1 if product_id in sealed_ids else 0)
        if product_id in no_photo_ids:
            row.append(1)

    data = {
        "format": DATA_FORMAT,
        "source": "TCGCSV (TCGplayer)",
        "generated": generated,
        "builtAt": now_iso,
        "history": {key: day.isoformat() if day else None for key, day in reference_days.items()},
        "groups": set_rows,
        "rarities": rarities,
        "subtypes": subtypes,
        # each price entry: subtype, market, low, market at d1, at d7, at d30; after the prices, 1 marks a sealed
        # product, and a second 1 a product TCGplayer has no photo of
        "products": card_rows,
    }
    tmp_path = OUT_FILE + ".tmp"
    with open(tmp_path, "w", encoding="ascii") as handle:
        handle.write("/* Card Vault: TCGplayer Yu-Gi-Oh! data from TCGCSV. Rebuilt by update_tcgplayer_data.py */\n")
        handle.write("window.TCG_DATA = ")
        json.dump(data, handle, ensure_ascii=True, separators=(",", ":"))
        handle.write(";\n")
    os.replace(tmp_path, OUT_FILE)
    with open(VERSION_FILE + ".tmp", "w", encoding="ascii") as handle:
        handle.write("window.TCG_DATA_VERSION = ")
        json.dump({"generated": generated, "builtAt": now_iso}, handle, ensure_ascii=True, separators=(",", ":"))
        handle.write(";\n")
    os.replace(VERSION_FILE + ".tmp", VERSION_FILE)

    state["lastUpdated"] = last_updated
    state["format"] = DATA_FORMAT
    state["lastRun"] = now_iso
    state["products"] = product_state
    save_json(STATE_FILE, state)

    size_mb = os.path.getsize(OUT_FILE) / (1024 * 1024)
    say("  Done! Saved %s card printings and %s sealed products from %d sets (%.1f MB)."
        % (format(len(card_rows) - len(sealed_ids), ","), format(len(sealed_ids), ","), len(set_rows), size_mb))
    say("  Prices are TCGplayer market prices from %s." % friendly_date(last_updated or now_iso))
    compared = [label for key, label in (("d1", "your last update"), ("d7", "7 days ago"), ("d30", "30 days ago"))
                if reference_days[key]]
    if compared:
        say("  Price changes are compared with %s." % ", ".join(compared))
    else:
        say("  Price changes will show up after the updater has run on another day.")
    if skipped_sets:
        say("  (%d %s no card list on TCGCSV and %s skipped.)"
            % (skipped_sets, "set had" if skipped_sets == 1 else "sets had",
               "was" if skipped_sets == 1 else "were"))
    say("  %d requests in %.0f seconds." % (request_count, time.time() - started))
    try:
        if not os.environ.get("GITHUB_ACTIONS"):  # (on GitHub it only builds the website's price file)
            notify_about_changes(today_prices, references["d1"])
    except Exception as error:  # a notification problem never spoils the update itself
        say("  (Couldn't check for notifications: %s)" % error)
    say("")
    say("  Now open Card Vault.html, or press F5 if it's already open.")
    return 0


if __name__ == "__main__":
    if SCHEDULED:
        open_log()
    try:
        sys.exit(main())
    except Throttled:
        say("")
        say("  TCGCSV asked this computer to slow down. Nothing was changed.")
        say("  Wait about 10 minutes, then run the updater again.")
        sys.exit(1)
    except KeyboardInterrupt:
        say("")
        say("  Stopped. Your existing data was left unchanged.")
        sys.exit(1)
    except Exception as error:  # show a readable message instead of a traceback
        say("")
        say("  Something went wrong: %s" % error)
        say("  Check your internet connection and try again. Your existing data was left unchanged.")
        sys.exit(1)

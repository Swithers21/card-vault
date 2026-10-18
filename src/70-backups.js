  /* ======================= Backups ======================= */
  // With Chrome or Edge, Card Vault keeps a backup file you choose up to date after every change.
  // The file's handle is kept in IndexedDB; after a browser restart, the browser asks your OK again.
  const backup = {supported: DRIVE || typeof window.showSaveFilePicker === "function", drive: DRIVE, handle: null, state: "off", timer: null, busy: false, again: false, error: ""};
  function idbOpen() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error("IndexedDB unavailable")); return; }
      const req = indexedDB.open("cardvault", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("handles");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbGet(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const req = db.transaction("handles").objectStore("handles").get(key);
      req.onsuccess = () => { resolve(req.result); db.close(); };
      req.onerror = () => { reject(req.error); db.close(); };
    });
  }
  async function idbPut(key, value) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("handles", "readwrite");
      if (value === undefined) tx.objectStore("handles").delete(key); else tx.objectStore("handles").put(value, key);
      tx.oncomplete = () => { resolve(); db.close(); };
      tx.onerror = () => { reject(tx.error); db.close(); };
    });
  }
  function backupPayload(stamp) {
    return {app: "Card Vault", kind: "backup", format: 1, savedAt: stamp || new Date().toISOString(), savedOn: deviceLabel(),
      collection, wants, valueHistory, decks, sales, openings, deleted, syncId: settings.syncId || null,
      settings: {condAdjust: settings.condAdjust, condPct: settings.condPct,
        alertsOn: settings.alertsOn, alertMinDollar: settings.alertMinDollar, alertMinPct: settings.alertMinPct,
        psa10Mult: settings.psa10Mult, psa10Floor: settings.psa10Floor, gradePct: settings.gradePct, pcToken: settings.pcToken || "",
        gradingCost: settings.gradingCost, gradingMin: settings.gradingMin, gradingFees: cleanGradingFees(settings.gradingFees), gradingCo: settings.gradingCo || "PSA", ntfyTopic: settings.ntfyTopic || "", siteUrl: settings.siteUrl || "", setGoals: cleanGoals(settings.setGoals), themeGoals: cleanThemeGoals(settings.themeGoals),
        sellFeePct: settings.sellFeePct, sellFeeFlat: settings.sellFeeFlat, cloudAlerts: cleanCloudAlerts(settings.cloudAlerts), sharedMod: settings.sharedMod || 0}};
  }
  const hasUnbackedChanges = () => !!settings.lastChangeAt && (!settings.lastBackupAt || settings.lastChangeAt > settings.lastBackupAt);
  const pause = ms => new Promise(r => setTimeout(r, ms));
  async function readBackupFile(h) {
    try {
      const f = await h.getFile();
      if (!f.size) return null;
      const data = JSON.parse(await f.text());
      return data && data.app === "Card Vault" && Array.isArray(data.collection) ? data : null;
    } catch (e) {
      // (Google Drive out of reach, or signed out, isn't the same as an empty file)
      if (e && (e.name === "NetworkError" || e.name === "NotAllowedError")) throw e;
      // In Google Drive, a file that can't be read right now (a download cut off, a server hiccup) is never treated
      // as empty either: nothing is saved over it until it can be read.
      if (h.kind === "gdrive") throw e && e.name === "SyntaxError" ? named("Error", "the backup file in Google Drive couldn't be read") : e;
      return null;
    }
  }

  /* ----- Google Drive (the Card Vault website) ----- */
  // On the website, the backup file lives in Google Drive, so a phone and a computer share one collection.
  // Card Vault can only see files it created itself in your Drive (Google's "drive.file" access).
  // Signing in happens in a window of its own (on an iPhone home-screen app that keeps it inside Card Vault);
  // oauth.html, on this same site, stores the access token and closes it. Google's access lasts an hour.
  const GDRIVE_KEY = "cardvault.v2.gdrive";        // {fileId, email} once set up
  const GTOKEN_KEY = "cardvault.v2.gdriveToken";   // {token, expiresAt}
  const GSTATE_KEY = "cardvault.v2.gdriveState";
  const GPENDING_KEY = "cardvault.v2.gdrivePending";   // what to finish after a sign-in that left the page
  const GDRIVE_API = "https://www.googleapis.com/drive/v3/";
  const GDRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/";
  const GDRIVE_FILE = "Card Vault backup.json";
  const named = (name, message) => { const e = new Error(message); e.name = name; return e; };
  function driveToken() {
    const t = readJSON(GTOKEN_KEY, null);
    return t && t.token && t.expiresAt > Date.now() + 20000 ? t.token : null;
  }
  // Must be called straight from a tap or click (it opens a window). Resolves true once signed in.
  function driveSignIn(opts) {
    opts = opts || {};
    const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
    const before = (readJSON(GTOKEN_KEY, null) || {}).token || "";
    try {
      localStorage.setItem(GSTATE_KEY, state);
      // (the quiet sign-in notes its own state, so oauth.html knows the answer is to that one)
      if (opts.silent) localStorage.setItem(GSILENT_KEY, JSON.stringify(Object.assign(readJSON(GSILENT_KEY, {}) || {}, {state})));
    } catch (e) { /* storage blocked: sign-in can't finish */ }
    const link = readJSON(GDRIVE_KEY, null) || {};
    const params = new URLSearchParams({client_id: SITE.googleClientId, redirect_uri: new URL("oauth.html", location.href).href,
      response_type: "token", scope: "https://www.googleapis.com/auth/drive.file", include_granted_scopes: "true", state});
    if (link.email && !opts.choose) params.set("login_hint", link.email);
    if (opts.choose) params.set("prompt", "select_account");
    else if (opts.silent) params.set("prompt", "none");   // (Google comes straight back, signed in or not, without showing anything)
    const url = "https://accounts.google.com/o/oauth2/v2/auth?" + params;
    const win = opts.sameWindow ? null : window.open(url, "cardvault-google", "popup,width=480,height=680");
    if (!win) {   // popups blocked (or asked for): sign in in this window; oauth.html comes back here afterwards
      try { localStorage.setItem(GPENDING_KEY, opts.purpose || "resume"); } catch (e) { /* ignore */ }
      noteSignInLeaving();   // (the page that comes back finds the entries this one leaves, and steps over them on Back)
      if (opts.silent) location.replace(url);   // (no extra entry in the history)
      else location.assign(url);
      return new Promise(() => {});
    }
    // A sign-in window is open: the quiet sign-in mustn't start meanwhile (in this tab or another), or it would
    // replace this one's state and the window would come back with "didn't come from Card Vault".
    try { localStorage.setItem(GSIGNING_KEY, String(Date.now())); } catch (e) { /* ignore */ }
    return new Promise(resolve => {
      let done = false, channel = null, focusTimer = null, waitNote = null;
      const fresh = () => { const t = driveToken(); return !!t && t !== before; };
      const finish = ok => {
        if (done) return;
        done = true;
        clearInterval(poll); clearTimeout(giveUp); clearTimeout(focusTimer);
        window.removeEventListener("storage", onStorage);
        window.removeEventListener("focus", onFocus);
        try { if (channel) channel.close(); } catch (e) { /* closed already */ }
        if (waitNote) waitNote.remove();
        try { localStorage.removeItem(GSIGNING_KEY); } catch (e) { /* ignore */ }
        resolve(ok);
      };
      const onStorage = e => { if (e.key === GTOKEN_KEY && fresh()) finish(true); };
      // Back in Card Vault without a new token: maybe the sign-in window was closed, maybe it's still open
      // (a phone can switch back and forth). Keep waiting, with a way to stop.
      const onFocus = () => {
        clearTimeout(focusTimer);
        focusTimer = setTimeout(() => {
          if (done || fresh() || waitNote) return;
          // (tapping the message stops waiting; the button signs in here instead of in a separate window)
          waitNote = toast("Still waiting for Google sign-in. If the sign-in window didn't work, sign in in this window instead.", {sticky: true,
            action: "Sign in here", onAction: () => { waitNote = null; finish(false); driveSignIn(Object.assign({}, opts, {sameWindow: true})); }});
          waitNote.addEventListener("click", e => { if (!e.target.closest("button")) { waitNote = null; finish(fresh()); } });
        }, 3000);
      };
      window.addEventListener("storage", onStorage);
      window.addEventListener("focus", onFocus);
      try { channel = new BroadcastChannel("cardvault-google"); channel.onmessage = ev => { if (ev.data && ev.data.ok && fresh()) finish(true); else if (ev.data && ev.data.error) finish(false); }; }
      catch (e) { /* older browsers: the storage event covers it */ }
      const poll = setInterval(() => { if (fresh()) finish(true); }, 600);
      const giveUp = setTimeout(() => finish(fresh()), 5 * 60000);
    });
  }

  // Google's sign-in lasts an hour. When it runs out, Card Vault signs back in by itself: it goes to Google and
  // straight back (prompt=none), with nothing to tap, as long as you're still signed in to Google in this browser
  // or home-screen app. If Google wants you to choose or type something, it comes back without a sign-in and
  // Resume does it the usual way. It's done when Card Vault opens, when you come back to it, and when it has sat
  // untouched for a few minutes; never while you're in the middle of something.
  const GSILENT_KEY = "cardvault.v2.gdriveSilent";   // {at, failedAt, state}: the last quiet sign-in, and the last one that didn't work
  const GSIGNING_KEY = "cardvault.v2.gdriveSigningIn"; // when a sign-in window was opened (cleared when it's done)
  const RETURN_KEY = "cardvault.v2.returnTo";        // (this tab only) where you were, to come back to afterwards
  const SILENT_GAP = 3 * 60000;                      // never more often than this
  const SILENT_BACKOFF = 12 * 3600000;               // after one didn't work: until then, Resume
  // How long ago a saved time was; a time in the future (the clock was set back since) counts as long ago.
  const since = t => { const d = Date.now() - (+t || 0); return d < -60000 ? Infinity : d; };
  function tokenLeft() {
    const t = readJSON(GTOKEN_KEY, null);
    return t && t.token ? t.expiresAt - Date.now() : 0;
  }
  // opts.early: also when the sign-in has less than this long left (ms)
  function silentSignInDue(opts) {
    if (!DRIVE || navigator.onLine === false) return false;
    const link = readJSON(GDRIVE_KEY, null);
    if (!(link && link.fileId)) return false;
    if (tokenLeft() > Math.max(20000, (opts && opts.early) || 0)) return false;
    if ((readJSON(SETTINGS_KEY, {}) || {}).autoSignIn === false) return false;
    let signing = 0;
    try { signing = localStorage.getItem(GSIGNING_KEY); } catch (e) { return false; }
    if (since(signing) < 5 * 60000) return false;   // a sign-in window is open
    const s = readJSON(GSILENT_KEY, {}) || {};
    return since(s.at) >= SILENT_GAP && since(s.failedAt) >= SILENT_BACKOFF;
  }
  function silentTurnedDown() {
    const s = readJSON(GSILENT_KEY, {}) || {};
    return !!s.failedAt && since(s.failedAt) < SILENT_BACKOFF;
  }
  // A quick look that Google answers at all, so a bad connection (a card shop, say) doesn't leave you on an error page.
  function googleReachable(ms) {
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), ms);
      fetch("https://www.google.com/generate_204", {mode: "no-cors", cache: "no-store"})
        .then(() => { clearTimeout(timer); resolve(true); }, () => { clearTimeout(timer); resolve(false); });
    });
  }
  // onStay: if Google hasn't answered within a few seconds, it stops waiting and carries on here instead.
  function silentSignIn(onStay) {
    const s = readJSON(GSILENT_KEY, {}) || {};
    try {
      localStorage.setItem(GSILENT_KEY, JSON.stringify({at: Date.now(), failedAt: +s.failedAt || 0}));
      sessionStorage.setItem(RETURN_KEY, JSON.stringify({y: Math.round(window.scrollY || 0), at: Date.now()}));
    } catch (e) {
      return false;   // (storage blocked: the sign-in couldn't be kept anyway)
    }
    // (nothing can be tapped on the way out, so nothing half done is lost)
    const cover = document.createElement("div");
    cover.className = "leaving";
    cover.setAttribute("role", "status");
    cover.textContent = "Syncing with Google Drive…";
    if (document.body) document.body.appendChild(cover);
    setTimeout(() => {
      try { window.stop(); } catch (e) { /* ignore */ }
      try { localStorage.removeItem(GPENDING_KEY); } catch (e) { /* ignore */ }
      cover.remove();
      if (onStay) onStay();
    }, 8000);
    driveSignIn({silent: true, sameWindow: true, purpose: "silent"});
    return true;
  }
  // Back from a quiet sign-in without one (Google said no, showed its own page, or something went wrong on the
  // way): leave it to Resume for a while. (oauth.html notes this too, when it gets the chance.)
  (function () {
    let pending = "";
    try { pending = localStorage.getItem(GPENDING_KEY) || ""; } catch (e) { return; }
    if (pending !== "silent" || driveToken()) return;
    const s = readJSON(GSILENT_KEY, {}) || {};
    if (since(s.failedAt) > since(s.at)) { s.failedAt = Date.now(); try { localStorage.setItem(GSILENT_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }
  })();
  // When Card Vault opens with the sign-in run out, this goes to Google as soon as it can (even before the price
  // data has finished loading); init() starts Card Vault only if it stays.
  const opening = {domReady: false, started: false, stayed: false};
  function startOnce() {
    if (opening.domReady && !opening.started) { opening.started = true; startApp(); }
  }
  const openSignIn = silentSignInDue() ? googleReachable(1500).then(ok => !!(ok && silentSignInDue() &&
    silentSignIn(() => { opening.stayed = true; startOnce(); }))) : null;
  // Going to Google reloads Card Vault. What it remembers anyway: your cards, the tab, the trade checker's cards and
  // where you'd scrolled to. What it wouldn't: anything open, typed or half done, so then it waits.
  function pageBusy() {
    return viewBusy() || filtersActive() || selected.size > 0 || deckUnsaved() || !!pendingImport || ideas.busy || yugiBatch.running ||
      backup.busy || phone.busy || !!setsQuery.trim() || !!(trade && (trade.q1 || trade.q2)) ||
      !!document.querySelector("#toasts .toast.has-action");
  }
  function deckUnsaved() {
    if (!deckDraft) return false;
    const box = document.getElementById("deckText"), nameBox = document.getElementById("deckName");
    const text = box ? box.value : deckDraft.text, name = (nameBox ? nameBox.value : deckDraft.name).trim();
    const k = deckDraft.id && decks.find(x => x.id === deckDraft.id);
    return k ? k.text !== text || k.name !== name : !!(text.trim() || name);
  }
  let lastInput = Date.now();
  // opts.idle: only once Card Vault has sat untouched this long (ms). Resolves true when it's off to Google.
  function maybeSilentSignIn(opts) {
    opts = opts || {};
    const ready = () => document.visibilityState === "visible" && !pageBusy() && silentSignInDue({early: opts.early}) &&
      !(opts.idle && Date.now() - lastInput < opts.idle);
    if (!ready()) return Promise.resolve(false);
    return googleReachable(1500).then(ok => !!(ok && ready() && silentSignIn()));
  }
  async function driveFetch(url, opts) {
    const token = driveToken();
    if (!token) throw named("NotAllowedError", "the Google Drive sign-in has expired");
    let res;
    try {
      res = await fetch(url.startsWith("https://") ? url : GDRIVE_API + url,
        Object.assign({cache: "no-store"}, opts, {headers: Object.assign({Authorization: "Bearer " + token}, opts && opts.headers)}));
    } catch (e) {
      throw named("NetworkError", "no internet connection");
    }
    if (res.status === 401) {
      try { localStorage.removeItem(GTOKEN_KEY); } catch (e) { /* ignore */ }
      throw named("NotAllowedError", "the Google Drive sign-in has expired");
    }
    if (res.status === 404) throw named("NotFoundError", "the backup file isn't in your Google Drive anymore");
    if (!res.ok) {
      let why = "";
      try { const j = await res.json(); why = j && j.error && j.error.message ? ": " + j.error.message : ""; } catch (e) { /* no details */ }
      // (busy or a hiccup on Google's side: try again a little later, like being offline)
      const retry = res.status === 429 || res.status >= 500 || (res.status === 403 && /quota|rate/i.test(why));
      throw named(retry ? "NetworkError" : "Error", "Google Drive answered " + res.status + why);
    }
    return res;
  }
  // The backup file in Drive, used like a file chosen on this computer (see writeBackup and checkBackupFile).
  function driveHandle(link) {
    return {
      kind: "gdrive", name: GDRIVE_FILE + " in Google Drive", fileId: link.fileId, email: link.email || "",
      async queryPermission() { return driveToken() ? "granted" : "prompt"; },
      requestPermission() { return driveSignIn().then(ok => ok ? "granted" : "denied"); },   // (not async: the window opens during the click)
      async getFile() {
        const meta = await (await driveFetch("files/" + encodeURIComponent(link.fileId) + "?fields=id,size,modifiedTime,trashed")).json();
        if (meta.trashed) throw named("NotFoundError", "the backup file is in your Google Drive trash");
        return {size: +meta.size || 0, lastModified: Date.parse(meta.modifiedTime) || 0,
          text: async () => {
            const res = await driveFetch("files/" + encodeURIComponent(link.fileId) + "?alt=media");
            try { return await res.text(); } catch (e) { throw named("NetworkError", "the download was cut off"); }
          }};
      },
      async createWritable() {
        let body = "";
        return {
          write: async d => { body += d; },
          abort: async () => { body = ""; },
          close: async () => {
            const res = await driveFetch(GDRIVE_UPLOAD + "files/" + encodeURIComponent(link.fileId) + "?uploadType=media&fields=id,modifiedTime,size",
              {method: "PATCH", headers: {"Content-Type": "application/json; charset=utf-8"}, body});
            let meta = null;
            try { meta = await res.json(); } catch (e) { meta = null; }
            return meta && meta.modifiedTime ? {lastModified: Date.parse(meta.modifiedTime) || 0, size: +meta.size || 0} : null;
          }
        };
      }
    };
  }
  /* ----- dated copies in Google Drive ----- */
  // Syncing spreads a mistake to every device, so once a day the first save also leaves a dated copy in a
  // "Backups" folder next to the backup file. The last 30 are kept; any of them can be restored from Settings.
  const DRIVE_KEEP_DAYS = 30;
  const DATED_RE = /^Card Vault backup (\d{4}-\d{2}-\d{2})\.json$/;
  const dated = {day: "", busy: false, list: null};
  async function driveFolder(name, parentId, create) {
    const q = "name = '" + name + "' and mimeType = 'application/vnd.google-apps.folder' and trashed = false" + (parentId ? " and '" + parentId + "' in parents" : "");
    const found = await (await driveFetch("files?q=" + encodeURIComponent(q) + "&pageSize=1&fields=files(id)")).json();
    if (found && found.files && found.files[0]) return found.files[0].id;
    if (!create) return null;
    const made = await (await driveFetch("files?fields=id", {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({name, mimeType: "application/vnd.google-apps.folder", parents: parentId ? [parentId] : undefined})})).json();
    return made.id;
  }
  const rememberFolder = (fileId, folderId) => {
    // (re-read first: Drive may have been set up again on this device while we were waiting)
    const link = readJSON(GDRIVE_KEY, null) || {};
    if (link.fileId !== fileId) return;
    try { localStorage.setItem(GDRIVE_KEY, JSON.stringify(Object.assign({}, link, {backupsFolderId: folderId || undefined}))); } catch (e) { /* found again next time */ }
  };
  async function driveBackupsFolder(h, create) {
    const link = readJSON(GDRIVE_KEY, null) || {};
    if (link.backupsFolderId && link.fileId === h.fileId) {
      // (still there and not in the trash?)
      try {
        const meta = await (await driveFetch("files/" + encodeURIComponent(link.backupsFolderId) + "?fields=id,trashed")).json();
        if (meta && meta.id && !meta.trashed) return link.backupsFolderId;
      } catch (e) { if (e && e.name !== "NotFoundError") throw e; }
      rememberFolder(h.fileId, null);
    }
    // Next to the backup file when that's a folder Card Vault made; otherwise in Card Vault's own folder (Google
    // only lets Card Vault see and use folders it created itself).
    let parent = null;
    try { const meta = await (await driveFetch("files/" + encodeURIComponent(h.fileId) + "?fields=parents")).json(); parent = meta && meta.parents && meta.parents[0] || null; }
    catch (e) { parent = null; }
    let id = null;
    if (parent) { try { id = await driveFolder("Backups", parent, create); } catch (e) { id = null; } }
    if (!id) {
      const own = await driveFolder("Card Vault", null, create);
      if (own) id = await driveFolder("Backups", own, create);
    }
    if (id) rememberFolder(h.fileId, id);
    return id;
  }
  async function driveDatedCopy(h, stamp) {
    const day = localDay(new Date());
    if (dated.busy || dated.day === day || !driveToken()) return;
    dated.busy = true;
    try {
      const folderId = await driveBackupsFolder(h, true);
      if (!folderId) throw new Error("no folder");
      const name = "Card Vault backup " + day + ".json";
      const q = "name = '" + name + "' and '" + folderId + "' in parents and trashed = false";
      const same = await (await driveFetch("files?q=" + encodeURIComponent(q) + "&pageSize=1&fields=files(id)")).json();
      if (!(same && same.files && same.files.length)) {
        const body = dated.body || JSON.stringify(backupPayload(stamp));
        const boundary = "cardvault" + Date.now();
        const multipart = "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" +
          JSON.stringify({name, mimeType: "application/json", parents: [folderId]}) + "\r\n--" + boundary + "\r\nContent-Type: application/json\r\n\r\n" + body + "\r\n--" + boundary + "--";
        await driveFetch(GDRIVE_UPLOAD + "files?uploadType=multipart&fields=id", {method: "POST", headers: {"Content-Type": "multipart/related; boundary=" + boundary}, body: multipart});
        // the oldest beyond 30 go to the trash
        const all = await driveDatedList(folderId);
        for (const f of all.slice(DRIVE_KEEP_DAYS)) await driveFetch("files/" + encodeURIComponent(f.id), {method: "PATCH", headers: {"Content-Type": "application/json"}, body: JSON.stringify({trashed: true})});
        dated.list = null;
      }
      dated.day = day;
      dated.error = "";
    } catch (e) {
      // a copy is a bonus; the main backup went through. Try again at the next save, and say so in Settings.
      dated.error = (e && e.message) || String(e);
    }
    dated.busy = false;
  }
  async function driveDatedList(folderId) {
    const q = "'" + folderId + "' in parents and trashed = false and name contains 'Card Vault backup'";
    const res = await (await driveFetch("files?q=" + encodeURIComponent(q) + "&pageSize=100&fields=files(id,name,size,modifiedTime)")).json();
    return (res && res.files ? res.files : []).filter(f => DATED_RE.test(f.name)).sort((a, b) => b.name.localeCompare(a.name));
  }
  async function fillDriveCopies() {
    const box = document.getElementById("driveCopies");
    if (!box) return;
    if (!(backup.handle && backup.handle.kind === "gdrive")) { box.hidden = true; return; }
    box.hidden = false;
    if (!driveToken()) { box.innerHTML = '<p class="small" style="margin:0">Sign in to Google Drive again (Resume, above) to see them.</p>'; return; }
    box.innerHTML = '<p class="small" style="margin:0">Looking in your Google Drive…</p>';
    let list;
    try { const folderId = await driveBackupsFolder(backup.handle, false); list = folderId ? await driveDatedList(folderId) : []; }
    catch (e) { if (box.isConnected) box.innerHTML = '<p class="small" style="margin:0">Couldn\'t look in Google Drive right now.</p>'; return; }
    if (!box.isConnected) return;
    dated.list = list;
    if (!list.length) { box.innerHTML = '<p class="small" style="margin:0">' + (dated.error ? "The last try didn't work (" + esc(dated.error) + "). Card Vault tries again with the next save." : "None yet: the first dated copy is kept with the next save.") + "</p>"; return; }
    box.innerHTML = '<table class="data-table"><tbody>' + list.map(f => "<tr><td>" + esc(fmtDate(parseDay(f.name.match(DATED_RE)[1]))) + '</td><td class="num">' +
      esc(Math.round((+f.size || 0) / 1024) + " KB") + '</td><td class="num"><button class="btn btn-small" type="button" data-dcopy="' + esc(f.id) + '">Restore</button></td></tr>').join("") +
      "</tbody></table>";
    box.querySelectorAll("[data-dcopy]").forEach(b => b.addEventListener("click", async () => {
      const f = list.find(x => x.id === b.dataset.dcopy);
      b.disabled = true;
      let text;
      try { text = await (await driveFetch("files/" + encodeURIComponent(f.id) + "?alt=media")).text(); }
      catch (e) { b.disabled = false; toast("Couldn't download that copy: " + e.message + ".", {kind: "error"}); return; }
      b.disabled = false;
      if (restoreBackup(text, "the copy from " + fmtDate(parseDay(f.name.match(DATED_RE)[1])))) { closeDrawer(); if (backup.state === "active") scheduleBackup(true); }
    }));
  }
  /* ----- your own photos of a copy, kept in Google Drive ----- */
  // Front and back photos of one copy (to sell it, for insurance, or to remember its condition), taken or chosen on
  // this device, made smaller (longest side 1600 pixels) and kept in your Google Drive under Card Vault > Photos.
  // The card keeps only their Drive ids, so they sync with it, and any device signed in to the same Google account
  // shows them. Card Vault.html on a computer can't reach Google Drive, so it only says they're there.
  const PHOTO_MAX = 1600;
  const photoURLs = new Map();   // Drive id -> promise of a picture address (this visit only)
  let photoFolder = null;
  const driveLinked = () => !!(backup.handle && backup.handle.kind === "gdrive");
  const sideWord = side => side === "back" ? "Back" : "Front";
  function photoSectionHTML(r) {
    if (!DRIVE && !(r.photos && r.photos.length)) return "";
    return '<div class="section" id="photoSec"><h3>Your photos</h3><div id="photoBox">' + photoBoxHTML(r) + "</div></div>";
  }
  function photoBoxHTML(r) {
    const list = r.photos || [];
    if (!DRIVE) return '<p class="small" style="margin:0">' + plural(list.length, "photo") + " of this copy in your Google Drive (Card Vault &gt; Photos). Card Vault's website shows them.</p>";
    if (!driveLinked()) return '<p class="small" style="margin:0">Keep your own photos of this copy, front and back, in your Google Drive. ' +
      (list.length ? "This card has " + plural(list.length, "photo") + "; sync" : "Sync") + " with Google Drive (Settings &gt; Backup) to " + (list.length ? "see them" : "add them") + ".</p>";
    return '<div class="photo-row">' + PHOTO_SIDES.map(side => {
      const p = list.find(x => x.side === side);
      return '<div class="photo-slot">' + (p
        ? '<button type="button" class="photo-img" data-photo-view="' + esc(p.id) + '" aria-label="Show the ' + side + ' photo bigger"><img data-photo-id="' + esc(p.id) + '" alt="Your photo of the ' + side + '"></button>'
        : '<label class="photo-add"><input type="file" class="sr" accept="image/*" data-photo-add="' + side + '"><span aria-hidden="true">+</span><span>Add the ' + side + "</span></label>") +
        '<div class="photo-cap"><b>' + sideWord(side) + "</b>" + (p ? '<button type="button" class="link-btn" data-photo-save="' + side + '">Save</button><button type="button" class="link-btn" data-photo-del="' + side + '">Remove</button>' : "") + "</div></div>";
    }).join("") + "</div>" +
      '<p class="small" id="photoNote" role="status" style="margin:8px 0 0">' + (list.length ? "Kept in your Google Drive (Card Vault &gt; Photos). Save downloads one, for a listing." : "Take a photo or choose one. It's made smaller, kept in your Google Drive (Card Vault &gt; Photos) and syncs with the card.") + "</p>";
  }
  // (a picture address for a photo in Drive, fetched once a visit)
  function photoURL(id) {
    if (!photoURLs.has(id)) {
      const p = driveFetch("files/" + encodeURIComponent(id) + "?alt=media").then(res => res.blob()).then(b => URL.createObjectURL(b));
      photoURLs.set(id, p);
      p.catch(() => photoURLs.delete(id));
    }
    return photoURLs.get(id);
  }
  function fillPhotos() {
    document.querySelectorAll("#photoBox img[data-photo-id]").forEach(img => {
      const why = t => img.replaceWith(Object.assign(document.createElement("span"), {className: "small photo-why", textContent: t}));
      if (!driveToken()) { why("Sign in to Google Drive again (Resume) to see it"); return; }
      photoURL(img.dataset.photoId).then(u => { if (img.isConnected) img.src = u; })
        .catch(e => { if (img.isConnected) why(e && e.name === "NotFoundError" ? "Not in your Google Drive anymore" : "Couldn't load it right now"); });
    });
  }
  function redrawPhotos(id) {
    const r = collection.find(x => x.id === id);
    if (r && $("photoBox") && drawerCtx && drawerCtx.mode === "details" && drawerCtx.id === id) { $("photoBox").innerHTML = photoBoxHTML(r); fillPhotos(); }
  }
  async function shrinkPhoto(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error("this browser can't read that picture")); i.src = url; });
      const scale = Math.min(1, PHOTO_MAX / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * scale)); c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return await new Promise((resolve, reject) => c.toBlob(b => b ? resolve(b) : reject(new Error("couldn't make it smaller")), "image/jpeg", 0.85));
    } finally { URL.revokeObjectURL(url); }
  }
  async function photosFolderId() {
    if (photoFolder) return photoFolder;
    const own = await driveFolder("Card Vault", null, true);
    photoFolder = await driveFolder("Photos", own, true);
    return photoFolder;
  }
  async function uploadPhoto(blob, name) {
    const folderId = await photosFolderId();
    const boundary = "cardvault" + Date.now();
    const body = new Blob(["--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify({name, mimeType: "image/jpeg", parents: [folderId]}) +
      "\r\n--" + boundary + "\r\nContent-Type: image/jpeg\r\n\r\n", blob, "\r\n--" + boundary + "--"]);
    const j = await (await driveFetch(GDRIVE_UPLOAD + "files?uploadType=multipart&fields=id", {method: "POST", headers: {"Content-Type": "multipart/related; boundary=" + boundary}, body})).json();
    if (!j || !j.id) throw new Error("Google Drive didn't keep it");
    return j.id;
  }
  const photoName = (r, side) => ((r.name || "Card") + (r.number && !r.sealed ? " " + r.number : "") + " " + side).replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) + ".jpg";
  async function addPhoto(id, side, file) {
    const say = t => { const n = $("photoNote"); if (n && drawerCtx && drawerCtx.id === id) n.textContent = t; };
    if (!driveToken()) { say("Sign in to Google Drive again first (Resume, at the top of the page)."); return; }
    say("Saving the " + side + " photo to your Google Drive…");
    try {
      const blob = await shrinkPhoto(file);
      const r0 = collection.find(x => x.id === id);
      const fileId = await uploadPhoto(blob, photoName(r0 || {}, side));
      photoURLs.set(fileId, Promise.resolve(URL.createObjectURL(blob)));
      const r = collection.find(x => x.id === id);
      if (!r) { say("The card was removed meanwhile; the photo is in your Google Drive anyway."); return; }
      r.photos = normPhotos((r.photos || []).filter(p => p.side !== side).concat([{id: fileId, side, at: new Date().toISOString()}]));
      save(); renderSoon();
      redrawPhotos(id);
      toast("Saved the " + side + " photo of " + r.name + " in your Google Drive.");
    } catch (e) {
      say("Couldn't save the photo: " + ((e && e.message) || e) + ". Try again in a moment.");
    }
  }
  const trashPhoto = (fileId, trashed) => driveFetch("files/" + encodeURIComponent(fileId), {method: "PATCH", headers: {"Content-Type": "application/json"}, body: JSON.stringify({trashed})}).catch(() => null);
  function showPhoto(url, label) {
    armBack();
    const box = document.createElement("div");
    box.className = "photo-full";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", label);
    box.innerHTML = '<img alt="' + esc(label) + '"><button type="button" class="btn btn-small">Close</button>';
    box.querySelector("img").src = url;
    const close = () => { box.remove(); document.removeEventListener("keydown", onKey, true); };
    const onKey = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    box.addEventListener("click", close);
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(box);
    box.querySelector("button").focus();
  }
  function wirePhotos(id) {
    const box = $("photoBox");
    if (!box) return;
    fillPhotos();
    box.addEventListener("change", e => {
      const inp = e.target.closest("[data-photo-add]");
      if (inp && inp.files && inp.files[0]) addPhoto(id, inp.dataset.photoAdd, inp.files[0]);
    });
    box.addEventListener("click", e => {
      const r = collection.find(x => x.id === id);
      if (!r) return;
      const v = e.target.closest("[data-photo-view]");
      if (v) { photoURL(v.dataset.photoView).then(u => showPhoto(u, "Your photo of " + r.name)).catch(() => toast("Couldn't load the photo right now.", {kind: "error"})); return; }
      const sv = e.target.closest("[data-photo-save]");
      if (sv) {
        const p = (r.photos || []).find(x => x.side === sv.dataset.photoSave);
        if (p) photoURL(p.id).then(u => fetch(u)).then(res => res.blob()).then(b => download(b, photoName(r, p.side))).catch(() => toast("Couldn't load the photo right now.", {kind: "error"}));
        return;
      }
      const d = e.target.closest("[data-photo-del]");
      if (d) {
        const p = (r.photos || []).find(x => x.side === d.dataset.photoDel);
        if (!p) return;
        const was = r.photos;
        r.photos = normPhotos(r.photos.filter(x => x !== p));
        save(); renderSoon(); redrawPhotos(id);
        trashPhoto(p.id, true);   // (into your Google Drive's trash, which empties itself after 30 days)
        toast("Removed the " + p.side + " photo.", {action: "Undo", onAction: () => {
          const cur = collection.find(x => x.id === id);
          trashPhoto(p.id, false);
          if (cur) { cur.photos = was; save(); renderSoon(); redrawPhotos(id); }
        }});
      }
    });
  }
  // Finds "Card Vault backup.json" that Card Vault made in this Google account (from any device), or makes one.
  // The one in the "Card Vault" folder comes first: a file with the same name elsewhere in Google Drive (a PC's own
  // backup file in a folder that Google Drive for desktop syncs, say) may hold an older collection.
  async function driveFindOrCreate() {
    const about = await (await driveFetch("about?fields=user(emailAddress)")).json();
    const email = about && about.user ? about.user.emailAddress || "" : "";
    const fq = encodeURIComponent("name = 'Card Vault' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
    const folders = await (await driveFetch("files?q=" + fq + "&pageSize=1&fields=files(id)")).json();
    let folderId = folders && folders.files && folders.files[0] ? folders.files[0].id : null;
    const find = async where => {
      const q = encodeURIComponent("name = '" + GDRIVE_FILE + "' and trashed = false" + (where ? " and '" + where + "' in parents" : ""));
      const list = await (await driveFetch("files?q=" + q + "&orderBy=modifiedTime desc&pageSize=10&fields=files(id,modifiedTime,size)")).json();
      return list && Array.isArray(list.files) && list.files.length ? list.files[0].id : null;
    };
    const fileId = (folderId && await find(folderId)) || await find(null);
    if (fileId) return {fileId, email, created: false};
    if (!folderId) {
      folderId = (await (await driveFetch("files?fields=id", {method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({name: "Card Vault", mimeType: "application/vnd.google-apps.folder"})})).json()).id;
    }
    const made = await (await driveFetch("files?fields=id", {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({name: GDRIVE_FILE, mimeType: "application/json", parents: folderId ? [folderId] : undefined})})).json();
    return {fileId: made.id, email, created: true};
  }
  // "Sync with Google Drive". Must run straight from a tap or click.
  function linkGoogleDrive(opts) {
    const signing = driveToken() && !(opts && opts.otherAccount) ? Promise.resolve(true) : driveSignIn({choose: true, purpose: "link"});
    return signing.then(async ok => {
      if (!ok) { toast("Google Drive wasn't connected. Try again when you're ready.", {kind: "error"}); return; }
      let link;
      try { link = await driveFindOrCreate(); }
      catch (e) { toast("Couldn't set up Google Drive: " + e.message + ".", {kind: "error"}); return; }
      try { localStorage.setItem(GDRIVE_KEY, JSON.stringify({fileId: link.fileId, email: link.email})); } catch (e) { /* kept for this visit */ }
      await useBackupHandle(driveHandle(link));
    });
  }

  /* ----- keeping devices in sync through the backup file ----- */
  // Every device that uses the same backup file (in OneDrive, Google Drive or Dropbox) checks it regularly
  // and just before saving to it, and takes in what the others changed.
  const SYNC_EVERY = 15000;
  const sync = {seen: "", lastCheck: null, lastChange: null};
  const fileKey = f => f.lastModified + ":" + f.size;
  // Changes from the file are in place: save them here (not back to the file) and show them.
  function afterMerge(res, quietly) {
    rebuildPrints();
    for (const id of Array.from(selected)) if (!collection.some(r => r.id === id)) selected.delete(id);
    save({quiet: true, noBackup: true});
    if (!res.changed) return;
    // An Undo from before would put back the old version over what just arrived.
    document.querySelectorAll("#toasts .toast.has-action").forEach(t => t.remove());
    const openId = drawerCtx && (drawerCtx.id || drawerCtx.replaceId || drawerCtx.wantId);
    if (openId && res.removedIds.has(openId)) { closeDrawer(); toast("The card you had open was removed on another device."); }
    sync.lastChange = new Date();
    schedulePhoneCopy();
    render();
    if (!quietly) toast("Updated with changes from another device (" + mergeSummary(res) + ").");
  }
  // The safety check stops syncing (both ways) until you choose; the file is still looked at, so if it's put right on
  // the other device, syncing carries on by itself.
  function holdNow(info, quiet) {
    const first = backup.state !== "hold";
    backup.state = "hold";
    backup.holdInfo = info;
    renderBackupBanner();
    refreshBackupSection();
    if (first && !quiet) toast("Syncing is paused: the backup file would remove " + holdWhat(info) + " here. Choose what to do at the top.", {kind: "error"});
  }
  function holdWhat(info) {
    const bits = [];
    if (info.lostCards) bits.push(plural(info.lostCards, "card") + " from your collection");
    if (info.allWants) bits.push("your whole want list");
    else if (info.lostWants) bits.push(wantCount(info.lostWants) + " from your want list");
    return bits.join(" and ") || "several cards";
  }
  async function checkBackupFile(manual) {
    const h = backup.handle;
    const live = () => backup.state === "active" || backup.state === "shrink" || backup.state === "hold";
    if (!h || !live()) return false;
    if (manual) while (backup.busy) await pause(50);
    if (backup.busy || !live()) return false;
    backup.busy = true;
    let res = null;
    try {
      const f = await h.getFile();
      const key = fileKey(f);
      if (key !== sync.seen || manual) {
        let data = null;
        try { data = f.size ? JSON.parse(await f.text()) : null; } catch (e) { data = null; }
        // (unreadable for the moment, say while a sync app is updating it: try again next time)
        if (data && data.app === "Card Vault" && Array.isArray(data.collection)) {
          sync.seen = key;
          const rel = relationTo(data);
          if (rel === "ask") {
            backup.state = "link";
            backup.linkInfo = linkInfoFor(data);
            renderBackupBanner();
          } else if (rel === "mine" || rel === "empty") {
            // what's here is newest (or the file is empty): save it
            if (rel === "mine" || hasLocalData()) backup.again = true;
          } else {
            const hold = rel !== "load" && holdFor(data);
            if (hold) {
              holdNow(hold);
            } else {
              if (backup.state === "hold") {   // (the file was put right on the other device)
                backup.state = "active"; backup.holdInfo = null;
                renderBackupBanner(); refreshBackupSection();
              }
              if (data.syncId) settings.syncId = data.syncId;
              else backup.again = true;   // (a file from before syncing: give it a sync id)
              if (rel === "load") deleted = cleanDeleted({});
              res = mergeBackup(data, {fileWins: rel === "load"});
              if (res.changed) sync.lastFrom = typeof data.savedOn === "string" ? data.savedOn.slice(0, 80) : "";
              if (res.changed || res.touched) afterMerge(res);
              if (h.kind === "gdrive") { noteCloudBasis(data.savedAt); cloudAlertsWrite(false); }
            }
          }
        }
      }
      sync.lastCheck = new Date();
    } catch (e) {
      if (backup.handle === h && e && (e.name === "NotAllowedError" || e.name === "SecurityError")) {
        backup.state = "paused";
        renderBackupBanner();
      }
    }
    backup.busy = false;
    // This device has changes the file doesn't: save them for the other devices.
    if ((backup.again || (res && res.behind)) && live()) { backup.again = false; scheduleBackup(true); }
    refreshSyncNote();
    return !!(res && res.changed);
  }
  // Replacing the file's contents on purpose: whatever is only in the file counts as deleted, so the other
  // devices that use the file drop it too, and what's here is made newer than anything in the file, so it
  // wins on every computer.
  function deleteWhatsOnlyIn(data) {
    const now = Date.now();
    const theirGone = cleanDeleted(data.deleted);
    for (const k of SYNC_KINDS) {
      const theirMod = new Map();
      if (Array.isArray(data[k])) for (const x of data[k]) if (x && x.id) theirMod.set(x.id, modTime(x.mod));
      const here = new Set(listOf(k).map(x => x.id));
      for (const x of listOf(k)) x.mod = Math.max(now, (x.mod || 0) + 1, (theirMod.get(x.id) || 0) + 1, (theirGone[k][x.id] || 0) + 1);
      for (const [id, t] of Object.entries(theirGone[k])) if (!here.has(id) && !(deleted[k][id] >= t)) deleted[k][id] = t;
      for (const [id, m] of theirMod) if (!here.has(id)) deleted[k][id] = Math.max(now, m + 1, deleted[k][id] || 0);
    }
    const ds = data.settings && typeof data.settings === "object" ? data.settings : {};
    settings.sharedMod = Math.max(now, modTime(settings.sharedMod) + 1, modTime(ds.sharedMod) + 1);
    rebuildPrints();
    save({quiet: true, noBackup: true});
  }
  const hasLocalData = () => SYNC_KINDS.some(k => listOf(k).length);
  const fileHasData = data => !!data && SYNC_KINDS.some(k => Array.isArray(data[k]) && data[k].length);
  // How this computer and a backup file go together. Cards saved before syncing existed have no reliable dates,
  // so the first time a computer meets a file it doesn't combine them blindly:
  //   "synced": kept in sync before (same sync id): combine the changes.
  //   "adopt":  this computer saved the file last, and other computers sync with it: combine, and follow it.
  //   "mine":   a file from before syncing existed, and this computer saved since: what's here is the newest.
  //   "load":   nothing here yet: take everything from the file.
  //   "empty":  nothing in the file: just save to it.
  //   "ask":    both have cards and were never synced: you choose (see resolveLink).
  function relationTo(data) {
    if (!data) return "empty";
    if (data.syncId && data.syncId === settings.syncId) return "synced";
    const mySave = settings.lastFileSaveAt || settings.lastBackupAt;   // (lastFileSaveAt: only saves to the backup file)
    const savedHere = !!(data.savedAt && mySave && data.savedAt === mySave);
    if (!fileHasData(data)) return data.syncId ? "adopt" : "empty";   // (nothing to lose: follow its sync id, if any)
    if (data.syncId && savedHere) return "adopt";
    // a file from before syncing existed that this computer saved last: what's here is newest
    if (!data.syncId && savedHere) return "mine";
    if (!hasLocalData()) return "load";
    return "ask";
  }
  // "Use the file's collection": this computer's collection, want list, decks and sales become the file's.
  function useFileCollection(data) {
    for (const k of SYNC_KINDS) if (Array.isArray(data[k])) { setListOf(k, []); deleted[k] = {}; }
    settings.sharedMod = 0;
    rebuildPrints();
    afterMerge(mergeBackup(data, {fileWins: true}), true);
  }
  // The choice offered when this computer and the file have different collections.
  async function resolveLink(choice) {
    const h = backup.handle;
    if (!h || backup.state !== "link") return;
    while (backup.busy) await pause(50);
    let data;
    try { data = await readBackupFile(h); }
    catch (e) { toast("Couldn't read " + h.name + " just now (" + e.message + "). Try again in a moment.", {kind: "error"}); return; }
    if (!data && choice !== "mine") { toast("Couldn't read " + h.name + " just now (it may be syncing). Try again in a moment.", {kind: "error"}); return; }
    if (fileHasData(data)) {
      if (data.syncId) settings.syncId = data.syncId;
      if (choice === "file") useFileCollection(data);
      else if (choice === "both") afterMerge(mergeBackup(data, {fileWins: true}), true);
    }
    backup.state = "active";
    const ok = await writeBackup(choice === "mine" ? {rel: "replace", force: true, manual: true} : {rel: "synced", manual: true, quiet: true});
    if (ok) {
      toast(choice === "mine" ? "Saved " + HERE + "'s collection to " + h.name + ". Your other " + (SITE ? "devices" : "computers") + " that use it will switch to it."
        : HERE.charAt(0).toUpperCase() + HERE.slice(1) + " and " + h.name + " are in sync: " + plural(collection.length, "printing") + ".");
    }
  }
  // Whether a backup file and this browser hold the same collection (synced before), not two separate ones.
  function sharesEntries(data) {
    for (const k of SYNC_KINDS) {
      if (!Array.isArray(data[k])) continue;
      const theirs = new Set(data[k].map(x => x && x.id).filter(Boolean));
      if (listOf(k).some(x => theirs.has(x.id))) return true;
    }
    return false;
  }
  function linkInfoFor(data) {
    return {printings: data.collection.length, savedAt: data.savedAt || "", shares: sharesEntries(data),
      // a file saved by an older Card Vault, while this computer has been syncing: this computer is probably newest
      olderApp: !data.syncId && !!settings.syncId};
  }
  function refreshSyncNote() {
    const el = document.getElementById("syncNote");
    if (el) el.innerHTML = syncNoteHTML();
  }
  function syncNoteHTML() {
    if (backup.state !== "active") return "";
    const bits = [];
    if (sync.lastCheck) bits.push("Last checked " + esc(fmtTime(sync.lastCheck)) + ".");
    if (sync.lastChange) bits.push("Last changes from another device: " + esc(fmtDateTime(sync.lastChange)) + (sync.lastFrom ? " (" + esc(sync.lastFrom) + ")" : "") + ".");
    if (backup.handle && backup.handle.kind === "gdrive") {
      return '<p class="small" style="margin:8px 0 0">On your other devices, open this website and choose Sync with Google Drive with the same Google account. ' +
        "Card Vault checks Google Drive every 15 seconds while it's open, and before every save, and brings in the changes made on the others. " + bits.join(" ") + "</p>";
    }
    return '<p class="small" style="margin:8px 0 0">Using Card Vault on more than one computer? Choose this same file on each one (Settings > Backup > Use a different file). ' +
      "Card Vault checks it every 15 seconds while it's open, and before every save, and brings in the changes made on the others. " + bits.join(" ") + "</p>";
  }
  async function initBackup() {
    if (backup.drive) {
      const link = readJSON(GDRIVE_KEY, null);
      let pending = "";
      try { pending = localStorage.getItem(GPENDING_KEY) || ""; localStorage.removeItem(GPENDING_KEY); } catch (e) { /* ignore */ }
      if (!(link && link.fileId) && pending === "link" && driveToken()) {
        linkGoogleDrive();   // signed in on Google's page (popups were blocked): carry on setting up
      } else if (link && link.fileId) {
        backup.handle = driveHandle(link);
        backup.state = driveToken() ? "active" : "paused";
        if (backup.state === "active") {
          await checkBackupFile();  // changes made on another device since Card Vault was last open here
          if (backup.state === "active" && hasUnbackedChanges()) scheduleBackup(true);
        }
      }
    } else if (!backup.supported) {
      backup.state = "unsupported";
    } else {
      try {
        const h = await idbGet("backupFile");
        if (h && typeof h.queryPermission === "function") {
          backup.handle = h;
          const perm = await h.queryPermission({mode: "readwrite"});
          backup.state = perm === "granted" ? "active" : "paused";
          if (backup.state === "active") {
            await checkBackupFile();  // changes made on another device since Card Vault was last open here
            if (backup.state === "active" && hasUnbackedChanges()) scheduleBackup(true);
          }
        }
      } catch (e) {
        backup.state = "off";
      }
      try {
        const ph = await idbGet("phoneFile");
        if (ph && typeof ph.queryPermission === "function") {
          phone.handle = ph;
          phone.state = (await ph.queryPermission({mode: "readwrite"})) === "granted" ? "active" : "paused";
          if (phone.state === "active") schedulePhoneCopy(true);  // fresh prices on every start
        }
      } catch (e) {
        phone.state = "off";
      }
    }
    renderBackupBanner();
    refreshBackupSection();
  }
  function scheduleBackup(now) {
    schedulePhoneCopy();
    if (backup.state === "active" || backup.state === "shrink") {
      clearTimeout(backup.timer);
      backup.timer = setTimeout(() => writeBackup(), now ? 0 : 1200);
    } else if ($("backupBanner")) {
      renderBackupBanner();
    }
  }
  // opts.force: you said to save even though the file has many more cards (the size check).
  // opts.rel: "replace" (Keep this computer's) or "synced" (you chose how to combine them).
  // opts.manual: you asked for it, so it waits for a check in progress instead of being folded into it.
  async function writeBackup(opts) {
    opts = opts || {};
    clearTimeout(backup.timer);
    backup.timer = null;
    const h = backup.handle;
    if (!h) return false;
    if (backup.busy) {
      if (!(opts.manual || opts.force || opts.rel)) { backup.again = true; return false; }
      while (backup.busy) await pause(50);
      if (backup.handle !== h) return false;
    }
    backup.busy = true;
    const stamp = new Date().toISOString();
    let ok = false, w = null;
    try {
      const old = await readBackupFile(h);
      const rel = opts.rel || relationTo(old);
      if (rel === "ask") { Object.assign(backup, {linkInfo: linkInfoFor(old)}); throw {link: true}; }
      if (rel === "synced" || rel === "adopt" || rel === "load") {
        // Another computer may have changed the file since this one last looked: take those changes in first,
        // so saving here doesn't undo them.
        if (old && old.syncId) settings.syncId = old.syncId;
        if (old) {
          // (the safety check: a file that would take away many cards here waits for your OK, and isn't saved over)
          const hold = rel !== "load" && holdFor(old);
          if (hold) throw {hold};
          // (nothing here yet: everything comes from the file, card-value settings too)
          if (rel === "load") deleted = cleanDeleted({});
          const res = mergeBackup(old, {fileWins: rel === "load"});
          if (res.changed) sync.lastFrom = typeof old.savedOn === "string" ? old.savedOn.slice(0, 80) : "";
          if (res.changed || res.touched) afterMerge(res, opts.quiet);
        }
      } else if ((rel === "mine" || rel === "replace") && old) {
        // what's here replaces the file: what's only in the file counts as deleted (for any other computer)
        if (rel === "replace" && old.syncId) settings.syncId = old.syncId;
        deleteWhatsOnlyIn(old);
      }
      if (!settings.syncId) settings.syncId = newId() + newId();
      // Never quietly replace a backup with a much smaller collection: that's what happens
      // when a browser's data was cleared, and the file is then the only good copy.
      const oldN = old ? old.collection.length : 0;
      if (!opts.force && rel !== "replace" && oldN >= 4 && collection.length < oldN / 2) {
        Object.assign(backup, {fileCount: oldN, fileSavedAt: old.savedAt || ""});
        throw {shrink: true};
      }
      w = await h.createWritable();
      await w.write(JSON.stringify(backupPayload(stamp), null, 1));
      const saved = await w.close();
      w = null;
      try { sync.seen = fileKey(saved && saved.lastModified ? saved : await h.getFile()); sync.lastCheck = new Date(); } catch (e) { /* checked next time */ }
      backup.offline = false;
      if (backup.handle === h) {
        settings.lastBackupAt = settings.lastFileSaveAt = stamp;
        saveSettings();
        backup.state = "active";
        backup.error = "";
      }
      ok = true;
      if (h.kind === "gdrive") { dated.body = JSON.stringify(backupPayload(stamp)); driveDatedCopy(h, stamp).then(() => { dated.body = null; }); noteCloudBasis(stamp); cloudAlertsWrite(false); }
    } catch (e) {
      if (w) { try { await w.abort(); } catch (e2) { /* nothing more to undo */ } }
      if (backup.handle === h) {  // (ignore a write that finished after backups were turned off or moved)
        if (e && e.hold) holdNow(e.hold, true);
        else if (e && e.shrink) backup.state = "shrink";
        else if (e && e.link) backup.state = "link";
        else if (e && e.name === "NetworkError") {
          // No internet (at a card shop, say): changes stay on this device and go to Google Drive once it's back.
          backup.offline = true;
          clearTimeout(backup.retry);
          backup.retry = setTimeout(() => { if (backup.state === "active") scheduleBackup(true); }, 60000);
        } else {
          backup.state = e && (e.name === "NotAllowedError" || e.name === "SecurityError") ? "paused" : "error";
          backup.error = (e && e.message) || String(e);
        }
      }
    }
    backup.busy = false;
    renderBackupBanner();
    refreshBackupSection();
    const again = backup.again;
    backup.again = false;
    if (again && (backup.state === "active" || backup.state === "shrink")) scheduleBackup();
    return ok;
  }
  // Must run straight from a click: the browser only shows its save window in response to one.
  async function chooseBackupFile() {
    if (backup.drive) return linkGoogleDrive({otherAccount: !!backup.handle});
    if (!backup.supported) { downloadBackup(); return; }
    let h;
    try {
      h = await window.showSaveFilePicker({suggestedName: "Card Vault backup.json",
        types: [{description: "Card Vault backup", accept: {"application/json": [".json"]}}]});
    } catch (e) {
      if (e && e.name === "AbortError") return;  // closed the window without choosing
      toast("Couldn't set up the backup file: " + ((e && e.message) || e), {kind: "error"});
      return;
    }
    return useBackupHandle(h);
  }
  // Starts saving to (and syncing with) a backup file: one chosen on this computer, or the one in Google Drive.
  async function useBackupHandle(h) {
    while (backup.busy) await pause(50);
    // The file may already hold a backup (from another computer, or from before the browser's data was cleared).
    let old;
    try { old = await readBackupFile(h); }
    catch (e) { toast("Couldn't read " + h.name + ": " + e.message + ". Try again in a moment.", {kind: "error"}); return; }
    const rel = relationTo(old);
    if (rel === "load") {
      const when = parseDate(old.savedAt);
      const desc = plural(old.collection.length, "printing") + (when ? ", saved " + fmtDateTime(when) : "");
      if (!confirm(h.name + " already has a Card Vault backup (" + desc + ").\n\nLoad it into Card Vault now? After that, Card Vault keeps " + HERE + " and the file in sync.")) {
        toast("Automatic backup wasn't turned on, and the file wasn't changed.");
        return;
      }
    }
    backup.handle = h;
    if (h.kind !== "gdrive") { try { await idbPut("backupFile", h); } catch (e) { /* still works until Card Vault is closed */ } }
    if (rel === "ask") {
      // Two different collections: nothing is changed until you choose how to put them together.
      backup.state = "link";
      backup.linkInfo = linkInfoFor(old);
      renderBackupBanner();
      refreshBackupSection();
      toast(h.name + " already has a different collection. Choose how to put the two together.");
      return;
    }
    backup.state = "active";
    if (await writeBackup({manual: true, quiet: true})) {
      const synced = rel === "load" || rel === "synced" || rel === "adopt";
      toast(h.kind === "gdrive"
        ? (synced ? "Syncing with Google Drive: " + HERE + " has " + plural(collection.length, "printing") + ", the same as the backup file in your Google Drive."
          : "Syncing with Google Drive. Card Vault keeps Card Vault backup.json in your Google Drive up to date whenever you make a change.")
        : synced ? "Automatic backup is on, and " + HERE + " is in sync with " + h.name + ": " + plural(collection.length, "printing") + "."
        : "Automatic backup is on. Card Vault keeps " + h.name + " up to date whenever you make a change.");
    }
    else if (backup.state !== "shrink" && backup.state !== "link" && backup.state !== "hold") toast("Couldn't write to " + h.name + ": " + backup.error, {kind: "error"});
  }
  async function resumeBackup() {
    const paused = [backup, phone].filter(t => t.handle && t.state === "paused");
    if (!paused.length) { if (!backup.handle) chooseBackupFile(); return; }
    // Ask about every paused file at once: the browser only asks during a click.
    const answers = await Promise.allSettled(paused.map(t => t.handle.requestPermission({mode: "readwrite"})));
    let refused = false;
    answers.forEach((a, i) => { if (a.status === "fulfilled" && a.value === "granted") paused[i].state = "active"; else refused = true; });
    if (paused.includes(phone) && phone.state === "active") writePhoneCopy();
    if (paused.includes(backup) && backup.state === "active" && await writeBackup()) {
      toast(backup.handle.kind === "gdrive" ? "Signed in to Google Drive again. Everything is in sync." : "Backups resumed. " + backup.handle.name + " is up to date.");
    }
    if (refused) toast(backup.drive ? "Still not signed in to Google Drive. Changes are kept on this device until you are." : "Saving stays paused until you allow Card Vault to save the file.");
    renderBackupBanner();
    refreshBackupSection();
  }
  // The collection shrank a lot compared with the backup file: load the file, or overwrite it on purpose.
  async function loadBackupFile() {
    let data = null;
    try { data = backup.handle ? await readBackupFile(backup.handle) : null; } catch (e) { data = null; }
    if (!data) { toast("Couldn't read " + (backup.handle ? backup.handle.name : "the backup file") + ".", {kind: "error"}); return; }
    if (restoreBackup(JSON.stringify(data), backup.handle.name)) { backup.state = "active"; scheduleBackup(true); }
  }
  async function forceBackup() {
    backup.state = "active";
    if (await writeBackup({force: true})) toast("Updated " + backup.handle.name + ".");
  }
  async function stopBackup() {
    clearTimeout(backup.timer);
    const wasDrive = backup.handle && backup.handle.kind === "gdrive";
    backup.handle = null;
    backup.state = backup.supported ? "off" : "unsupported";
    if (wasDrive) {
      // Google forgets the access too (best effort; works without an answer)
      const t = (readJSON(GTOKEN_KEY, null) || {}).token;
      if (t) fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(t), {method: "POST", mode: "no-cors"}).catch(() => {});
      try { localStorage.removeItem(GDRIVE_KEY); localStorage.removeItem(GTOKEN_KEY); } catch (e) { /* nothing stored */ }
    }
    else { try { await idbPut("backupFile", undefined); } catch (e) { /* nothing stored */ } }
    renderBackupBanner();
    refreshBackupSection();
    toast(wasDrive ? "Syncing with Google Drive is off on this device. Your backup file is still in your Google Drive."
      : "Automatic backup is off. Your backup file is still there.");
  }
  // Up to 7 daily copies kept in this browser (the collection as it was when you first opened
  // Card Vault that day), in case a change reaches the backup file before you notice it.
  async function snapshotToday() {
    if (!collection.length) return;
    try {
      const day = localDay(new Date());
      const list = (await idbGet("snapshots")) || [];
      if (list.some(x => x.day === day)) return;
      list.push({day, savedAt: new Date().toISOString(), printings: collection.length, cards: collection.reduce((s, r) => s + r.qty, 0),
        data: JSON.stringify(backupPayload())});
      list.sort((x, y) => (x.day < y.day ? -1 : 1));
      while (list.length > 7) list.shift();
      await idbPut("snapshots", list);
    } catch (e) { /* optional safety net */ }
  }
  async function fillSnapshots() {
    const box = document.getElementById("snapList");
    if (!box) return;
    let list = [];
    try { list = (await idbGet("snapshots")) || []; } catch (e) { list = null; }
    if (!list || !list.length) {
      box.innerHTML = '<p class="small" style="margin:0">' + (list ? "The first copy is kept the next time you open Card Vault." : "This browser can't keep copies.") + "</p>";
      return;
    }
    box.innerHTML = '<table class="data-table"><tbody>' + list.slice().reverse().map((x, i) => "<tr><td>" + esc(fmtDateTime(parseDate(x.savedAt))) +
      '</td><td class="num">' + plural(x.printings, "printing") + '</td><td class="num"><button class="btn btn-small" type="button" data-snap="' + esc(x.day) + '">Restore</button></td></tr>').join("") +
      "</tbody></table>";
    box.querySelectorAll("[data-snap]").forEach(b => b.addEventListener("click", () => {
      const x = list.find(y => y.day === b.dataset.snap);
      if (x && restoreBackup(x.data, "the copy from " + fmtDate(parseDate(x.savedAt)))) closeDrawer();
    }));
  }
  function downloadBackup() {
    download(new Blob([JSON.stringify(backupPayload(), null, 1)], {type: "application/json"}), "Card Vault backup " + localDay(new Date()) + ".json");
    settings.lastBackupAt = new Date().toISOString();
    settings.backupSnoozeUntil = 0;
    saveSettings();
    renderBackupBanner();
    refreshBackupSection();
    toast("Downloaded a backup of " + plural(collection.length, "printing") + ". Keep it somewhere safe, like OneDrive or Google Drive.");
  }
  function mergeHistory(current, older) {
    const map = new Map();
    for (const p of older.concat(current)) if (p && parseDay(p.d) && isFinite(p.v)) map.set(p.d, {d: p.d, v: +p.v, c: posInt(p.c)});
    return Array.from(map.values()).sort((a, b) => (a.d < b.d ? -1 : 1)).slice(-1100);
  }
  function restoreBackup(text, fileName) {
    let data = null;
    try { data = JSON.parse(backupTextFrom(text)); } catch (e) { data = null; }
    if (!data || data.app !== "Card Vault" || !Array.isArray(data.collection)) {
      toast((fileName ? '"' + fileName + '"' : "That file") + " isn't a Card Vault backup. To load a list of cards, use Import CSV.", {kind: "error"});
      return false;
    }
    const recs = data.collection.map(upgradeRecord).filter(Boolean);
    const ws = Array.isArray(data.wants) ? data.wants.map(upgradeWant).filter(Boolean) : [];
    const when = parseDate(data.savedAt);
    const msg = "Restore the backup" + (when ? " from " + fmtDateTime(when) : "") + "?\n\nIt has " + plural(recs.length, "printing") + " (" +
      plural(recs.reduce((s, r) => s + r.qty, 0), "card") + ") and " + plural(ws.length, "want list card") + "." +
      (collection.length || wants.length ? "\n\nIt replaces what's in Card Vault now (" + plural(collection.length, "printing") + ", " +
        plural(wants.length, "want list card") + ")." : "") +
      (backup.state === "active" && settings.syncId ? "\n\nYour other computers that use the same backup file will switch to it too." : "");
    if (!confirm(msg)) return false;
    applyBackup(data);
    return true;
  }
  // A phone copy carries a full backup inside it, so it can be restored too.
  function backupTextFrom(text) {
    text = String(text || "");
    if (!/^\s*</.test(text)) return text;
    const m = text.match(/<script type="application\/json" id="cardvault-backup">([\s\S]*?)<\/script>/);
    return m ? m[1] : "";
  }
  // Puts a backup's cards, want list and card-value settings in place (with Undo).
  function applyBackup(data) {
    const recs = data.collection.map(upgradeRecord).filter(Boolean);
    const ws = Array.isArray(data.wants) ? data.wants.map(upgradeWant).filter(Boolean) : [];
    const before = {collection, wants, decks, sales, openings, valueHistory: valueHistory.slice(), condAdjust: settings.condAdjust, condPct: Object.assign({}, settings.condPct),
      alertsOn: settings.alertsOn, alertMinDollar: settings.alertMinDollar, alertMinPct: settings.alertMinPct,
      psa10Mult: settings.psa10Mult, psa10Floor: settings.psa10Floor, gradePct: Object.assign({}, settings.gradePct), pcToken: settings.pcToken};
    collection = recs;
    wants = ws;
    // (Backups from before decks and sales existed leave the current ones alone.)
    if (Array.isArray(data.decks)) decks = data.decks.map(upgradeDeck).filter(Boolean);
    if (Array.isArray(data.sales)) sales = data.sales.map(upgradeSale).filter(Boolean);
    if (Array.isArray(data.openings)) openings = data.openings.map(upgradeOpening).filter(Boolean);
    if (Array.isArray(data.valueHistory)) valueHistory = mergeHistory(valueHistory, data.valueHistory);
    const ds = data.settings;
    if (ds && typeof ds === "object") applySharedSettings(ds);
    if (ds && Array.isArray(ds.setGoals)) settings.setGoals = cleanGoals(ds.setGoals);
    if (ds && Array.isArray(ds.themeGoals)) settings.themeGoals = cleanThemeGoals(ds.themeGoals);
    selected.clear();
    autoLink();
    save();
    render();
    toast("Restored " + plural(recs.length, "printing") + " and " + plural(ws.length, "want list card") + ".", {action: "Undo", onAction: () => {
      collection = before.collection;
      wants = before.wants;
      decks = before.decks;
      sales = before.sales;
      openings = before.openings;
      valueHistory = before.valueHistory;
      settings.condAdjust = before.condAdjust;
      settings.condPct = before.condPct;
      settings.alertsOn = before.alertsOn;
      settings.alertMinDollar = before.alertMinDollar;
      settings.alertMinPct = before.alertMinPct;
      settings.psa10Mult = before.psa10Mult; settings.psa10Floor = before.psa10Floor; settings.gradePct = before.gradePct; settings.pcToken = before.pcToken;
      save(); render(); toast("Restore undone.");
    }});
  }
  function backupReminderDue() {
    const days = num(settings.backupRemindDays);
    if (!days || !collection.length || !hasUnbackedChanges()) return false;
    if (Date.now() < (settings.backupSnoozeUntil || 0)) return false;
    const last = parseDate(settings.lastBackupAt);
    return !last || Date.now() - last.getTime() >= days * 86400000;
  }
  function renderBackupBanner() {
    const b = $("backupBanner");
    const name = backup.handle ? "<b>" + esc(backup.handle.name) + "</b>" : "your backup file";
    const last = parseDate(settings.lastBackupAt);
    let html = "";
    const onDrive = !!(backup.handle && backup.handle.kind === "gdrive");
    if (backup.state === "paused" && onDrive) {
      html = "<strong>Sign in to Google Drive again to keep syncing.</strong> " + (silentTurnedDown() && settings.autoSignIn !== false
        ? "Card Vault usually renews Google's hour-long sign-in by itself, but this time Google wants you to. Until then, changes stay on this device."
        : "Google's sign-in lasts an hour at a time. Until you do, changes are kept on this device, and changes from your other devices wait.") +
        '<div class="banner-actions"><button class="btn btn-small btn-primary" type="button" data-banner="resume">Resume</button></div>';
    } else if (backup.state === "error" && onDrive) {
      html = "<strong>Card Vault couldn't reach your backup file in Google Drive.</strong> " + esc(backup.error ? backup.error.charAt(0).toUpperCase() + backup.error.slice(1) + "." : "") +
        '<div class="banner-actions"><button class="btn btn-small btn-primary" type="button" data-banner="retry">Try again</button>' +
        '<button class="btn btn-small" type="button" data-banner="choose">Set up Google Drive again</button></div>';
    } else if (backup.state === "hold") {
      html = "<strong>Syncing is paused: your backup would remove " + esc(holdWhat(backup.holdInfo || {})) + ".</strong> " + holdTextHTML() +
        '<div class="banner-actions"><button class="btn btn-small btn-primary" type="button" data-banner="hold-keep">Keep them</button>' +
        '<button class="btn btn-small" type="button" data-banner="hold-apply">Remove them here too</button></div>';
    } else if (backup.state === "paused" || phone.state === "paused") {
      const names = [backup.state === "paused" ? name : "", phone.state === "paused" && phone.handle ? "<b>" + esc(phone.handle.name) + "</b>" : ""].filter(Boolean);
      html = "<strong>" + (backup.state === "paused" ? "Automatic backup is paused." : "Your phone copy isn't being updated.") + "</strong> After the browser restarts, " +
        "it asks your OK again before Card Vault can keep saving to " + names.join(" and ") +
        (backup.state === "paused" ? ", or bring in changes from your other computers" : "") + "." +
        '<div class="banner-actions"><button class="btn btn-small btn-primary" type="button" data-banner="resume">Resume</button></div>';
    } else if (backup.state === "error") {
      html = "<strong>Card Vault couldn't save your backup file.</strong> " + name + " may be open in another program, or it was moved, renamed or deleted." +
        '<div class="banner-actions"><button class="btn btn-small btn-primary" type="button" data-banner="retry">Try again</button>' +
        '<button class="btn btn-small" type="button" data-banner="choose">Choose a backup file</button></div>';
    } else if (backup.state === "link") {
      html = "<strong>" + name + " has a different collection from " + HERE + ".</strong> " + linkTextHTML() +
        '<div class="banner-actions">' + linkButtonsHTML("banner") + "</div>";
    } else if (backup.state === "shrink") {
      html = "<strong>Card Vault didn't update your backup file.</strong> Your collection here has " + plural(collection.length, "printing") +
        ", but " + name + " has " + plural(backup.fileCount || 0, "printing") + ". In case something went wrong, the file was left as it was." +
        '<div class="banner-actions"><button class="btn btn-small btn-primary" type="button" data-banner="load-file">Load the backup file</button>' +
        '<button class="btn btn-small" type="button" data-banner="force">Update the file anyway</button></div>';
    } else if (backup.state !== "active" && backupReminderDue()) {
      const lead = last ? "Your last backup was " + plural(daysOld(last), "day") + " ago." : backup.supported ? "Keep a backup of your collection." : "You haven't backed up your collection yet.";
      html = backup.drive
        ? "<strong>Keep your collection in Google Drive.</strong> Then your phone and computer share one collection, and it's safe if this browser's data is ever cleared." +
          '<div class="banner-actions"><button class="btn btn-small btn-primary" type="button" data-banner="choose">Sync with Google Drive</button>' +
          '<button class="btn btn-small" type="button" data-banner="snooze">Not now</button></div>'
        : backup.supported
        ? "<strong>" + lead + "</strong> Card Vault can save a backup file automatically every time you make a change. Save it in OneDrive, Google Drive or Dropbox and you also have a copy that's off this computer." +
          '<div class="banner-actions"><button class="btn btn-small btn-primary" type="button" data-banner="choose">Turn on automatic backup</button>' +
          '<button class="btn btn-small" type="button" data-banner="snooze">Not now</button></div>'
        : "<strong>" + lead + "</strong> Your collection lives in this browser. A backup file keeps it safe if the browser's data is ever cleared." +
          '<div class="banner-actions"><button class="btn btn-small btn-primary" type="button" data-banner="download">Download a backup</button>' +
          '<button class="btn btn-small" type="button" data-banner="snooze">Remind me later</button></div>';
    }
    b.hidden = !html;
    b.innerHTML = html;
    syncBanners();
  }
  // When this computer and the backup file have different collections (see relationTo).
  function linkTextHTML() {
    const info = backup.linkInfo || {};
    const when = parseDate(info.savedAt);
    return "The file has " + plural(info.printings || 0, "printing") + (when ? " (saved " + esc(fmtDateTime(when)) + ")" : "") + "; " + HERE + " has " +
      plural(collection.length, "printing") + ". Card Vault won't save to the file or sync until you choose. " +
      "<b>Combine both</b> keeps every card, want, deck and sale from both; where both have the same one, the file's version is kept. " +
      "<b>Use the file's</b> switches " + HERE + " to the file's collection, want list, decks and sales. " +
      "<b>Keep " + HERE + "'s</b> switches the file, and your other " + (SITE ? "devices" : "computers") + " that use it, to " + HERE + "'s." +
      (info.olderApp ? " The file was saved by an older Card Vault (on another computer, probably), so " + HERE + "'s collection is likely the newest. Update Card Vault on that computer too."
        : (info.shares ? "" : " These look like two separate collections, so combining them could list cards you have in both twice.") +
          " If another computer still runs an older Card Vault, update it as well.");
  }
  function linkButtonsHTML(kind) {
    const info = backup.linkInfo || {};
    const pick = info.olderApp ? "mine" : info.shares ? "both" : "file";
    const btn = (act, label) => '<button class="btn btn-small' + (act === "link-" + pick ? " btn-primary" : "") + '" type="button" data-' + (kind === "banner" ? "banner" : "bk") + '="' + act + '">' + label + "</button>";
    return btn("link-both", "Combine both") + btn("link-file", "Use the file's") + btn("link-mine", "Keep " + HERE + "'s");
  }
  function renderWantBanner() {
    const b = $("wantBanner");
    const hits = wants.filter(w => wantStatus(w).hit);
    const key = (catalog ? catalog.priceDay : "") + ":" + hits.map(w => w.id).sort().join(",");
    if (!hits.length || settings.wantAlertSeen === key || settings.tab === "wants") {
      b.hidden = true;
      b.innerHTML = "";
    } else {
      b.hidden = false;
      b.dataset.key = key;
      b.innerHTML = "<strong>" + (hits.length === 1 ? esc(hits[0].name) + " is" : wantCount(hits.length) + " on your want list are") +
        " at or below your target price.</strong>" +
        '<div class="banner-actions"><button class="btn btn-small btn-primary" type="button" data-banner="wants">Show my want list</button>' +
        '<button class="btn btn-small" type="button" data-banner="want-dismiss">Dismiss</button></div>';
    }
    syncBanners();
  }


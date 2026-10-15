  /* ======================= Settings ======================= */
  function backupSectionHTML() {
    const last = parseDate(settings.lastBackupAt);
    const lastText = last ? "Last backup: " + esc(fmtDateTime(last)) + "." : "No backup yet.";
    const name = backup.handle ? "<b>" + esc(backup.handle.name) + "</b>" : "your backup file";
    const btn = (act, label, primary) => '<button class="btn btn-small' + (primary ? " btn-primary" : "") + '" type="button" data-bk="' + act + '">' + label + "</button>";
    let cls, text, buttons = "";
    const onDrive = !!(backup.handle && backup.handle.kind === "gdrive");
    const who = onDrive && backup.handle.email ? " (" + esc(backup.handle.email) + ")" : "";
    if (onDrive && backup.state === "active") {
      cls = "on"; text = "Syncing with Google Drive" + who + ". Every change is saved to <b>Card Vault backup.json</b> in your Google Drive a moment after you make it." +
        (backup.offline ? " <b>No internet right now:</b> changes are kept on this device and saved once you're back online." : "") + " " + lastText;
      buttons = btn("now", "Back up now") + btn("sync", "Check for changes now") + btn("stop", "Turn off");
    } else if (onDrive && backup.state === "paused") {
      cls = "warn"; text = "Google Drive sign-in has expired (it lasts an hour at a time). " + (settings.autoSignIn !== false && !silentTurnedDown()
        ? "Card Vault renews it by itself when you next open it or come back to it; tap Resume to do it now. "
        : "Tap Resume to sign in again; you usually won't need to type anything. ") + lastText;
      buttons = btn("resume", "Resume", true) + btn("stop", "Turn off");
    } else if (onDrive && backup.state === "error") {
      cls = "off"; text = "Couldn't reach " + name + " (" + esc(backup.error) + "). " + lastText;
      buttons = btn("now", "Try again", true) + btn("choose", "Set up Google Drive again") + btn("stop", "Turn off");
    } else if (backup.drive && !backup.handle) {
      cls = "off"; text = "Not syncing yet. Sync with Google Drive to keep your collection in your Google Drive, and to share it between your phone and computer. " + lastText;
      buttons = btn("choose", "Sync with Google Drive", true);
    } else if (backup.state === "active") {
      cls = "on"; text = "Automatic backup is on. Every change is saved to " + name + " a moment after you make it. " + lastText;
      buttons = btn("now", "Back up now") + btn("sync", "Check for changes now") + btn("choose", "Use a different file") + btn("stop", "Turn off");
    } else if (backup.state === "paused") {
      cls = "warn"; text = "Automatic backup is paused. The browser asks your OK again after it restarts before Card Vault can save to " + name +
        " (or bring in changes from your other computers). " + lastText;
      buttons = btn("resume", "Resume backups", true) + btn("stop", "Turn off");
    } else if (backup.state === "error") {
      cls = "off"; text = "Couldn't save to " + name + " (" + esc(backup.error) + "). " + lastText;
      buttons = btn("now", "Try again", true) + btn("choose", "Choose a backup file") + btn("stop", "Turn off");
    } else if (backup.state === "hold") {
      cls = "warn"; text = "Syncing is paused. " + holdTextHTML() + " " + lastText;
      buttons = btn("hold-keep", "Keep them", true) + btn("hold-apply", "Remove them here too") + btn("stop", "Turn off");
    } else if (backup.state === "link") {
      cls = "warn"; text = name + " has a different collection from " + HERE + ". " + linkTextHTML();
      buttons = linkButtonsHTML("bk") + btn("stop", "Turn off");
    } else if (backup.state === "shrink") {
      cls = "warn"; text = "Not updated: your collection here has " + plural(collection.length, "printing") + ", but " + name + " has " +
        plural(backup.fileCount || 0, "printing") + ", so the file was left as it was in case something went wrong. " + lastText;
      buttons = btn("load-file", "Load the backup file", true) + btn("force", "Update the file anyway") + btn("stop", "Turn off");
    } else if (backup.state === "unsupported") {
      cls = "warn"; text = "This browser can't save to a file automatically (Chrome and Edge can). Download a backup file now and then; Card Vault reminds you. " + lastText;
    } else {
      cls = "off"; text = "Automatic backup is off. " + lastText;
      buttons = btn("choose", "Turn on automatic backup", true);
    }
    return '<div class="status-line ' + cls + '"><span class="dot" aria-hidden="true"></span><span>' + text + "</span></div>" +
      (buttons ? '<div class="btn-row">' + buttons + "</div>" : "");
  }
  function refreshBackupSection() {
    const el = document.getElementById("backupSection");
    if (el) el.innerHTML = backupSectionHTML();
    const ph = document.getElementById("phoneSection");
    if (ph) ph.innerHTML = phoneSectionHTML();
    const al = document.getElementById("alertNote");
    if (al) al.innerHTML = alertNoteHTML();
    refreshSyncNote();
  }
  function settingsHTML() {
    const remind = [[3, "After 3 days"], [7, "After a week"], [14, "After 2 weeks"], [30, "After a month"], [0, "Never"]];
    const refs = PERIODS.filter(([k]) => catalog && catalog.refDays[k])
      .map(([k, label]) => esc(fmtDate(parseDay(catalog.refDays[k]))) + " (" + label.toLowerCase() + ")");
    const cards = collection.reduce((s, r) => s + r.qty, 0);
    return '<div class="section first"><h3>' + (backup.drive ? "Backup and sync" : "Backup") + "</h3>" +
      (backup.drive ? '<p class="small" style="margin:0 0 10px">Your collection is saved on this device. Syncing with Google Drive keeps a copy in your Google Drive, ' +
        "and lets your phone and computer share one collection.</p>"
      : '<p class="small" style="margin:0 0 10px">Your collection is saved in this browser. A backup file keeps it safe if the browser\'s data is ever cleared, and lets you move it to another computer. ' +
        "Save it in a folder that syncs, like OneDrive, Google Drive or Dropbox, for a copy that's off this computer too.</p>") +
      '<div id="backupSection">' + backupSectionHTML() + "</div>" + '<div id="syncNote">' + syncNoteHTML() + "</div>" +
      '<label class="field" style="margin:10px 0 0"><span>This device\'s name, shown on your other devices when a change comes from here</span>' +
      '<input class="input" id="sDeviceName" maxlength="60" placeholder="' + esc(deviceLabel(true)) + '" value="' + esc(settings.deviceName || "") + '"></label>' +
      (backup.drive ? '<label class="check-row" style="margin:10px 0 0"><input type="checkbox" class="check" id="sAutoSignIn"' + (settings.autoSignIn !== false ? " checked" : "") +
        "><span>Renew the Google Drive sign-in by itself when its hour runs out. Card Vault goes to Google and straight back, which looks like a quick reload; " +
        "it waits if you're in the middle of something.</span></label>" : "") +
      '<div class="btn-row"><button class="btn btn-small" type="button" data-bk="download">Download a backup file</button>' +
      '<button class="btn btn-small" type="button" data-bk="restore">Restore from a backup…</button></div>' +
      '<h3 style="margin:16px 0 6px;font-size:13.5px">Earlier versions kept in this browser</h3>' +
      '<p class="small" style="margin:0 0 8px">Your collection as it was when you first opened Card Vault on each of the last 7 days you used it.</p>' +
      '<div id="snapList"><p class="small" style="margin:0">Loading…</p></div>' +
      (backup.drive ? '<div id="driveCopiesWrap"' + (backup.handle && backup.handle.kind === "gdrive" ? "" : " hidden") + '><h3 style="margin:16px 0 6px;font-size:13.5px">Dated copies in your Google Drive</h3>' +
        '<p class="small" style="margin:0 0 8px">One copy a day, kept for 30 days in the Backups folder next to your backup file, in case a mistake syncs to every device. Restoring one replaces what\'s here (and syncs).</p>' +
        '<div id="driveCopies"></div></div>' : "") +
      '<label class="field" style="margin-top:14px"><span>When automatic backup is off, remind me to back up</span><select class="input" id="sRemind">' +
      remind.map(([v, l]) => '<option value="' + v + '"' + ((num(settings.backupRemindDays) || 0) === v ? " selected" : "") + ">" + l + "</option>").join("") +
      "</select></label></div>" +

      (SITE ? "" : '<div class="section"><h3>Phone copy</h3>' +
      '<p class="small" style="margin:0 0 10px">A file you can open on your phone to look through your collection and want list, for example at a card shop. ' +
      "It can't be changed there. Save it in OneDrive, Google Drive or Dropbox, then open it from that app on your phone; if it asks, open it in your web browser.</p>" +
      '<div id="phoneSection">' + phoneSectionHTML() + "</div></div>") +

      '<div class="section"><h3>Windows notifications</h3>' +
      '<label class="check-row"><input type="checkbox" class="check" id="sAlerts"' + (settings.alertsOn ? " checked" : "") +
      "><span>After each daily price update, let me know when a want-list card reaches my target price, one of my cards goes up or down a lot, or the market passes an asking price on my sell list</span></label>" +
      '<div class="alert-grid"><label class="field"><span>A lot means at least</span><span class="pct">$<input class="input" type="number" min="0" step="1" id="sAlertDollar" value="' +
      esc(settings.alertMinDollar) + '"></span></label><label class="field"><span>and at least</span><span class="pct"><input class="input" type="number" min="0" max="1000" step="1" id="sAlertPct" value="' +
      esc(settings.alertMinPct) + '">%</span></label></div>' +
      '<p class="small" style="margin:8px 0 0">Counted for all your copies of a card together, since the last update.</p>' +
      '<div id="alertNote">' + alertNoteHTML() + "</div></div>" +

      '<div class="section"><h3>Phone alerts</h3><div id="phoneAlerts">' + phoneAlertsHTML() + "</div>" +
      '<div id="cloudAlertsWrap"' + (settings.ntfyTopic ? "" : " hidden") + '><h4 class="pa-sub">Without your PC</h4><div id="cloudAlerts">' + cloudAlertsHTML() + "</div></div></div>" +

      '<div class="section" id="sellingSection"><h3>Selling fees</h3>' +
      '<p class="small" style="margin:0 0 10px">What the site you sell on keeps from each card: a share of the price plus a fixed amount. Your sell list uses these to show what you\'d keep. ' +
      "For cards on eBay and TCGplayer it has been around 13% plus 30 to 40 cents; fees change, so check the site you sell on.</p>" +
      '<div class="alert-grid"><label class="field"><span>Share of the price</span><span class="pct"><input class="input" type="number" min="0" max="60" step="0.1" id="sSellPct" value="' + esc(sellPct()) + '">%</span></label>' +
      '<label class="field"><span>Plus, per card</span><span class="pct">$<input class="input" type="number" min="0" max="50" step="0.01" id="sSellFlat" value="' + esc(sellFlat()) + '"></span></label></div></div>' +

      '<div class="section"><h3>On a phone or tablet</h3>' +
      '<label class="check-row"><input type="checkbox" class="check" id="sSwipe"' + (settings.swipeCopies !== false ? " checked" : "") +
      "><span>Swipe a card to change how many copies you have: right adds one, left takes one away (you can Undo it)</span></label></div>" +

      '<div class="section"><h3>Played cards</h3>' +
      '<label class="check-row"><input type="checkbox" class="check" id="sCondAdjust"' + (settings.condAdjust ? " checked" : "") +
      "><span>Value played cards below the market price</span></label>" +
      '<p class="small" style="margin:8px 0 0">TCGplayer\'s market price reflects Near Mint copies. With this on, each card counts at the share of it below. ' +
      "Graded cards use the graded value you enter, and prices from a TCGplayer CSV or your own estimates are used as they are.</p>" +
      '<div class="cond-grid">' + CONDITIONS.map(c => '<label class="field"><span>' + esc(c) + '</span><span class="pct"><input class="input" type="number" min="0" max="100" step="1" data-cond="' +
        esc(c) + '" value="' + esc(settings.condPct[c]) + '"' + (settings.condAdjust ? "" : " disabled") + ">%</span></label>").join("") + "</div>" +
      '<p style="margin:10px 0 0"><button class="link-btn" type="button" id="sCondReset">Reset to 100, 85, 70, 50 and 30%</button></p></div>' +

      '<div class="section"><h3>Graded values (the PSA 10 view)</h3>' +
      '<p class="small" style="margin:0 0 10px">The <b>PSA 10 value</b> switch above your collection shows what one gem-mint copy of each card would be worth. ' +
      "Real graded prices come from PriceCharting (eBay sales by grade), looked up from this device with your own PriceCharting key (their Legendary plan) and kept private here. " +
      "Without one, it's a rough estimate from the raw market price, plus any PSA 10 values you type on a card.</p>" +
      '<label class="field"><span>PriceCharting key (optional; from pricecharting.com, Subscriptions > API)</span><input class="input" id="sPcToken" type="password" autocomplete="off" value="' + esc(settings.pcToken || "") + '"></label>' +
      '<div id="pcNote">' + pcNoteHTML() + "</div>" +
      '<p class="small" style="margin:12px 0 6px">Estimate when there\'s no real price: PSA 10 ≈ raw market price × factor + fee</p>' +
      '<div class="alert-grid"><label class="field"><span>Factor</span><span class="pct">×<input class="input" type="number" min="1" max="100" step="0.5" id="sPsaMult" value="' + esc(settings.psa10Mult) + '"></span></label>' +
      '<label class="field"><span>Fee</span><span class="pct">$<input class="input" type="number" min="0" max="500" step="1" id="sPsaFloor" value="' + esc(settings.psa10Floor) + '"></span></label></div>' +
      '<p class="small" style="margin:12px 0 6px">Other grades, as a share of the PSA 10 value (for cards you\'ve had graded, when there\'s no price for that grade)</p>' +
      '<div class="cond-grid">' + Object.keys(DEFAULT_GRADE_PCT).map(g => '<label class="field"><span>' + (g === "6" ? "6 or below" : "Grade " + g) + '</span><span class="pct"><input class="input" type="number" min="0" max="200" step="1" data-gpct="' +
        g + '" value="' + esc(settings.gradePct[g]) + '"' + (g === "10" ? " disabled" : "") + ">%</span></label>").join("") + "</div>" +
      '<p class="small" style="margin:8px 0 0">These are rough starting points: a PSA 10 of a cheap modern card often sells for 5 to 30 times the raw price, and a vintage 1st Edition for far more. Real prices from PriceCharting replace them.</p></div>' +

      '<div class="section" id="gradingFeesSection"><h3>Grading fees</h3>' +
      '<p class="small" style="margin:0 0 4px">What grading a card costs you at each company. Their price lists are built in, and Card Vault reads their sites again every night (last read ' +
      esc(fmtDate(parseDay(GRADING_COS.map(c => feeTable(c.id).checked).sort().pop()))) + '): choose the service level you use and its fee fills in; a fee you type yourself wins. Add shipping and insurance per card (your share of an order\'s, both ways). ' +
      "Card Vault uses these in Insights &gt; Worth grading and when you send a card. Fees change often, so each company's own price list is linked.</p>" +
      GRADING_COS.map(c => {
        const f = (settings.gradingFees || {})[c.id] || {}, levels = gradingLevels(c.id), picked = f.level ? gradingLevel(c.id, f.level) : null, custom = !!(f.level && !picked);
        const usual = gradingUsual(c.id);
        const val = v => v == null || v === "" ? "" : esc(String(v));
        return '<div class="fee-row"><div class="fee-head"><b>' + esc(c.name) + '</b><a class="small" target="_blank" rel="noopener" href="' + esc(c.prices) + '">Price list</a>' +
          '<span class="fee-total" data-gfee-total="' + c.id + '">' + feeTotalText(c.id) + "</span></div>" +
          '<div class="fee-fields"><label class="field"><span>Service level</span><select class="input" data-gpick="' + c.id + '">' +
          '<option value="">' + esc(usual ? "Not chosen (uses " + usual.name + ")" : "Not chosen") + "</option>" +
          levels.map(l => '<option value="' + esc(l.name) + '"' + (picked === l ? " selected" : "") + (l.fee == null ? " disabled" : "") + ">" + esc(levelLabel(l)) + "</option>").join("") +
          '<option value="*"' + (custom ? " selected" : "") + '>Something else…</option></select></label>' +
          '<label class="field" data-gother="' + c.id + '"' + (custom ? "" : " hidden") + '><span>Its name</span><input class="input" data-gfee="' + c.id + '" data-k="level" maxlength="60" placeholder="e.g. Show special" value="' + val(f.level) + '"></label>' +
          '<label class="field"><span>Fee per card</span><span class="pct">$<input class="input" type="number" min="0" step="0.01" data-gfee="' + c.id + '" data-k="fee" value="' + val(f.fee) + '"></span></label>' +
          '<label class="field"><span>Shipping per card</span><span class="pct">$<input class="input" type="number" min="0" step="0.01" data-gfee="' + c.id + '" data-k="ship" value="' + val(f.ship) + '"></span></label></div>' +
          '<p class="small fee-note" data-gnote="' + c.id + '">' + feeNoteHTML(c.id) + "</p></div>";
      }).join("") +
      '<label class="field" style="margin-top:12px"><span>For another company: cost per card</span>' +
      '<span class="pct">$<input class="input" type="number" min="0" step="1" id="sGradeCost" value="' + esc(String(gradingCostEach())) + '"></span></label></div>' +

      '<div class="section" id="updatesSection"><h3>Daily price updates</h3>' +
      '<div id="updateStatus" class="update-status">' + updateStatusHTML() + "</div>" +
      (SITE ? '<p style="margin:0">New TCGplayer prices arrive every evening on their own: GitHub runs the update for this website.</p>'
      : '<p style="margin:0">To get new TCGplayer prices every day without doing anything, double-click <b>Turn On Daily Updates</b> in the Card Vault folder once. ' +
        "Windows then runs the updater every evening at 6 PM, or as soon as your computer is on after that. <b>Turn Off Daily Updates</b> stops it.</p>") +
      '<p class="small">When new prices arrive while Card Vault is open, it loads them by itself.</p>' +
      '<dl class="kv"><dt>Prices loaded</dt><dd id="pricesLoadedAt">' + (catalog ? esc(fmtDate(catalog.generated)) : "Not loaded yet") + "</dd>" +
      (SITE ? '<dt>Japanese, Korean and Rush Duel prices</dt><dd id="ocgListAt">' + esc(ocgListStatus()) + "</dd>" : "") +
      "<dt>Price changes compare with</dt><dd>" + (refs.length ? refs.join(", ") : catalog ? "Nothing yet. Earlier prices build up as the updater runs on different days." : "Not loaded yet") + "</dd></dl>" +
      '<p style="margin:10px 0 0"><button class="btn btn-small" type="button" id="priceCheckNow">Check for new prices now</button></p>' +
      '<p class="small" id="priceCheckNote" role="status" aria-live="polite" style="margin:6px 0 0"></p></div>' +

      '<div class="section"><h3>Stored in this browser</h3><dl class="kv">' +
      "<dt>Collection</dt><dd>" + plural(collection.length, "printing") + ", " + plural(cards, "card") + "</dd>" +
      "<dt>Want list</dt><dd>" + wantCount(wants.length) + "</dd>" +
      "<dt>Value history</dt><dd>" + (valueHistory.length ? plural(valueHistory.length, "price day") + " since " + esc(fmtDate(parseDay(valueHistory[0].d))) : "Starts with your first TCGplayer prices") +
      "</dd></dl></div>" +

      '<div class="section"><h3>Keyboard</h3><p class="small" style="margin:0">On a computer, press <kbd>?</kbd> anywhere in Card Vault for a list of shortcuts ' +
      "(search, add a card, switch tabs).</p></div>";
  }
  // "$20.00 per card", with "(built in)" when the fee is the price list's; or the general estimate when there's nothing
  function feeTotalText(co) {
    const f = gradingFee(co);
    return f ? esc(usd(f.total)) + " per card" + (f.builtin ? ' <span class="small">(built in)</span>' : "") : '<span class="small">' + esc(usd(gradingCostEach())) + " (your general estimate)</span>";
  }
  // Under a company's fields: the chosen level's details (or the usual level's), the company's note, and when its
  // price list was checked. When you typed a fee that differs from the list's, offers the list's.
  function feeNoteHTML(co) {
    const f = gradingFee(co), t = feeTable(co), l = f && f.info;
    const parts = [];
    if (l) parts.push("<b>" + esc(l.name) + "</b>" + (f.builtin && !(settings.gradingFees || {})[co] ? " (their usual level, assumed until you choose one)" : "") + (l.paused ? ", <b>paused</b> when checked" : "") +
      (levelDetails(l) ? ": " + esc(levelDetails(l)) : "") + ".");
    if (l && !f.builtin && l.fee != null && l.fee !== f.fee) parts.push("Their price list says " + esc(usdFee(l.fee)) + '. <button type="button" class="link-btn" data-gfee-use="' + co + '">Use it</button>');
    if (f && !l && f.level) parts.push("Your own service level.");
    if (t) {
      const paused = t.levels.filter(x => x.paused).map(x => x.name);
      parts.push(esc(t.note) + (paused.length ? " Paused when checked: " + esc(paused.join(", ")) + "." : " Every level was open when checked.") + " " +
        esc(feeCheckedText(co).replace(/^c/, "C")) + (t.archived ? " on the Internet Archive's copy of their page (" + esc(gradingCoName(co)) + " doesn't let Card Vault's nightly check in)" :
          " on their site" + (t.auto ? " (Card Vault checks every night)" : "")) + "." +
        (t.error ? " Last night's check didn't work (" + esc(t.error) + "), so this is the list from then." : ""));
    }
    return parts.join(" ");
  }
  // opts.section: scroll to that part (gradingFees)
  function openSettings(opts) {
    drawerCtx = {mode: "settings"};
    openDrawer("Settings", settingsHTML());
    const feeSaved = () => {
      save({quiet: true});   // (shared: your other devices get them through the backup)
      document.querySelectorAll("#drawerBody [data-gfee-total]").forEach(el => { el.innerHTML = feeTotalText(el.dataset.gfeeTotal); });
      document.querySelectorAll("#drawerBody [data-gnote]").forEach(el => { el.innerHTML = feeNoteHTML(el.dataset.gnote); });
      if (settings.tab === "history") renderPanel();
    };
    const feeStore = (co, f) => { settings.gradingFees = cleanGradingFees(Object.assign({}, settings.gradingFees, {[co]: f})); };
    const feeChange = inp => {
      const co = inp.dataset.gfee, k = inp.dataset.k;
      const f = Object.assign({level: "", fee: null, ship: null}, (settings.gradingFees || {})[co]);
      f[k] = k === "level" ? inp.value : (num(inp.value) == null ? null : Math.max(0, num(inp.value)));
      feeStore(co, f);
      feeSaved();
    };
    document.querySelectorAll("#drawerBody [data-gfee]").forEach(inp => inp.addEventListener("change", () => feeChange(inp)));
    // choosing a level from the built-in price list fills in its fee; "Something else" asks for a name; blank goes back to the usual level
    const feeInput = (co, k) => document.querySelector('#drawerBody [data-gfee="' + co + '"][data-k="' + k + '"]');
    document.querySelectorAll("#drawerBody [data-gpick]").forEach(sel => sel.addEventListener("change", () => {
      const co = sel.dataset.gpick, other = document.querySelector('#drawerBody [data-gother="' + co + '"]');
      const f = Object.assign({level: "", fee: null, ship: null}, (settings.gradingFees || {})[co]);
      if (sel.value === "*") {
        const prev = gradingLevel(co, f.level);
        if (prev) { f.level = ""; if (prev.fee === f.fee) { f.fee = null; if (feeInput(co, "fee")) feeInput(co, "fee").value = ""; } }   // (a fee you typed stays)
        if (other) { other.hidden = false; const inp = other.querySelector("input"); inp.value = f.level; inp.focus(); }
      } else {
        const l = gradingLevel(co, sel.value);
        f.level = l ? l.name : "";
        f.fee = l && l.fee != null ? l.fee : null;
        if (other) other.hidden = true;
        if (feeInput(co, "level")) feeInput(co, "level").value = f.level;
        if (feeInput(co, "fee")) feeInput(co, "fee").value = f.fee == null ? "" : f.fee;
      }
      feeStore(co, f);
      feeSaved();
    }));
    $("gradingFeesSection").addEventListener("click", e => {
      const b = e.target.closest("[data-gfee-use]");
      if (!b) return;
      const co = b.dataset.gfeeUse, f = Object.assign({level: "", fee: null, ship: null}, (settings.gradingFees || {})[co]), l = gradingLevel(co, f.level);
      if (!l || l.fee == null) return;
      f.fee = l.fee;
      if (feeInput(co, "fee")) feeInput(co, "fee").value = l.fee;
      feeStore(co, f);
      feeSaved();
    });
    $("sGradeCost").addEventListener("change", () => {
      const v = num($("sGradeCost").value);
      settings.gradingCost = v == null ? 30 : Math.max(0, v);
      $("sGradeCost").value = settings.gradingCost;
      save({quiet: true});
      document.querySelectorAll("#drawerBody [data-gfee-total]").forEach(el => { el.innerHTML = feeTotalText(el.dataset.gfeeTotal); });
      if (settings.tab === "history") renderPanel();
    });
    if (opts && opts.section === "updates") {
      loadLive(true);
      const sec = $("updatesSection");
      if (sec) setTimeout(() => { if (sec.scrollIntoView) sec.scrollIntoView({block: "start"}); }, 60);
    }
    if (opts && opts.section === "selling") {
      const sec = $("sellingSection");
      if (sec) setTimeout(() => { if (sec.scrollIntoView) sec.scrollIntoView({block: "start"}); $("sSellPct").focus({preventScroll: true}); }, 60);
    }
    ["sSellPct", "sSellFlat"].forEach(k => $(k).addEventListener("change", () => {
      const pct = num($("sSellPct").value), flat = num($("sSellFlat").value);
      settings.sellFeePct = pct == null ? 13 : Math.min(Math.max(pct, 0), 60);
      settings.sellFeeFlat = flat == null ? 0.3 : Math.min(Math.max(round2(flat), 0), 50);
      $("sSellPct").value = settings.sellFeePct; $("sSellFlat").value = settings.sellFeeFlat;
      save({quiet: true});   // (shared with your other devices)
      if (settings.tab === "sales") renderPanel();
    }));
    if (opts && opts.section === "gradingFees") {
      const sec = $("gradingFeesSection");
      if (sec) setTimeout(() => { if (sec.scrollIntoView) sec.scrollIntoView({block: "start"}); const first = sec.querySelector("select, input"); if (first) first.focus({preventScroll: true}); }, 60);
    }
    fillSnapshots();
    fillDriveCopies();
    $("sDeviceName").addEventListener("change", () => {
      settings.deviceName = $("sDeviceName").value.trim().slice(0, 60);
      $("sDeviceName").value = settings.deviceName;
      saveSettings();
    });
    $("sRemind").addEventListener("change", () => {
      settings.backupRemindDays = num($("sRemind").value) || 0;
      settings.backupSnoozeUntil = 0;
      saveSettings();
      renderBackupBanner();
    });
    const pctInputs = () => document.querySelectorAll("#drawerBody [data-cond]");
    $("sSwipe").addEventListener("change", () => { settings.swipeCopies = $("sSwipe").checked; saveSettings(); });
    $("sCondAdjust").addEventListener("change", () => {
      settings.condAdjust = $("sCondAdjust").checked;
      pctInputs().forEach(i => { i.disabled = !settings.condAdjust; });
      valuesChanged();
    });
    pctInputs().forEach(inp => inp.addEventListener("change", () => {
      const v = num(inp.value);
      settings.condPct[inp.dataset.cond] = v == null ? DEFAULT_COND_PCT[inp.dataset.cond] : Math.min(Math.max(Math.round(v), 0), 100);
      inp.value = settings.condPct[inp.dataset.cond];
      valuesChanged();
    }));
    const alertChange = () => {
      settings.alertsOn = $("sAlerts").checked;
      settings.alertMinDollar = Math.max(0, num($("sAlertDollar").value) == null ? 5 : num($("sAlertDollar").value));
      settings.alertMinPct = Math.max(0, num($("sAlertPct").value) == null ? 10 : num($("sAlertPct").value));
      save({quiet: true});  // the daily update reads these from the backup file
      refreshBackupSection();
    };
    ["sAlerts", "sAlertDollar", "sAlertPct"].forEach(k => $(k).addEventListener("change", alertChange));
    wirePhoneAlerts();
    wireCloudAlerts();
    if ($("sAutoSignIn")) $("sAutoSignIn").addEventListener("change", () => {
      settings.autoSignIn = $("sAutoSignIn").checked;
      // (turned back on: give it a fresh go, even if Google said no earlier today)
      if (settings.autoSignIn) { try { localStorage.removeItem(GSILENT_KEY); } catch (e) { /* ignore */ } }
      saveSettings();
      refreshBackupSection();
      renderBackupBanner();
    });
    $("sCondReset").addEventListener("click", () => {
      settings.condPct = Object.assign({}, DEFAULT_COND_PCT);
      pctInputs().forEach(i => { i.value = settings.condPct[i.dataset.cond]; });
      valuesChanged();
    });
    $("priceCheckNow").addEventListener("click", () => {
      const b = $("priceCheckNow"), note = $("priceCheckNote");
      b.disabled = true; note.textContent = "Checking…";
      checkPricesNow().then(msg => {
        b.disabled = false;
        note.textContent = msg;
        if ($("pricesLoadedAt") && catalog) $("pricesLoadedAt").textContent = fmtDate(catalog.generated);
        if ($("ocgListAt")) $("ocgListAt").textContent = ocgListStatus();
      }, () => { b.disabled = false; note.textContent = "Something went wrong while checking. Try again."; });
    });
    const pcWire = () => { const b = $("pcRefresh"); if (b) b.addEventListener("click", () => { b.disabled = true; refreshGradedPrices(true).then(() => { if ($("pcNote")) { $("pcNote").innerHTML = pcNoteHTML(); pcWire(); } }); }); };
    pcWire();
    $("sPcToken").addEventListener("change", () => {
      settings.pcToken = $("sPcToken").value.trim();
      save({quiet: true});
      if ($("pcNote")) { $("pcNote").innerHTML = pcNoteHTML(); pcWire(); }
      if (pcOn()) refreshGradedPrices().then(() => { if ($("pcNote")) { $("pcNote").innerHTML = pcNoteHTML(); pcWire(); } });
    });
    const gradedChange = () => {
      const m = num($("sPsaMult").value), f = num($("sPsaFloor").value);
      settings.psa10Mult = m == null ? 4 : Math.min(Math.max(m, 1), 100);
      settings.psa10Floor = f == null ? 25 : Math.min(Math.max(f, 0), 500);
      $("sPsaMult").value = settings.psa10Mult; $("sPsaFloor").value = settings.psa10Floor;
      document.querySelectorAll("#drawerBody [data-gpct]").forEach(i => {
        const v = num(i.value);
        settings.gradePct[i.dataset.gpct] = v == null ? DEFAULT_GRADE_PCT[i.dataset.gpct] : Math.min(Math.max(Math.round(v), 0), 200);
        i.value = settings.gradePct[i.dataset.gpct];
      });
      settings.gradePct["10"] = 100;
      valuesChanged();
    };
    ["sPsaMult", "sPsaFloor"].forEach(k => $(k).addEventListener("change", gradedChange));
    document.querySelectorAll("#drawerBody [data-gpct]").forEach(i => i.addEventListener("change", gradedChange));
  }
  function pcNoteHTML() {
    if (!pcOn()) return "";
    if (pcBad()) return '<div class="status-line off" style="margin-top:8px"><span class="dot" aria-hidden="true"></span><span>PriceCharting didn\'t accept this key. Check it on pricecharting.com (Subscriptions > API).</span></div>';
    const known = collection.filter(r => !r.sealed && pcKnown(r)).length, total = collection.filter(r => !r.sealed).length;
    return '<div class="status-line on" style="margin-top:8px"><span class="dot" aria-hidden="true"></span><span>Graded prices from PriceCharting: ' + known + " of " + plural(total, "card") + " matched so far" +
      (pc.refreshing ? " (checking…)" : "") + '. Prices refresh about once a day. <button type="button" class="link-btn" id="pcRefresh">Check all now</button></span></div>' + pcMissHTML();
  }
  // "Cards with no match": each card PriceCharting couldn't price and why, cards with the same reason together.
  function pcMissHTML() {
    const miss = pcMisses();
    if (!miss.length) return "";
    const groups = new Map();
    for (const m of miss) {
      const why = m.why || "No reason kept yet: press Check all now.";
      if (!groups.has(why)) groups.set(why, []);
      groups.get(why).push(m.r);
    }
    const rows = [...groups].sort((a, b) => b[1].length - a[1].length).map(([why, list]) => list.length > 1
      ? "<li><b>" + plural(list.length, "card") + ":</b> " + esc(why) + '<div class="small">' + list.map(r => esc(r.name) + " (" + esc(r.number) + ")").join(", ") + "</div></li>"
      : "<li><b>" + esc(list[0].name) + "</b> (" + esc(list[0].number) + "): " + esc(why) + "</li>").join("");
    return '<details class="more pc-miss"><summary>Cards with no match (' + miss.length + ")</summary><ul>" + rows + "</ul>" +
      '<p class="small" style="margin:6px 0 0">These show your own PSA 10 value (type one on the card) or the estimate below.</p></details>';
  }
  // The daily update reads your want list and cards from the backup file to send notifications.
  // Phone alerts: the same alerts as the Windows notifications, sent to the ntfy app (free, iPhone and Android) under a
  // private topic name. The daily update on the PC sends them; this page only sets them up and sends a test.
  const NTFY = "https://ntfy.sh/";
  const NTFY_APP = "https://apps.apple.com/us/app/ntfy/id1625396347";
  function newTopic() {
    const a = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(a); else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    return "cardvault-" + Array.from(a, b => (b % 36).toString(36)).join("");
  }
  const siteAddress = () => SITE && /^https:/.test(location.protocol) ? location.origin + location.pathname.replace(/[^/]*$/, "") : "";
  function phoneAlertsHTML() {
    const t = settings.ntfyTopic;
    if (!t) return '<p class="small" style="margin:0 0 10px">Get the same alerts on your iPhone: a want-list card at your target price, a big price move, or the market passing your asking price. ' +
      "They come through ntfy, a free notification app, and are sent by the daily update on your Windows PC, or by the website's nightly update (set up below, once this is on).</p>" +
      '<button type="button" class="btn btn-small" data-pa="on">Set up phone alerts</button>';
    return '<ol class="pa-steps"><li>Install <a href="' + NTFY_APP + '" target="_blank" rel="noopener">ntfy</a> from the App Store (it\'s free).</li>' +
      "<li>In ntfy, tap <b>+</b>, type this topic name and tap <b>Subscribe</b>:" +
      '<div class="pa-topic"><code id="paTopic">' + esc(t) + '</code><button type="button" class="btn btn-small" data-pa="copy">Copy</button></div></li>' +
      '<li><button type="button" class="btn btn-small" data-pa="test">Send a test alert</button> <span class="small" id="paResult" role="status"></span></li></ol>' +
      (settings.alertsOn ? "" : '<div class="status-line warn" style="margin-top:8px"><span class="dot" aria-hidden="true"></span><span>Turn on the notifications above too: phone alerts follow the same settings.</span></div>') +
      '<p class="small" style="margin:10px 0 0">The daily update on your PC sends them (it needs the latest Card Vault folder), unless the website\'s nightly update does (below). ' +
      "Keep the topic name to yourself: anyone who knows it could read your alerts. " +
      '<button type="button" class="link-btn" data-pa="new">New topic name</button> · <button type="button" class="link-btn" data-pa="off">Turn off phone alerts</button></p>';
  }
  function wirePhoneAlerts() {
    const box = $("phoneAlerts");
    if (!box) return;
    box.addEventListener("click", async e => {
      const b = e.target.closest("[data-pa]");
      if (!b) return;
      const a = b.dataset.pa;
      if (a === "on" || a === "new") { settings.ntfyTopic = newTopic(); if (siteAddress()) settings.siteUrl = siteAddress(); }
      else if (a === "off") settings.ntfyTopic = "";
      else if (a === "copy") { copyText(settings.ntfyTopic, () => toast("Copied the topic name. Paste it into ntfy.")); return; }
      else if (a === "test") {
        const out = $("paResult");
        b.disabled = true; out.textContent = "Sending…";
        try {
          const res = await fetch(NTFY, {method: "POST", body: JSON.stringify({topic: settings.ntfyTopic, title: "Card Vault phone alerts are working",
            message: "You'll get alerts like this after the daily price update.", tags: ["moneybag"], click: settings.siteUrl || siteAddress() || undefined})});
          out.textContent = res.ok ? "Sent. It should show on your phone in a few seconds." : "ntfy didn't accept it (" + res.status + "). Try again in a minute.";
        } catch (err) { out.textContent = "Couldn't reach ntfy. Check your internet connection."; }
        b.disabled = false;
        return;
      }
      save({quiet: true});  // the daily update reads the topic from the backup file
      box.innerHTML = phoneAlertsHTML();
      if ($("cloudAlertsWrap")) $("cloudAlertsWrap").hidden = !settings.ntfyTopic;
    });
  }
  /* ----- phone alerts without the PC: the nightly update on GitHub sends them ----- */
  // The website keeps a locked copy of what the alerts need (your cards and want list, your alert settings and ntfy
  // topic) in your Google Drive, locked with a key (AES-GCM) that you give GitHub as the repository secret
  // CARDVAULT_ALERTS. The file is shared as "anyone with the link" so the nightly update can read it without your
  // Google sign-in; without the key it's unreadable. It's written again whenever what it holds changes, after a sync.
  const CLOUD_KEY = "cardvault.v2.cloudAlerts";   // (this device) {hash, at}: what was last written
  // basis: the backup file's savedAt that what's here includes (the file this device wrote or last merged). It goes
  // on the outside of the locked file, so the PC's updater can tell whether the nightly alerts know its latest changes.
  const cloud = {busy: null, error: "", basis: "", again: false};
  function cleanCloudAlerts(x) {
    if (!x || typeof x !== "object") return null;
    const fileId = String(x.fileId || ""), key = String(x.key || "");
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId) || !/^[A-Za-z0-9_-]{43}$/.test(key)) return null;
    return {fileId, key, since: String(x.since || "")};
  }
  const bytesB64 = bytes => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const b64url = bytes => bytesB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unb64url = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
  const cloudSecret = c => c.fileId + "." + c.key;
  // What the nightly update needs, and nothing more (no notes, places, photos or prices paid; just asking prices)
  function cloudPayload(off) {
    if (off) return JSON.stringify({app: "Card Vault", kind: "alerts", v: 1, off: true});
    return JSON.stringify({app: "Card Vault", kind: "alerts", v: 1,
      settings: {alertsOn: !!settings.alertsOn, alertMinDollar: settings.alertMinDollar, alertMinPct: settings.alertMinPct, condAdjust: settings.condAdjust, condPct: settings.condPct,
        ntfyTopic: settings.ntfyTopic || "", siteUrl: settings.siteUrl || siteAddress() || ""},
      collection: collection.map(r => ({id: r.id, name: r.name, productId: r.productId, number: r.number, rarity: r.rarity, edition: r.edition, condition: r.condition,
        language: r.language, qty: r.qty, sealed: !!r.sealed, grade: r.grade ? {company: r.grade.company, grade: r.grade.grade, value: r.grade.value} : null,
        grading: r.grading ? {company: r.grading.company, sent: r.grading.sent, days: r.grading.days || "", level: r.grading.level || ""} : null,
        sell: r.sell && r.sell.price != null ? {price: r.sell.price} : null})),
      wants: wants.map(w => ({name: w.name, productId: w.productId, number: w.number, edition: w.edition, target: w.target, kind: w.kind}))});
  }
  async function cloudSeal(keyText, text, basis) {
    const key = await crypto.subtle.importKey("raw", unb64url(keyText), "AES-GCM", false, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new Uint8Array(await crypto.subtle.encrypt({name: "AES-GCM", iv}, key, new TextEncoder().encode(text)));
    return JSON.stringify({app: "Card Vault", kind: "alerts", v: 1, basis: basis || "", iv: bytesB64(iv), data: bytesB64(data)});
  }
  async function cloudUpload(c, text, basis) {
    const body = await cloudSeal(c.key, text, basis);
    await driveFetch(GDRIVE_UPLOAD + "files/" + encodeURIComponent(c.fileId) + "?uploadType=media&fields=id", {method: "PATCH", headers: {"Content-Type": "application/json"}, body});
  }
  // After a sync to Google Drive (and when set up): writes the locked file if what it holds changed.
  const noteCloudBasis = savedAt => { if (typeof savedAt === "string" && savedAt > cloud.basis) cloud.basis = savedAt; };
  // After a sync to Google Drive (writing the backup file, or taking in another device's changes), and every half hour:
  // writes the locked file when what it holds changed. One at a time; a write asked for meanwhile follows it.
  // Resolves "written", "same" (nothing new), or why not.
  async function cloudAlertsWrite(force) {
    const c = cleanCloudAlerts(settings.cloudAlerts);
    if (!DRIVE || !c) return "off";
    if (cloud.busy) { cloud.again = true; return cloud.busy; }
    if (!driveToken()) { if (force) cloud.error = "sign in to Google Drive again first (Resume, at the top)"; return "signed out"; }
    const basis = cloud.basis || (force ? settings.lastFileSaveAt || "" : "");
    if (!basis) return "not synced yet";
    const text = cloudPayload(false), hash = hashText(c.fileId + "|" + basis + "|" + text);
    const last = readJSON(CLOUD_KEY, {}) || {};
    if (!force && last.hash === hash) return "same";
    const run = (async () => {
      try {
        await cloudUpload(c, text, basis);
        try { localStorage.setItem(CLOUD_KEY, JSON.stringify({hash, at: Date.now()})); } catch (e) { /* written again next time */ }
        cloud.error = "";
        return "written";
      } catch (e) {
        cloud.error = e && e.name === "NotFoundError" ? "the alerts file isn't in your Google Drive anymore: turn this off and set it up again" : (e && e.message) || String(e);
        return "failed";
      }
    })();
    cloud.busy = run;
    const out = await run;
    cloud.busy = null;
    if ($("cloudAlerts")) $("cloudAlerts").innerHTML = cloudAlertsHTML();
    if (cloud.again) { cloud.again = false; return cloudAlertsWrite(false).then(next => next === "same" ? out : next); }
    return out;
  }
  async function cloudAlertsSetup() {
    if (!driveToken()) throw new Error("sign in to Google Drive again first (Resume, at the top)");
    const keyBytes = crypto.getRandomValues(new Uint8Array(32));
    const key = b64url(keyBytes);
    const own = await driveFolder("Card Vault", null, true);
    const boundary = "cardvault" + Date.now();
    const meta = {name: "Card Vault phone alerts (locked).json", mimeType: "application/json", parents: [own],
      description: "Locked copy of what Card Vault's nightly phone alerts need. Unreadable without the key you gave GitHub."};
    const basis = cloud.basis || settings.lastFileSaveAt || "";
    const body = await cloudSeal(key, cloudPayload(false), basis);
    const multipart = "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta) + "\r\n--" + boundary +
      "\r\nContent-Type: application/json\r\n\r\n" + body + "\r\n--" + boundary + "--";
    const made = await (await driveFetch(GDRIVE_UPLOAD + "files?uploadType=multipart&fields=id", {method: "POST", headers: {"Content-Type": "multipart/related; boundary=" + boundary}, body: multipart})).json();
    if (!made || !made.id) throw new Error("Google Drive didn't keep the file");
    // anyone with the link can read it (it's locked), so the nightly update can fetch it without your sign-in
    await driveFetch("files/" + encodeURIComponent(made.id) + "/permissions?fields=id", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({role: "reader", type: "anyone"})});
    settings.cloudAlerts = {fileId: made.id, key, since: new Date().toISOString()};
    save({quiet: true});   // (your other devices get it through the sync, and keep the file up to date too)
    try { localStorage.setItem(CLOUD_KEY, JSON.stringify({hash: hashText(made.id + "|" + basis + "|" + cloudPayload(false)), at: Date.now()})); } catch (e) { /* ignore */ }
  }
  // The file is overwritten with "off" first (so the nightly update stops quietly, even while the secret is still on
  // GitHub), and only then does the setting go (so your PC sends phone alerts again): never both at once.
  async function cloudAlertsOff() {
    const c = cleanCloudAlerts(settings.cloudAlerts);
    if (c) {
      if (!driveToken()) throw new Error("sign in to Google Drive again first (Resume, at the top), so the alerts file can be turned off too");
      while (cloud.busy) await cloud.busy;
      await cloudUpload(c, cloudPayload(true), cloud.basis);
    }
    settings.cloudAlerts = null;
    save({quiet: true});
    try { localStorage.removeItem(CLOUD_KEY); } catch (e) { /* ignore */ }
  }
  // Where the repository's secrets are, worked out from the website's address (owner.github.io/repository/)
  function secretsPage() {
    const m = String(settings.siteUrl || siteAddress() || "").match(/^https:\/\/([A-Za-z0-9-]+)\.github\.io\/([A-Za-z0-9._-]+)/);
    return m ? "https://github.com/" + m[1] + "/" + m[2] + "/settings/secrets/actions/new" : "https://github.com/";
  }
  function cloudStatusHTML() {
    const a = live.status && live.status.parts ? live.status.parts.alerts : null;
    const line = (cls, text) => '<div class="status-line ' + cls + '" style="margin-top:8px"><span class="dot" aria-hidden="true"></span><span>' + text + "</span></div>";
    if (cloud.error) return line("off", "Couldn't update the alerts file in your Google Drive: " + esc(cloud.error) + ".");
    if (!a) return line("warn", "Waiting for the nightly update's first report.");
    const when = parseDate(a.checked);
    if (!a.configured) return line("warn", "GitHub doesn't have the key yet" + (when ? " (checked " + esc(fmtDate(when)) + ")" : "") + ": do step 2.");
    if (a.off) return line("warn", "The nightly update found the alerts turned off.");
    if (a.noTopic) return line("warn", "The nightly update found no ntfy topic: set up phone alerts above.");
    if (!a.ok) return line("off", "Last night it didn't work: " + esc(a.error || "unknown") + ".");
    return line("on", "Working: the nightly update checked " + (when ? esc(fmtDate(when)) : "last night") + ". Your PC no longer needs to send phone alerts (it still shows Windows notifications).");
  }
  function cloudAlertsHTML() {
    if (!SITE) return '<p class="small" style="margin:0">Card Vault\'s website can have the nightly update send these, so this PC needn\'t be on: set it up there (Settings &gt; Phone alerts).</p>';
    const c = cleanCloudAlerts(settings.cloudAlerts);
    if (!c) return '<p class="small" style="margin:0 0 8px">The nightly update on GitHub can send these alerts itself, so your PC needn\'t be on. Card Vault keeps a locked copy of what they need ' +
      "(your cards, want list and alert settings) in your Google Drive; only the key you give GitHub opens it.</p>" +
      (backup.handle && backup.handle.kind === "gdrive" ? '<button type="button" class="btn btn-small" data-ca="on">Send alerts without the PC</button>'
        : '<p class="small" style="margin:0">Sync with Google Drive first (Settings &gt; Backup), then this can be turned on.</p>');
    return '<ol class="pa-steps"><li>Copy this key:<div class="pa-topic"><code class="ca-key">' + esc(cloudSecret(c)) + '</code><button type="button" class="btn btn-small" data-ca="copy">Copy</button></div></li>' +
      '<li>On GitHub, add it to your card-vault repository as a secret named <b>CARDVAULT_ALERTS</b>: <a href="' + esc(secretsPage()) + '" target="_blank" rel="noopener">open the New secret page</a>, ' +
      "type CARDVAULT_ALERTS as the name, paste the key as the secret, and choose Add secret.</li>" +
      "<li>That's it: from tonight, the nightly update sends your alerts. <button type=\"button\" class=\"link-btn\" data-ca=\"sync\">Update the file now</button></li></ol>" +
      cloudStatusHTML() +
      '<p class="small" style="margin:10px 0 0">Keep the key to yourself, like the topic name. <button type="button" class="link-btn" data-ca="off">Stop sending alerts without the PC</button></p>';
  }
  function wireCloudAlerts() {
    const box = $("cloudAlerts");
    if (!box) return;
    box.addEventListener("click", async e => {
      const b = e.target.closest("[data-ca]");
      if (!b) return;
      const a = b.dataset.ca;
      if (a === "copy") { const c = cleanCloudAlerts(settings.cloudAlerts); if (c) copyText(cloudSecret(c), () => toast("Copied the key. Paste it into GitHub as the CARDVAULT_ALERTS secret.")); return; }
      b.disabled = true;
      try {
        if (a === "on") { await cloudAlertsSetup(); toast("The alerts file is in your Google Drive. Now give GitHub the key (step 2)."); }
        else if (a === "sync") { const res = await cloudAlertsWrite(true); toast(res === "written" ? "Updated the alerts file." : "Couldn't update it: " + (cloud.error || res) + ".", res === "written" ? {} : {kind: "error"}); }
        else if (a === "off") { await cloudAlertsOff(); toast("Stopped. Your PC sends phone alerts again; you can delete the CARDVAULT_ALERTS secret on GitHub."); }
      } catch (err) {
        toast("Couldn't set it up: " + ((err && err.message) || err) + ".", {kind: "error"});
      }
      b.disabled = false;
      box.innerHTML = cloudAlertsHTML();
    });
  }
  function alertNoteHTML() {
    if (!settings.alertsOn) return "";
    if (SITE) {
      return '<div class="status-line ' + (backup.handle ? "on" : "warn") + '" style="margin-top:10px"><span class="dot" aria-hidden="true"></span><span>These notifications come from the ' +
        "Card Vault folder on your Windows PC, with daily updates turned on there (Turn On Daily Updates). It reads your cards from " +
        "<b>Card Vault backup.json</b> in your Google Drive, so that PC needs Google Drive for desktop (signed in to the same Google account)" + (backup.handle ? "" : ", and this website needs to sync with Google Drive (above)") +
        ". To check that Windows shows them, double-click <b>Test Notification</b> in the Card Vault folder.</span></div>";
    }
    if (backup.state === "active" || backup.state === "shrink") {
      return '<div class="status-line on" style="margin-top:10px"><span class="dot" aria-hidden="true"></span><span>The daily update reads your cards from ' +
        (backup.handle ? "<b>" + esc(backup.handle.name) + "</b>" : "your backup file") + ". It looks for it in the Card Vault folder, OneDrive, Documents, " +
        "Desktop and Downloads, so keep it in one of those. Daily updates need to be on too (Turn On Daily Updates). " +
        "To check that Windows shows them, double-click <b>Test Notification</b> in the Card Vault folder.</span></div>";
    }
    return '<div class="status-line warn" style="margin-top:10px"><span class="dot" aria-hidden="true"></span><span>This needs automatic backup: the daily update ' +
      "reads your want list and cards from the backup file. Turn it on above and save the file in the Card Vault folder, OneDrive, Documents, Desktop or Downloads.</span></div>";
  }
  // Condition percentages changed: today's value-history point and every total follow.
  function valuesChanged() { save({quiet: true}); render(); }
  function backupAction(act) {
    if (act === "choose") chooseBackupFile();
    else if (act === "resume") resumeBackup();
    else if (act === "stop") stopBackup();
    else if (act === "download") downloadBackup();
    else if (act === "restore") $("restoreFile").click();
    else if (act === "now") { backup.state = "active"; writeBackup().then(ok => { if (ok) toast("Backed up to " + backup.handle.name + "."); }); }
    else if (act === "load-file") loadBackupFile();
    else if (act === "phone-save") savePhoneCopy();
    else if (act === "phone-now") { phone.state = "active"; writePhoneCopy().then(ok => { if (ok) toast("Updated " + phone.handle.name + "."); }); }
    else if (act === "phone-stop") stopPhoneCopy();
    else if (act === "force") forceBackup();
    else if (act === "link-both" || act === "link-file" || act === "link-mine") resolveLink(act.slice(5));
    else if (act === "hold-keep") holdKeep();
    else if (act === "hold-apply") holdApply();
    else if (act === "sync") checkBackupFile(true).then(changed => { if (!changed && backup.state === "active") toast("No new changes from your other devices."); });
  }


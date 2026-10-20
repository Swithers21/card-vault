  /* ======================= Events ======================= */
  function readFile(file, done) {
    const reader = new FileReader();
    reader.onload = () => done(String(reader.result));
    reader.onerror = () => toast("Couldn't read that file.", {kind: "error"});
    reader.readAsText(file);
  }
  /* ======================= Keyboard shortcuts ======================= */
  const SHORTCUTS = [
    ["<kbd>/</kbd>", "Search: your collection, or Card search when you're on another tab"],
    ["<kbd>N</kbd>", "Add a card"],
    ["<kbd>1</kbd> – <kbd>8</kbd>", "Go to a tab: Collection, Card search, Insights, Sets, Want list, Deck check, Trades &amp; sales, Market"],
    ["<kbd>,</kbd>", "Settings"],
    ["<kbd>?</kbd>", "Show this list"],
    ["<kbd>Esc</kbd>", "Close whatever is open"]
  ];
  function showShortcuts() {
    if ($("shortcutsBox")) return;
    const back = document.activeElement;
    armBack();
    const box = document.createElement("div");
    box.id = "shortcutsBox";
    box.className = "shortcuts-box";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-labelledby", "shortcutsTitle");
    box.innerHTML = '<div class="shortcuts-card"><h2 id="shortcutsTitle">Keyboard shortcuts</h2><dl class="shortcuts">' +
      SHORTCUTS.map(([k, d]) => "<dt>" + k + "</dt><dd>" + d + "</dd>").join("") +
      '</dl><p class="small">Shortcuts pause while you are typing in a box.</p><button type="button" class="btn btn-small btn-primary">Close</button></div>';
    const close = () => {
      box.remove();
      document.removeEventListener("keydown", onKey, true);
      if (back && back.focus && document.contains(back)) back.focus();
    };
    const onKey = e => {
      if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(); }
      else if (e.key === "Tab") e.preventDefault();   // (the Close button is the only thing to reach)
    };
    box.addEventListener("click", e => { if (e.target === box || e.target.closest("button")) close(); });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(box);
    box.querySelector("button").focus();
  }
  // "/" searches where you are: the collection's search box, else Card search.
  function focusSearch() {
    if (settings.tab === "collection" && $("q")) { $("q").focus(); $("q").select(); return; }
    setTab("search");
    setTimeout(() => { if ($("csQ")) $("csQ").focus(); }, 0);
  }
  function wireShortcuts() {
    document.addEventListener("keydown", e => {
      if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;   // (typing)
      if (document.querySelector("[role=dialog]:not([hidden])")) return;                          // (a window is open)
      const k = e.key;
      if (k === "/") { e.preventDefault(); focusSearch(); }
      else if (k === "n" || k === "N") { e.preventDefault(); openAdd(); }
      else if (k === ",") { e.preventDefault(); openSettings(); }
      else if (k === "?") { e.preventDefault(); showShortcuts(); }
      else if (/^[1-8]$/.test(k) && TABS[Number(k) - 1]) { e.preventDefault(); setTab(TABS[Number(k) - 1], true); }
    });
  }

  function wire() {
    $("addBtn").addEventListener("click", () => openAdd());
    $("settingsBtn").addEventListener("click", openSettings);
    $("drawerClose").addEventListener("click", closeDrawer);
    $("importClose").addEventListener("click", closeImport);
    $("scrim").addEventListener("click", () => { if (!$("importModal").hidden) closeImport(); else closeDrawer(); });
    document.addEventListener("keydown", e => {
      if (e.key !== "Escape") return;
      if (!$("importModal").hidden) closeImport(); else if (!$("drawer").hidden) closeDrawer();
    });
    wireShortcuts();
    // ----- back to top (the button at the bottom of the page)
    $("toTop").addEventListener("click", backToTop);
    initValueBar();
    initScrollHints();
    initSwipe();
    if ($("heroChange")) $("heroChange").addEventListener("click", e => { const b = e.target.closest("[data-open]"); if (b) openDetails(b.dataset.open); });
    // Backup buttons live in the Settings drawer and are redrawn as the backup state changes.
    $("drawerBody").addEventListener("click", e => { const b = e.target.closest("[data-bk]"); if (b) backupAction(b.dataset.bk); });

    // ----- tabs (arrow keys move between them, as in any tab list)
    const tabList = document.querySelector(".tabs");
    tabList.addEventListener("click", e => {
      const t = e.target.closest("[data-tab]");
      if (!t) return;
      setTab(t.dataset.tab);
      if (t.dataset.tab === "search" && $("csQ") && !(window.matchMedia && window.matchMedia("(pointer:coarse)").matches)) $("csQ").focus();
    });
    tabList.addEventListener("keydown", e => {
      const i = TABS.indexOf(settings.tab);
      const next = {ArrowRight: (i + 1) % TABS.length, ArrowLeft: (i + TABS.length - 1) % TABS.length, Home: 0, End: TABS.length - 1}[e.key];
      if (next == null) return;
      e.preventDefault();
      setTab(TABS[next], true);
    });

    // ----- banners
    $("banners").addEventListener("click", e => {
      const b = e.target.closest("[data-banner]");
      if (!b) return;
      const a = b.dataset.banner;
      if (a === "reload") location.reload();
      else if (a === "resume") resumeBackup();
      else if (a === "retry") { backup.state = "active"; writeBackup(); }
      else if (a === "load-file") loadBackupFile();
      else if (a === "force") forceBackup();
      else if (a === "link-both" || a === "link-file" || a === "link-mine") resolveLink(a.slice(5));
      else if (a === "hold-keep") holdKeep();
      else if (a === "hold-apply") holdApply();
      else if (a === "status-details") openSettings({section: "updates"});
      else if (a === "ban-show") { settings.insightView = "watch"; saveSettings(); dismissStatusBanner(); setTab("history"); }
      else if (a === "status-dismiss") dismissStatusBanner();
      else if (a === "grading-show") { settings.insightView = "grading"; saveSettings(); setTab("history"); }
      else if (a === "grading-dismiss") dismissGradingBanner();
      else if (a === "choose") chooseBackupFile();
      else if (a === "download") downloadBackup();
      else if (a === "settings") openSettings();
      else if (a === "snooze") {
        settings.backupSnoozeUntil = Date.now() + Math.max(1, num(settings.backupRemindDays) || 7) * 86400000;
        saveSettings();
        renderBackupBanner();
      } else if (a === "wants") setTab("wants");
      else if (a === "changes-show") {
        settings.insightView = "movers";
        if (PERIODS.some(p => p[0] === $("changeBanner").dataset.key)) settings.histPeriod = $("changeBanner").dataset.key;
        markPricesSeen();
        setTab("history");
      } else if (a === "changes-dismiss") { markPricesSeen(); renderChangeBanner(); }
      else if (a === "want-dismiss") {
        settings.wantAlertSeen = $("wantBanner").dataset.key || "";
        saveSettings();
        renderWantBanner();
      }
    });

    // ----- collection
    const main = $("collection");
    main.addEventListener("click", e => {
      const act = e.target.closest("[data-action]");
      if (act) {
        const a = act.dataset.action;
        if (a === "import") $("importFile").click();
        else if (a === "add") openAdd();
        else if (a === "clear-filters") { clearFilters(); render(); }
        else if (a === "find-photos") findPhotosBatch();
        else if (a === "hide-photo-notice") { settings.photoNoticeSeen = photoCandidates().map(r => r.id); saveSettings(); renderCollection(); }
        return;
      }
      if (e.target.closest("input[type=checkbox]")) return;
      if (justSwiped()) return;   // (the finger lifting at the end of a swipe isn't a tap)
      const sortBtn = e.target.closest("[data-sort]");
      if (sortBtn) {
        const field = sortBtn.dataset.sort;
        setSort(field);
        const again = document.querySelector('#collection [data-sort="' + field + '"]');
        if (again) again.focus();  // keep keyboard focus on the heading after the table redraws
        return;
      }
      const open = e.target.closest("[data-open]");
      const row = e.target.closest("tr[data-row]");
      const id = open ? open.dataset.open : row ? row.dataset.row : "";
      if (id && selectMode) { setSelected(id, !selected.has(id)); return; }
      if (id) openDetails(id);
    });
    main.addEventListener("change", e => {
      const box = e.target;
      if (box.id === "selectAllShown") {
        visibleRecords().forEach(r => box.checked ? selected.add(r.id) : selected.delete(r.id));
        syncSelectionUI();
      } else if (box.dataset && box.dataset.select) setSelected(box.dataset.select, box.checked);
    });
    $("topCards").addEventListener("click", e => { const b = e.target.closest("[data-open]"); if (b) openDetails(b.dataset.open); });
    $("filtersBtn").addEventListener("click", () => {
      const open = !$("filterPanel").classList.contains("open");
      $("filterPanel").classList.toggle("open", open);
      $("filtersBtn").setAttribute("aria-expanded", String(open));
    });
    $("selectBtn").addEventListener("click", () => setSelectMode(!selectMode));

    $("q").addEventListener("input", () => { filters.q = $("q").value; renderSummary(); renderCollection(); });
    [["fSet", "set"], ["fRarity", "rarity"], ["fEdition", "edition"], ["fLang", "language"], ["fLocation", "location"], ["fShow", "show"]].forEach(([id, key]) =>
      $(id).addEventListener("change", () => {
        filters[key] = $(id).value;
        $("copyTrade").hidden = filters.show !== "extras";
        renderSummary();
        renderCollection();
      }));
    $("copyTrade").addEventListener("click", () => {
      const lines = tradeListText();
      if (!lines.length) { toast("You don't have extra copies to trade."); return; }
      copyText(lines.join("\n"), () => toast("Copied your trade list (" + plural(lines.length, "line") + "). Paste it into a message or a trade post."));
    });
    $("sortField").addEventListener("change", () => {
      settings.sortField = $("sortField").value;
      settings.sortDir = SORT_FIELDS[settings.sortField].def;
      saveSettings(); updateSortDirButton(); renderCollection();
    });
    $("sortDir").addEventListener("click", () => {
      settings.sortDir = settings.sortDir === "asc" ? "desc" : "asc";
      saveSettings(); updateSortDirButton(); renderCollection();
    });
    $("basis").addEventListener("change", () => { settings.basis = $("basis").value; saveSettings(); render(); });
    $("valueMode").addEventListener("click", e => {
      const b = e.target.closest("[data-mode]");
      if (!b) return;
      settings.gradedView = b.dataset.mode === "graded";
      saveSettings(); render();
      if (settings.gradedView) refreshGradedPrices();
    });
    document.querySelectorAll("#viewSeg button").forEach(b => b.addEventListener("click", () => {
      settings.view = b.dataset.view; saveSettings(); renderFilterOptions(); renderCollection();
    }));

    $("bulkAll").addEventListener("click", () => { visibleRecords().forEach(r => selected.add(r.id)); syncSelectionUI(); });
    $("bulkClear").addEventListener("click", () => { selected.clear(); syncSelectionUI(); });
    $("bulkShare").addEventListener("click", () => {
      const shown = visibleRecords().filter(r => selected.has(r.id));
      openShare("cards", shown.concat(collection.filter(r => selected.has(r.id) && !shown.includes(r))).map(r => r.id));
    });
    $("shareTrade").addEventListener("click", () => { const ex = extrasMap(); openShare("cards", visibleRecords().filter(r => ex.has(r.id)).map(r => r.id), {extras: ex}); });
    $("bulkLocation").addEventListener("click", () => {
      const shown = visibleRecords().filter(r => selected.has(r.id));
      openMove(shown.concat(collection.filter(r => selected.has(r.id) && !shown.includes(r))).map(r => r.id), {bulk: true});
    });
    $("bulkDelete").addEventListener("click", () => deleteRecords(Array.from(selected)));
    $("bulkSell").addEventListener("click", () => bulkSell(Array.from(selected)));

    // ----- a Japanese or Korean card from the daily list, wherever it's shown
    document.addEventListener("click", e => {
      const b = e.target.closest("[data-ocgc-have], [data-ocgc-want], [data-ocgc-open]");
      if (!b) return;
      const hit = ocgRefAt(b.dataset.ocgcHave || b.dataset.ocgcWant || b.dataset.ocgcOpen);
      if (!hit) return;
      if (b.dataset.ocgcOpen != null) openOcgCardPage(hit.c.number, hit.c.rarity);
      else if (b.dataset.ocgcWant != null) { ocgWant(hit.s, hit.c); render(); if (drawerCtx && drawerCtx.mode === "price") openOcgCardPage(hit.c.number, hit.c.rarity); }
      else ocgHave(hit.s, hit.c);
    });

    // ----- price history
    $("panel-history").addEventListener("change", e => {
      if (e.target.id === "moverMin") { settings.moverMin = num(e.target.value) || 0; saveSettings(); renderMovers(); }
    });
    $("panel-history").addEventListener("click", e => {
      const opa = e.target.closest("[data-op-act]");
      if (opa) { openingAction(opa.dataset.opAct, opa); return; }
      const wa = e.target.closest("[data-watch]");
      if (wa) { watchAction(wa); return; }
      const per = e.target.closest("[data-period]");
      if (per && !per.disabled) { settings.histPeriod = per.dataset.period; saveSettings(); if (settings.insightView === "movers") renderMovers(); else renderHistory(); return; }
      const mb = e.target.closest("[data-mover-by]");
      if (mb) { settings.moverBy = mb.dataset.moverBy; saveSettings(); renderMovers(); const b = document.querySelector('[data-mover-by="' + settings.moverBy + '"]'); if (b) b.focus(); return; }
      const mw = e.target.closest("[data-mv-want]");
      if (mw) { const w = wants.find(x => x.id === mw.dataset.mvWant); if (w) openWantEdit(w); return; }
      const mc = e.target.closest("[data-mv-card]");
      if (mc) { const at = mc.dataset.mvCard.indexOf("|"); openPriceCard(mc.dataset.mvCard.slice(0, at), mc.dataset.mvCard.slice(at + 1)); return; }
      const ms = e.target.closest("[data-mv-sealed]");
      if (ms && catalog) {   // (sealed products: their prices and store links in the Market)
        const pp = catalog.byId.get(+ms.dataset.mvSealed);
        if (pp) { settings.mkRegion = "en"; settings.mkView = "sealed"; settings.mkKind = ""; settings.mkLine = ""; mk.q = pp.name; mk.limit = 40; saveSettings(); setTab("market"); }
        return;
      }
      if (e.target.closest("[data-to-movers]")) { settings.insightView = "movers"; saveSettings(); renderInsights(); return; }
      if (e.target.closest("#chartMode")) {
        settings.chartTable = !settings.chartTable;
        saveSettings();
        renderHistory();
        const again = $("chartMode");
        if (again) again.focus();
        return;
      }
      const open = e.target.closest("[data-open]");
      if (open) openDetails(open.dataset.open);
    });
    let resizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (settings.tab === "history" && !settings.chartTable && $("valueChart")) drawHistory(historySeries()); }, 150);
    });

    // ----- sets
    const sets = $("panel-sets");
    sets.addEventListener("input", e => { if (e.target.id === "setsQ") { setsQuery = e.target.value; renderSetsList(); } });
    sets.addEventListener("change", e => {
      if (e.target.id === "setsMode") { settings.setsMode = e.target.value; saveSettings(); renderSets(); }
      else if (e.target.id === "setsSort") { settings.setsSort = e.target.value; saveSettings(); renderSetsList(); }
    });
    sets.addEventListener("click", e => {
      const br = e.target.closest("[data-cs-browse]");
      if (br) { openSearchSet(br.dataset.csBrowse); return; }
      const toggle = e.target.closest("[data-set]");
      if (toggle) {
        const gid = /^(jp|kr):/.test(toggle.dataset.set) ? toggle.dataset.set : +toggle.dataset.set;   // (a Japanese or Korean set's id is "jp:DUNE")
        if (openSets.has(gid)) openSets.delete(gid); else openSets.add(gid);
        renderSetsList();
        const again = document.querySelector('#setsList [data-set="' + gid + '"]');
        if (again) again.focus();
        return;
      }
      const w = e.target.closest("[data-want]");
      if (w && catalog) {
        const p = catalog.byId.get(+w.dataset.want);
        if (!p) return;
        const res = addWant(Object.assign(wantFromProduct(p), {edition: "Any"}));
        save();
        renderTabs();
        renderSets();
        toast("Added " + res.want.name + " to your want list.", {action: "Set a target price", onAction: () => openWantForm(p, res.want)});
        return;
      }
      const have = e.target.closest("[data-have]");
      if (have && catalog) {
        const p = catalog.byId.get(+have.dataset.have);
        if (p) { drawerCtx = null; openPickedForm(p); }
      }
    });

    // ----- theme goals: every card of an archetype or a name
    document.addEventListener("click", e => {
      const t = e.target.closest("[data-theme-fold], [data-theme-open], [data-theme-wants], [data-theme-remove], [data-theme-add], [data-theme-pick], [data-theme-retry]");
      if (!t) return;
      e.preventDefault();
      if (t.dataset.themeFold) foldTheme(t.dataset.themeFold);
      else if (t.dataset.themeOpen) { const g = themeById(t.dataset.themeOpen); if (g) openThemeCards(g.k, g.l); }
      else if (t.dataset.themeWants) themeAddMissing(t.dataset.themeWants);
      else if (t.dataset.themeRemove) removeThemeGoal(t.dataset.themeRemove);
      else if (t.dataset.themeAdd) openThemePicker(t.dataset.themeAdd);
      else if (t.dataset.themePick != null) openThemePicker("");
      else if (t.dataset.themeRetry != null) { th.failed = 0; loadThemes(); renderGoalsBar(); }
    });

    // ----- PriceCharting matching: "Find it" (Settings, a card's graded value) and "Look for them again"
    document.addEventListener("click", e => {
      if (e.target.closest("[data-pc-export]")) { e.preventDefault(); openPcExport(); return; }
      const f = e.target.closest("[data-pc-fix]");
      if (f) { e.preventDefault(); if (f.dataset.pcBack === "settings") pcMissOpen = true; openPcPick(f.dataset.pcFix, {back: f.dataset.pcBack || ""}); return; }
      if (e.target.closest("[data-pc-unmark]")) {
        e.preventDefault();
        pcUnmark(pcSkipped().marked);
        const again = () => { if (drawerCtx && drawerCtx.mode === "settings") { pcMissOpen = true; openSettings({section: "graded"}); } };
        again();
        refreshGradedPrices().then(again);
      }
    });

    // ----- set goals (buttons on the Collection tab, the Sets tab and in Card search)
    document.addEventListener("click", e => {
      const g = e.target.closest("[data-goal-toggle], [data-goal-wants], [data-goal-open], [data-goal-add], [data-goal-fold]");
      if (!g) return;
      if (g.dataset.goalFold) foldGoal(g.dataset.goalFold);
      else if (g.dataset.goalToggle) toggleGoal(g.dataset.goalToggle);
      else if (g.dataset.goalWants) goalAddMissing(g.dataset.goalWants);
      else if (g.dataset.goalOpen) openSearchSet("en:" + g.dataset.goalOpen);
      else openGoalPicker();
    });

    // ----- card search
    const csPanel = $("panel-search");
    let csTimer = null;
    const coarse = () => !!(window.matchMedia && window.matchMedia("(pointer:coarse)").matches);
    csPanel.addEventListener("input", e => {
      if (e.target.id === "csSetFind") { cs.setFind = e.target.value; clearTimeout(csTimer); csTimer = setTimeout(() => renderSetCards(), 180); return; }
      if (e.target.id !== "csQ") return;
      cs.q = e.target.value; cs.limit = 30; cs.shut.clear(); cs.set = null;   // (typing again leaves a set you opened)
      clearTimeout(csTimer); csTimer = setTimeout(renderSearchResults, 220);
    });
    csPanel.addEventListener("keydown", e => {
      if (e.key !== "Enter" || (e.target.id !== "csQ" && e.target.id !== "csSetFind")) return;
      clearTimeout(csTimer);
      if (e.target.id === "csQ") renderSearchResults(); else renderSetCards();
      if (coarse()) e.target.blur();   // (a phone's keyboard out of the way of the results)
    });
    csPanel.addEventListener("change", e => {
      if (e.target.id === "csSort") { settings.csSort = e.target.value; saveSettings(); renderSearchResults(); }
      else if (e.target.id === "csSetSort") { settings.csSetSort = e.target.value; saveSettings(); renderSetCards(); }
      else if (e.target.id === "csSetRarity") { cs.setRarity = e.target.value; renderSetCards(); }
      else if (e.target.id === "csSetShow") { cs.setShow = e.target.value; renderSetCards(); }
    });
    csPanel.addEventListener("click", e => {
      if (e.target.closest("#csScan")) { openScanner({check: true}); return; }
      const md = e.target.closest("[data-csmode], [data-cs-mode]");
      if (md) {
        settings.csMode = (md.dataset.csmode || md.dataset.csMode) === "sets" ? "sets" : "cards"; saveSettings();
        cs.set = null; cs.limit = 30;
        renderSearchResults();
        const b = document.querySelector('#csMode [data-csmode="' + settings.csMode + '"]');
        if (b) b.focus();
        return;
      }
      const st = e.target.closest("[data-cs-set]");
      if (st) { openSearchSet(st.dataset.csSet); return; }
      if (e.target.closest("[data-cs-back]")) {
        cs.set = null; renderSearchResults();
        if ($("csQ") && !coarse()) $("csQ").focus();
        return;
      }
      const ms = e.target.closest("[data-cs-mkset]");
      if (ms) {
        const set = csFindSet("en:" + ms.dataset.csMkset);
        if (set) { settings.mkRegion = "en"; settings.mkView = "sets"; settings.mkLine = ""; mk.q = set.group.name; mk.limit = 40; mk.open.add(set.group.id); saveSettings(); setTab("market"); }
        return;
      }
      const oc = e.target.closest("[data-cs-ocgwant], [data-cs-ocghave]");
      if (oc) {
        const hit = ocgChaseAt(oc.dataset.csOcgwant || oc.dataset.csOcghave);
        if (hit) { if (oc.dataset.csOcgwant) { ocgWant(hit.s, hit.c); renderSearchResults(); } else ocgHave(hit.s, hit.c); }
        return;
      }
      const lv = e.target.closest("[data-ocg-live]");
      if (lv) {   // (the shop's prices right now, under the daily list's)
        const code = lv.dataset.ocgLive, m = ocgKey(ocgRegion(code)), box = $("csOcg");
        if (m && box) { lv.disabled = true; showOcgLookup(box, code, m, {search: true, live: true}); }
        return;
      }
      const chip = e.target.closest("[data-cs-q]");
      if (chip) { cs.q = chip.dataset.csQ; cs.limit = 30; cs.shut.clear(); if ($("csQ")) $("csQ").value = cs.q; renderSearchResults(); return; }
      const t = e.target.closest("[data-cs-card]");
      if (t) {
        const key = t.dataset.csCard, open = t.getAttribute("aria-expanded") === "true";
        if (open) { cs.open.delete(key); cs.shut.add(key); } else { cs.open.add(key); cs.shut.delete(key); const g = cs.groups.get(key); if (g) csRemember(g.name); }
        renderSearchResults();
        const again = Array.from(document.querySelectorAll("#csOut [data-cs-card]")).find(x => x.dataset.csCard === key);
        if (again) again.focus();
        return;
      }
      const o = e.target.closest("[data-cs-open]");
      if (o) { const at = o.dataset.csOpen.indexOf("|"); openPriceCard(o.dataset.csOpen.slice(0, at), o.dataset.csOpen.slice(at + 1)); return; }
      if (e.target.closest("[data-cs-more]")) { cs.limit += 30; renderSearchResults(); return; }
      const m = e.target.closest("[data-cs-market]");
      if (m) { settings.mkRegion = "en"; settings.mkView = "sealed"; settings.mkKind = ""; settings.mkLine = ""; mk.q = m.dataset.csMarket; mk.limit = 40; saveSettings(); setTab("market"); }
    });

    // ----- market
    const market = $("panel-market");
    let mkTimer = null;
    market.addEventListener("input", e => { if (e.target.id === "mkQ") { mk.q = e.target.value; mk.limit = 40; clearTimeout(mkTimer); mkTimer = setTimeout(renderMarketList, 200); } });
    market.addEventListener("change", e => {
      const ocgView = settings.mkRegion === "jp" || settings.mkRegion === "kr";
      if (e.target.id === "mkLine") { settings[ocgView ? "mkLineOcg" : "mkLine"] = e.target.value; mk.limit = 40; saveSettings(); renderMarketList(); }
      else if (e.target.id === "mkKind") { settings[ocgView ? "mkKindOcg" : "mkKind"] = e.target.value; mk.limit = 40; saveSettings(); renderMarketList(); }
      else if (e.target.id === "mkGame") { settings.mkGame = e.target.value; mk.limit = 40; saveSettings(); renderMarketList(); }
      else if (e.target.id === "mkSort") { if (settings.mkView === "sealed") settings.mkSortSealed = e.target.value; else settings.mkSortSets = e.target.value; mk.limit = 40; saveSettings(); renderMarketList(); }
    });
    market.addEventListener("click", e => {
      const v = e.target.closest("[data-mkview]");
      if (v) { settings.mkView = v.dataset.mkview; mk.limit = 40; saveSettings(); renderMarket(); return; }
      const rg = e.target.closest("[data-mkregion]");
      if (rg) { settings.mkRegion = rg.dataset.mkregion; mk.limit = 40; saveSettings(); renderMarket(); const b = document.querySelector('#mkRegion [data-mkregion="' + settings.mkRegion + '"]'); if (b) b.focus(); return; }
      const os = e.target.closest("[data-ocg-set]");
      if (os) {
        const id = os.dataset.ocgSet;
        if (ocgMk.open.has(id)) ocgMk.open.delete(id); else ocgMk.open.add(id);
        renderMarketList();
        const again = Array.from(document.querySelectorAll("#mkList [data-ocg-set]")).find(x => x.dataset.ocgSet === id);
        if (again) again.focus();
        return;
      }
      const ow = e.target.closest("[data-ocg-want], [data-ocg-have]");
      if (ow) {
        const hit = ocgChaseAt(ow.dataset.ocgWant || ow.dataset.ocgHave);
        if (hit) { if (ow.dataset.ocgWant) ocgWant(hit.s, hit.c); else ocgHave(hit.s, hit.c); }
        return;
      }
      const br = e.target.closest("[data-cs-browse]");
      if (br) { openSearchSet(br.dataset.csBrowse); return; }
      const yw = e.target.closest("[data-ym-want]");
      if (yw) { const x = (ymk.list || []).find(y => String(y.id) === yw.dataset.ymWant); if (x) ymWant(x); return; }
      const kw = e.target.closest("[data-krbox-want]");
      if (kw) { const s = ocgFindSet(kw.dataset.krboxWant); if (s) krBoxWant(s); return; }
      const yh = e.target.closest("[data-ym-have]");
      if (yh) { const x = (ymk.list || []).find(y => String(y.id) === yh.dataset.ymHave); if (x) openShopSealedForm(ymItem(x)); return; }
      const kh = e.target.closest("[data-krbox-have]");
      if (kh) { const s = ocgFindSet(kh.dataset.krboxHave); if (s) openShopSealedForm(krBoxItem(s)); return; }
      if (e.target.closest("[data-ocg-retry]")) { ocgMk.failed = 0; loadOcgMarket(); renderMarketList(); return; }
      if (e.target.closest("[data-ym-retry]")) { ymk.failed = 0; loadYugiMarket(true); renderMarketList(); return; }
      if (e.target.closest("[data-mk-more]")) { mk.limit += 40; renderMarketList(); return; }
      const t = e.target.closest("[data-mk-set]");
      if (t) {
        const gid = +t.dataset.mkSet;
        if (mk.open.has(gid)) mk.open.delete(gid); else mk.open.add(gid);
        renderMarketList();
        const again = document.querySelector('#mkList [data-mk-set="' + gid + '"]');
        if (again) again.focus();
        return;
      }
      const w = e.target.closest("[data-mk-want]");
      if (w && catalog) {
        const p = catalog.byId.get(+w.dataset.mkWant);
        if (!p) return;
        const res = addWant(Object.assign(wantFromProduct(p), {edition: "Any"}));
        save(); renderTabs(); renderMarketList();
        toast("Added " + res.want.name + " to your want list.", {action: "Set a target price", onAction: () => openWantForm(p, res.want)});
        return;
      }
      const h = e.target.closest("[data-mk-have]");
      if (h && catalog) { const p = catalog.byId.get(+h.dataset.mkHave); if (p) { drawerCtx = null; openPickedForm(p); } return; }
      const a = e.target.closest("[data-mk-add]");
      if (a && catalog) { const p = catalog.byId.get(+a.dataset.mkAdd); if (p) openSealedForm(p); }
    });

    // ----- deck check
    const decksPanel = $("panel-decks");
    wireDeckIdeas(decksPanel);
    wireInsights($("panel-history"));
    wireTrade($("panel-sales"));
    decksPanel.addEventListener("input", e => {
      if (!deckDraft) return;
      if (e.target.id === "deckText") deckDraft.text = e.target.value;
      else if (e.target.id === "deckName") deckDraft.name = e.target.value;
    });
    decksPanel.addEventListener("click", e => {
      const bl = e.target.closest("[data-deck-ban]");
      if (bl) { settings.deckBan = bl.dataset.deckBan; saveSettings(); if ($("deckOut")) $("deckOut").innerHTML = deckResultHTML(); const again = document.querySelector('[data-deck-ban="' + settings.deckBan + '"]'); if (again) again.focus(); return; }
      const b = e.target.closest("[data-deck], [data-deck-open], [data-deck-del]");
      if (!b) return;
      if (b.dataset.deckOpen) {
        const k = decks.find(x => x.id === b.dataset.deckOpen);
        if (!k) return;
        deckDraft = {id: k.id, name: k.name, text: k.text};
        settings.deckId = k.id;
        saveSettings();
        deckResult = null;
        renderDecks();
        runDeckCheck();
        return;
      }
      if (b.dataset.deckDel) { deleteDeck(b.dataset.deckDel); return; }
      const a = b.dataset.deck;
      if (!a) return;
      if (a === "check") runDeckCheck();
      else if (a === "file") $("deckFile").click();
      else if (a === "save") saveDeck();
      else if (a === "wants") deckMissingToWants();
      else if (a === "pull") deckPullIntoBox();
      else if (a === "new") { deckDraft = {id: null, name: "", text: ""}; deckResult = null; settings.deckId = null; saveSettings(); renderDecks(); $("deckName").focus(); }
    });
    decksPanel.addEventListener("change", e => {
      if (e.target.id !== "deckFile") return;
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      readFile(file, text => {
        $("deckText").value = text.trim();
        // a loaded file becomes a new deck: saving it doesn't replace the saved deck that was open
        if (!$("deckName").value.trim() || deckDraft.id) $("deckName").value = file.name.replace(/\.(ydk|ydke|txt)$/i, "");
        deckDraft.id = null;
        if (settings.deckId) { settings.deckId = null; saveSettings(); }
        runDeckCheck();
      });
    });

    // ----- sales
    $("panel-sales").addEventListener("click", e => {
      const b = e.target.closest("[data-sale-action]");
      if (b) { if (b.dataset.saleAction === "back") putBackSale(b.dataset.id); else deleteSale(b.dataset.id); return; }
      if (e.target.closest("#salesExport")) exportSalesCSV();
      const sa = e.target.closest("[data-sell-act]");
      if (sa) { sellAction(sa.dataset.sellAct, sa.dataset.id); return; }
      const op = e.target.closest("[data-open]");
      if (op && settings.tab === "sales" && salesViewNow() === "selling") openDetails(op.dataset.open);
    });
    $("panel-sales").addEventListener("change", e => {
      if (e.target.id === "salesYear") { settings.salesYear = e.target.value; saveSettings(); renderSales(); }
      if (e.target.dataset && (e.target.dataset.sellPrice || e.target.dataset.sellQty)) sellInput(e.target);
    });

    // ----- want list
    $("panel-wants").addEventListener("change", e => {
      if (e.target.id !== "wantSort") return;
      settings.wantsSort = e.target.value; saveSettings(); renderWants();
      if ($("wantSort")) $("wantSort").focus();
    });
    $("panel-wants").addEventListener("click", e => {
      const ab = e.target.closest("[data-want-abroad]");
      if (ab) { const at = ab.dataset.wantAbroad.indexOf("|"); openOcgCardPage(ab.dataset.wantAbroad.slice(0, at), ab.dataset.wantAbroad.slice(at + 1)); return; }
      const v = e.target.closest("[data-wantview]");
      if (v) {
        settings.wantsView = v.dataset.wantview; saveSettings(); renderWants();
        const again = document.querySelector('#wantView [data-wantview="' + settings.wantsView + '"]');
        if (again) again.focus();
        return;
      }
      const b = e.target.closest("[data-want-action]");
      if (!b) return;
      const a = b.dataset.wantAction, w = wants.find(x => x.id === b.dataset.id);
      if (a === "add") { openAdd({want: true}); return; }
      if (a === "add-sealed") { openSealedSearch("", {want: true}); return; }
      if (a === "share") { openShare("wants"); return; }
      if (a === "tcg-cart") { openTcgCart(); return; }
      if (!w) return;
      if (a === "remove") removeWant(w.id);
      else if (a === "got") gotWant(w.id);
      else if (a === "edit") openWantEdit(w);
    });

    // ----- import, export, restore
    $("importBtn").addEventListener("click", () => $("importFile").click());
    $("importFile").addEventListener("change", () => {
      const file = $("importFile").files[0];
      $("importFile").value = "";
      if (!file) return;
      readFile(file, text => {
        // A Card Vault backup picked here is restored instead of imported.
        if (/\.(json|html?)$/i.test(file.name) || /^\s*[{<]/.test(text)) restoreBackup(text, file.name);
        else openImport(analyzeCSV(text, file.name));
      });
    });
    $("restoreFile").addEventListener("change", () => {
      const file = $("restoreFile").files[0];
      $("restoreFile").value = "";
      if (file) readFile(file, text => { if (restoreBackup(text, file.name)) closeDrawer(); });
    });
    $("importFoot").addEventListener("click", e => {
      const b = e.target.closest("[data-imp]");
      if (!b || b.disabled) return;
      if (b.dataset.imp === "cancel") return closeImport();
      const choice = importChoice();
      commitImport(choice.mode, {raise: choice.raise});
    });
    $("importBody").addEventListener("change", updateImportButton);
    $("exportBtn").addEventListener("click", exportCSV);
    $("pcExportBtn").addEventListener("click", openPcExport);
    $("phoneBtn").addEventListener("click", savePhoneCopy);
    $("reportBtn").addEventListener("click", openReport);
    // ----- the Export menu
    const menuBtn = $("exportMenuBtn"), menu = $("exportMenu");
    const menuItems = () => Array.from(menu.querySelectorAll("[role=menuitem]"));
    const closeMenu = refocus => { menu.hidden = true; menuBtn.setAttribute("aria-expanded", "false"); if (refocus) menuBtn.focus(); };
    menuBtn.addEventListener("click", () => {
      const open = menu.hidden;
      menu.hidden = !open;
      menuBtn.setAttribute("aria-expanded", String(open));
      if (open) menuItems()[0].focus();
    });
    menuBtn.addEventListener("keydown", e => { if (e.key === "ArrowDown" && menu.hidden) { e.preventDefault(); menuBtn.click(); } });
    menu.addEventListener("keydown", e => {
      const list = menuItems(), i = list.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); list[(i + list.length - 1) % list.length].focus(); }
      else if (e.key === "Home") { e.preventDefault(); list[0].focus(); }
      else if (e.key === "End") { e.preventDefault(); list[list.length - 1].focus(); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
      else if (e.key === "Tab") closeMenu(false);
    });
    menu.addEventListener("click", e => { if (e.target.closest("[role=menuitem]")) closeMenu(false); });
    document.addEventListener("click", e => { if (!menu.hidden && !e.target.closest(".menu-wrap")) closeMenu(false); });

    // Save a pending backup right away when the page is hidden or closed; when it comes back, look for new prices
    // and changes from your other devices (signing back in to Google Drive first, if that has run out).
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") { if (backup.timer) writeBackup(); }
      else maybeSilentSignIn().then(away => { if (!away) { checkForNewData(); checkBackupFile(); retryOcgList(); } });
    });
    // Changes made on your other computers arrive through the backup file.
    window.addEventListener("focus", () => checkBackupFile());
    window.addEventListener("online", () => { if (backup.state === "active") { scheduleBackup(true); refreshBackupSection(); } else maybeSilentSignIn({idle: 60000}); });
    // (left open and untouched for a few minutes: renew the Google sign-in shortly before it runs out)
    setInterval(() => {
      if (document.visibilityState === "visible") maybeSilentSignIn({idle: 4 * 60000, early: 6 * 60000}).then(away => { if (!away) checkBackupFile(); });
    }, SYNC_EVERY);
    // Brought back from the browser's back/forward memory (after a trip to Google, say): it may be out of date.
    window.addEventListener("pageshow", e => { if (e.persisted) location.reload(); });
    ["pointerdown", "keydown", "wheel", "touchstart"].forEach(t => document.addEventListener(t, () => { lastInput = Date.now(); }, {capture: true, passive: true}));
    // New prices that waited while you typed
    document.addEventListener("focusout", () => { if (dataLoad.raw) setTimeout(applyNewData, 400); });
    window.addEventListener("pagehide", () => { if (backup.timer) writeBackup(); });
    // Card Vault open in two tabs: show what the other tab saved instead of overwriting it later.
    window.addEventListener("storage", e => {
      // Google Drive turned on or off, or signed in, in another tab of this website
      if (backup.drive && (e.key === GDRIVE_KEY || e.key === GTOKEN_KEY)) {
        const link = readJSON(GDRIVE_KEY, null);
        if (!(link && link.fileId)) { if (backup.handle) { backup.handle = null; backup.state = "off"; } }
        else if (!backup.handle || backup.handle.fileId !== link.fileId) { backup.handle = driveHandle(link); backup.state = driveToken() ? "active" : "paused"; }
        else if (backup.state === "paused" && driveToken()) { backup.state = "active"; checkBackupFile(); }
        renderBackupBanner();
        refreshBackupSection();
        return;
      }
      if (![STORE_KEY, WANTS_KEY, HISTORY_KEY, DECKS_KEY, SALES_KEY, OPENINGS_KEY].includes(e.key)) return;
      // What this tab is showing stays as it is; only the cards, lists and values come from the other tab.
      const view = {};
      ["tab", "view", "sortField", "sortDir", "basis", "histPeriod", "chartTable", "setsMode", "setsSort", "salesYear", "deckId", "gradedView"]
        .forEach(k => { view[k] = settings[k]; });
      loadState();
      Object.assign(settings, view);
      // An Undo offered here would put this tab's older copy back over what the other tab just saved.
      document.querySelectorAll("#toasts .toast.has-action").forEach(t => t.remove());
      yugi.cache = null; ocg.cache = null; pc.cache = null;
      render();
    });
    setInterval(() => { if (document.visibilityState === "visible") { checkForNewData(); loadLive(); renderGradingBanner(); cloudAlertsWrite(false); retryOcgList(); } }, 30 * 60000);

    // A photo that doesn't load: try the next one on its list, and when none is left, draw a stand-in.
    document.addEventListener("error", e => {
      const img = e.target;
      if (!img || img.tagName !== "IMG") return;
      if (img.classList.contains("ph-art")) { img.remove(); return; }
      if (img.dataset.fallback === undefined || img.dataset.failed) return;
      while (img.dataset.alt) {
        const rest = img.dataset.alt.split(" ").filter(Boolean), next = rest.shift() || "";
        if (rest.length) img.dataset.alt = rest.join(" "); else delete img.dataset.alt;
        const url = next.replace(/^~/, "");
        if (url && url !== img.getAttribute("src")) {
          if (next[0] === "~") img.dataset.stand = "1"; else delete img.dataset.stand;
          img.src = url;
          return;
        }
      }
      img.dataset.failed = "1";
      img.insertAdjacentHTML("afterend", placeholder(img.dataset.fallback, img.dataset.sub, img.dataset.art));
      img.remove();
    }, true);
  }

  function init() {
    // The website works offline once opened (sw.js), and asks the browser to keep its data.
    if (SITE && "serviceWorker" in navigator && window.isSecureContext && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register("sw.js").catch(() => {});
    if (SITE && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    // (the Google Drive sign-in had run out: Card Vault may be on its way to Google and straight back; see openSignIn)
    opening.domReady = true;
    if (openSignIn) openSignIn.then(away => { if (!away || opening.stayed) startOnce(); });
    else startOnce();
  }
  // The Japanese, Korean and Rush Duel list didn't come (a slow connection at start-up, say): ask again now and then,
  // since Rush Duel cards have no price without it. (loadOcgCardsSoft waits 10 minutes after a failure.)
  function retryOcgList() {
    if (!ocgCd.data && collection.some(isOcg)) loadOcgCardsSoft();
  }
  function startApp() {
    try { catalog = buildCatalog(window.TCG_DATA); } catch (e) { catalog = null; }
    window.TCG_DATA = null; // free the raw copy; the catalog keeps what it needs
    loadState();
    // Japanese, Korean and Rush Duel cards are priced from a list that has to be fetched: start on it right away, so the
    // total doesn't sit low for the first few seconds (those cards count as $0 until it is here).
    if (collection.some(isOcg)) loadOcgCardsSoft();
    shopPricesReady();   // (the same for the Japanese and Korean sealed products you own: priced from the shops' lists)
    setTimeout(fillPrintPhotos, 3000);   // (your cards: a photo of their own print, where they have none that loads)
    pcSentFromLastExport();   // (a PriceCharting file made before cards remembered which copies went: they remember it now)
    const linked = autoLink();
    if (linked) save();
    else if (recordValueHistory()) save({quiet: true});  // today's value-history point
    wire();
    const linkedTab = tabFromHash();   // (a link to a tab, like …/#wants)
    if (linkedTab) settings.tab = linkedTab;
    render();
    initBack();
    syncTabHash();
    // back from signing in to Google while Card Vault was open: where you'd scrolled to
    let back = null;
    try { back = JSON.parse(sessionStorage.getItem(RETURN_KEY) || "null"); sessionStorage.removeItem(RETURN_KEY); } catch (e) { back = null; }
    if (back && back.y > 0 && Date.now() - back.at < 2 * 60000) window.scrollTo(0, back.y);
    initBackup();
    snapshotToday();
    // Japanese/Korean and graded prices refresh in the background, about once a day, when online.
    setTimeout(() => { refreshOcgPrices(); if (settings.gradedView) refreshGradedPrices(); }, 2500);
    // how last night's update went, and today's grading fees; cards back late from the grader
    setTimeout(() => loadLive(), 1200);
    renderGradingBanner();
    window.addEventListener("online", () => { refreshOcgPrices(); if (settings.gradedView) refreshGradedPrices(); });
    if (loadProblem) toast("Card Vault couldn't read your saved collection, so it started empty. Your backup file wasn't changed: restore it from Settings.", {kind: "error", sticky: true});
    if (!storageOK) toast("This browser is blocking storage, so changes won't be kept after you close the page. Use Export CSV to keep a copy.", {kind: "error", sticky: true});
    if (linked) toast("Linked " + plural(linked, "card") + " to TCGplayer printings by card number.");
  }

  // Exposed for automated tests only.
  window.CardVault = {state: () => ({collection, settings, selected, catalog, wants, valueHistory, backup, decks, sales, phone, deleted, batch, sync}),
    mergeBackup, checkBackupFile, openBatch, parseBatchLine, batchRowFor, addBatch, save, analyzeCSV, commitImport, openImport,
    findByNumber, searchByName, priceInfo, marketValue, unitValue, changeFor, periodChange, historySeries, totals, deleteRecords, exportCSV,
      openPcExport, pcExportPlan, pcExportText, pcGrade, pcExportId, pcSentFromLastExport, mergeDuplicates, openTcgCart, tcgCartPlan, tcgCartURL, pcx: () => pcx,
    openDetails, openAdd, openSettings, render, setTab, setsData, extrasMap, wantStatus, addWant, restoreBackup, backupPayload,
    findYugiImages, rankYugiImages, parseYugiFile, yugiMangaPhoto, fillMangaPhotos, fillPrintPhotos, yugiPrintPick, langNumber, printPicOf, scanURL, isScanURL, yugiLabel, recordValueHistory, niceTicks, dateTicks, checkForNewData, writeBackup, initBackup,
    photoCandidates, findPhotosBatch, tradeListText, parseDeckText, parseYdk, parseYdke, checkDeck, cardNamesFor, runDeckCheck,
    openSoldForm, recordSale, saleNumbers, buildReport, openReport, phoneCopyHTML, savePhoneCopy, writePhoneCopy, backupTextFrom,
    matchScanned, numberVariants, openScanner, stopScanner, prepCanvas, openWantForm, resolveLink, chooseBackupFile, linkGoogleDrive, driveToken, openMove, moveCopies,
    searchSealed, openSealedSearch, openSealedForm, openShopSealedForm, searchShopSealed, ymTileHTML, openManual, tidyData, isSealedCard, openPickedForm, openOcgForm, ymItem, krBoxItem, shopKept, keepShopPrices, shopPricesReady, ocgCard, bigwebFor, bunjangFor, bigwebPick, bunjangPick, ocgPrice, refreshOcgPrices, fxRates, showOcgLookup,
    psa10Value, gradedValue, gradedTotals, pcLookup, pcKey, pcMatch, pcWhy, pcMisses, pcSkipped, pcChoose, pcUnmark, openPcPick, pcSearch, loadThemes, buildThemes, themeCards, themeStatus, themeGoals, addThemeGoals, removeThemeGoal, themeAddMissing, openThemePicker, openThemeCards, themeSuggestions, cleanThemeGoals, mergeThemeGoals, th: () => th, pcCache: () => pcCache(), pcRarityNames, refreshGradedPrices, checkPricesNow, loadOcgCardsSoft, ocgListStatus, gradeShare, koRarity, jaRarity, ocgRegion, isRushNo, cleanName, artless, isOverframeRec, isMangaRec, mangaOf, matchRarity, withManga, mangaFree, lookupName, driveDatedCopy, fillDriveCopies, deckPullPlan, deckPullIntoBox, openShare, shareLink, marketData, mkSetLine, mkKind, mkChase, renderMarket, analyzeDeckIdeas, runDeckIdeas, starterList, ideasState: () => ideas, loadFormatDecks, buildFormatDecks, fdkStatus, fdkDecksOf, fdkOwned, renderFormatDecks, fdkListText, fdk: () => fdk,
    imgTag, productPics, recordPics, namePics, imageFor, shareItem, shareWant,
    silentSignInDue, maybeSilentSignIn, pageBusy, viewBusy, loadNewData, applyNewData, readDataText, dataLoad: () => dataLoad,
    loadOcgMarket, buildOcgMarket, ocgMk: () => ocgMk, loadYugiMarket, ymMatch, ymProduct, ymk: () => ymk, renderMarket, wantPrice,
    wantKind, wantSource, shopWantLive, ymWant, krBoxWant, gotWant, openWantEdit, tookWant, wantFromProduct, upgradeWant, renderWants,
    csSearch, renderSearch, renderSearchResults, openPriceCard, cs: () => cs, csSetMatches, openSearchSet, csSetCode,
    toggleGoal, goalAddMissing, csSetNeeds, renderGoalsBar, cleanGoals, renderMovers, openScanner, showScanPrice, scanChecks: () => scanChecks,
    loadOcgCards, buildOcgCards, ocgCd: () => ocgCd, ocgCardAt, ocgFilePrice, ocgRowFor, ocgSetProgress, openOcgCardPage, ocgNameHits, upgradeRecord, addOrMerge,
    GRADING_FEE_TABLE, GRADING_COS, gradingFee, gradingLevels, gradingUsual, gradingCostFor, holdFor, holdKeep, holdApply, deviceLabel,
    loadLive, live: () => live, feeTable, levelFee, updateStatusHTML, renderStatusBanner, expectedBack, addBusinessDays, renderGradingBanner, lateAtGrader,
    openGradePlan, planCompany, planMix, planIds, setPlanIds, planValue, gradingEstimate, renderWorthGrading, gradingResults, deckBanCheck, wantElsewhere,
    openings: () => openings, sellSuggestions, listingTitle, listingText, afterFees, sellDrift, renderSelling, bulkSell, exportSellCSV, normSell, normPhotos,
    upgradeOpening, openingNumbers, openOpeningForm, showOpening, renderOpenings, pullFrom, banData, banYours, banChangesForYou, reprintsForYou, renderWatch,
    heroChangeHTML, heroChangeData, changeSince, renderChangeBanner, markPricesSeen, syncValueBar, closeTopmost, swipeCopies, tabFromHash,
    cloudPayload, cloudSeal, cloudAlertsWrite, cloudAlertsSetup, cloudAlertsOff, cleanCloudAlerts, cloudAlertsHTML, secretsPage, photoBoxHTML, addPhoto, shrinkPhoto, batchReady};

  document.addEventListener("DOMContentLoaded", init);
})();

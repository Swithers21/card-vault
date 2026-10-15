  /* ======================= How the app feels: value bar, change summary, scroll hints, Back button, swipes ======================= */

  /* ----- a slim value bar, once the big value panel has scrolled out of sight ----- */
  function backToTop() {
    const calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({top: 0, behavior: calm ? "auto" : "smooth"});
    const h = document.querySelector(".brand h1");   // (keyboard focus goes back to the top too)
    if (h) { h.tabIndex = -1; h.focus({preventScroll: true}); }
  }
  const setHeroChange = html => { if ($("heroChange")) $("heroChange").innerHTML = html; };
  function syncValueBar() {
    if (!$("valueBar")) return;
    $("vbLabel").textContent = settings.gradedView ? "PSA 10 value" : settings.basis === "paid" ? "What you paid" : "Collection value";
    $("vbNum").textContent = $("totalValue").textContent;
    const c = settings.gradedView ? null : heroChangeData();
    $("vbChg").innerHTML = c ? changeHTML(c.ch.diff, c.ch.pct, true) : "";
  }
  function initValueBar() {
    const bar = $("valueBar"), hero = $("summary");
    if (!bar || !hero) return;
    // (a mouse or finger on the bar goes back to the top; the Back to top button is there for the keyboard)
    bar.addEventListener("click", backToTop);
    if (!("IntersectionObserver" in window)) return;
    new IntersectionObserver(entries => {
      const e = entries[entries.length - 1];
      document.body.classList.toggle("vbar-on", !e.isIntersecting && e.boundingClientRect.bottom < 0);
    }, {threshold: 0}).observe(hero);
  }

  /* ----- how the value moved since the last TCGplayer price day: a line in the big panel, and a bar when you open the app ----- */
  let changeMemo = null;
  function heroChangeData() {
    if (changeMemo !== null) return changeMemo || null;
    changeMemo = false;
    if (settings.basis === "paid" || !catalog || !catalog.refDays.m1) return null;
    const ch = periodChange("m1");
    if (!ch.covered) return null;
    let top = null;
    for (const m of ch.movers) if (!top || Math.abs(m.total) > Math.abs(top.total)) top = m;
    changeMemo = {ch, top};
    return changeMemo;
  }
  // A small line of the collection's value over its last few price days.
  function sparkHTML(points) {
    if (points.length < 3) return "";
    const vals = points.map(p => p.v), lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    const W = 96, H = 28, span = hi - lo || 1;
    const t0 = points[0].date.getTime(), tn = points[points.length - 1].date.getTime();
    const xy = points.map((p, i) => ((tn > t0 ? (p.date.getTime() - t0) / (tn - t0) : i / (points.length - 1)) * W).toFixed(1) + "," +
      (H - 3 - (p.v - lo) / span * (H - 6)).toFixed(1));
    return '<svg class="spark" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '" aria-hidden="true" focusable="false">' +
      '<polyline points="' + xy.join(" ") + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + W + '" cy="' + xy[xy.length - 1].split(",")[1] + '" r="2.6" fill="currentColor"/></svg>';
  }
  function heroChangeHTML() {
    const c = settings.gradedView ? null : heroChangeData();
    if (!c) return "";
    const when = fmtShortDate(parseDay(catalog.refDays.m1));
    const spark = sparkHTML(historySeries().slice(-14));
    return '<span class="hc-main">' + changeHTML(c.ch.diff, c.ch.pct, true) + ' <span class="hc-when">since ' + esc(when) + " prices</span></span>" +
      (c.top ? '<span class="hc-top"><span class="hc-lab">Biggest mover</span> <button type="button" class="link-btn" data-open="' + esc(c.top.r.id) + '">' + esc(c.top.r.name) +
        "</button> " + changeHTML(c.top.total, null, true) + "</span>" : "") + spark;
  }

  // "Since you last looked": when new prices have come in since this device last showed you prices.
  function markPricesSeen() {
    const day = catalog && catalog.priceDay;
    if (!day || settings.pricesSeenDay === day) return;
    settings.pricesSeenDay = day;
    saveSettings();
  }
  function changeSince() {
    const day = catalog && catalog.priceDay, seen = settings.pricesSeenDay;
    if (!day || !seen || seen >= day || !collection.length || settings.gradedView || settings.basis === "paid") return null;
    const have = PERIODS.map(p => p[0]).filter(k => catalog.refDays[k]);
    if (!have.length) return null;
    const byDay = (a, b) => (catalog.refDays[a] < catalog.refDays[b] ? -1 : catalog.refDays[a] > catalog.refDays[b] ? 1 : 0);
    // the closest comparison day that is no later than your last look (else the oldest there is)
    const key = have.filter(k => catalog.refDays[k] <= seen).sort(byDay).pop() || have.sort(byDay)[0];
    const ch = periodChange(key);
    if (!ch.covered) return null;
    return {key, ch, from: catalog.refDays[key]};
  }
  function renderChangeBanner() {
    const b = $("changeBanner");
    if (!b) return;
    // (the first time, or with no cards yet: nothing to compare with)
    if (catalog && catalog.priceDay && (!settings.pricesSeenDay || !collection.length)) markPricesSeen();
    const c = changeSince();
    const worth = c && (Math.abs(c.ch.diff) >= 1 || c.ch.movers.some(m => Math.abs(m.total) >= 1));
    if (c && !worth) { markPricesSeen(); b.hidden = true; b.innerHTML = ""; syncBanners(); return; }   // (too small to interrupt you with)
    if (c && settings.tab === "history" && settings.insightView === "movers") markPricesSeen();   // (you're looking at the movers)
    if (!c || (settings.tab === "history" && settings.insightView === "movers")) { b.hidden = true; b.innerHTML = ""; syncBanners(); return; }
    const movers = c.ch.movers.slice().sort((x, y) => Math.abs(y.total) - Math.abs(x.total)).slice(0, 2);
    b.hidden = false;
    b.dataset.key = c.key;
    const d = c.ch.diff, how = Math.abs(d) < 0.005 ? "unchanged" : (d > 0 ? "up " : "down ") + fmtUSD.format(Math.abs(d)) +
      (c.ch.pct != null && isFinite(c.ch.pct) ? " (" + pctText(c.ch.pct).replace(/^[+-]/, "") + ")" : "");
    b.innerHTML = "<strong>Since " + esc(fmtShortDate(parseDay(c.from))) + " prices, your collection is " + esc(how) + ".</strong>" +
      (movers.length ? ' <span class="cb-moves">Biggest moves: ' + movers.map((m, i) => '<span class="cb-mv">' + esc(m.r.name) + " " + changeHTML(m.total, null, true) +
        (i < movers.length - 1 ? "," : ".") + "</span>").join(" ") + "</span>" : "") +
      '<div class="banner-actions"><button class="btn btn-small btn-primary" type="button" data-banner="changes-show">See what moved</button>' +
      '<button class="btn btn-small" type="button" data-banner="changes-dismiss">Dismiss</button></div>';
    syncBanners();
  }

  /* ----- a hint at the edge of anything that scrolls sideways ----- */
  const HSCROLL = ".seg-scroll, .summary .facts, .tabs";
  let hintQueued = false;
  function syncScrollHints() {
    hintQueued = false;
    document.querySelectorAll(HSCROLL).forEach(el => {
      const room = el.scrollWidth - el.clientWidth;
      el.classList.toggle("hs-l", room > 2 && el.scrollLeft > 2);
      el.classList.toggle("hs-r", room > 2 && el.scrollLeft < room - 2);
    });
  }
  function queueScrollHints() {
    if (hintQueued) return;
    hintQueued = true;
    (window.requestAnimationFrame || setTimeout)(syncScrollHints);
  }
  function initScrollHints() {
    document.addEventListener("scroll", e => { if (e.target && e.target.matches && e.target.matches(HSCROLL)) queueScrollHints(); }, true);
    window.addEventListener("resize", queueScrollHints);
    if ("MutationObserver" in window) new MutationObserver(queueScrollHints).observe(document.querySelector(".app"), {childList: true, subtree: true});
    queueScrollHints();
  }

  /* ----- the Back button (and the browser's): closes what's open, then goes back to the Collection, then leaves ----- */
  // A spare history entry ("top") sits in front of the one Card Vault was opened on ("base"). Back lands on "base",
  // we close or go back one step in the app, and put the spare entry back. Opening a window or changing tab needs no
  // history entries of its own, so closing a window with its X leaves the history as it was.
  const backState = {armed: false, ready: false, canLeave: true, steps: 1};
  const canNavigate = () => !!(window.history && history.pushState && history.replaceState);
  const tabStore = {
    get: k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { /* (no session storage) */ } },
    del: k => { try { sessionStorage.removeItem(k); } catch (e) { /* (no session storage) */ } }
  };
  // The sign-in with Google leaves the page and comes back to a new copy of it, which leaves the first copy's entries
  // behind; "cv.redirect" says that is what happened, and "cv.pre" is where the page before Card Vault sits in the history.
  const noteSignInLeaving = () => tabStore.set("cv.redirect", "1");
  function armBack() {
    if (!backState.ready || backState.armed || !canNavigate()) return;
    try { history.pushState({cv: "top"}, "", location.href); backState.armed = true; } catch (e) { /* (no history here) */ }
  }
  function closeTopmost() {
    const photo = document.querySelector(".photo-full");
    if (photo) { photo.click(); return true; }
    const keys = $("shortcutsBox");
    if (keys) { keys.click(); return true; }
    if (!$("importModal").hidden) { closeImport(); return true; }
    if (!$("drawer").hidden) { closeDrawer(); return true; }
    return false;
  }
  const tabFromHash = () => { const t = String(location.hash || "").slice(1); return TABS.includes(t) ? t : ""; };
  // The address shows the tab (…/#wants), so a tab can be linked to or reloaded.
  function syncTabHash() {
    if (!canNavigate()) return;
    try {
      const want = settings.tab === "collection" ? "" : "#" + settings.tab;
      if ((location.hash || "") !== want) history.replaceState(history.state, "", location.pathname + location.search + want);
    } catch (e) { /* (a page that can't change its address) */ }
  }
  function initBack() {
    if (!canNavigate()) return;
    try {
      const bare = location.pathname + location.search, hash = location.hash;
      const mine = history.state && history.state.cv;
      const baseAt = mine === "top" ? history.length - 1 : history.length;   // (which entry, counting from 1, Card Vault was opened on)
      let pre = baseAt - 1;                                                   // (and the one before it, which Back should lead to)
      const kept = tabStore.get("cv.pre");
      if ((tabStore.get("cv.redirect") === "1" || mine === "top") && kept !== null && /^\d+$/.test(kept) && Number(kept) < baseAt) pre = Number(kept);
      tabStore.del("cv.redirect");
      tabStore.set("cv.pre", String(pre));
      backState.canLeave = pre >= 1;
      backState.steps = Math.max(1, baseAt - pre);   // (older entries from before a Google sign-in are stepped over in one go)
      if (mine !== "top") {
        history.replaceState({cv: "base"}, "", bare);
        history.pushState({cv: "top"}, "", bare + hash);
      }
      backState.armed = true;
      backState.ready = true;
    } catch (e) { return; }
    window.addEventListener("popstate", e => {
      const s = e.state;
      if (!s || s.cv !== "base") return;
      backState.armed = false;
      if (closeTopmost()) { armBack(); syncTabHash(); return; }
      if (settings.tab !== "collection") { armBack(); setTab("collection"); return; }
      if (backState.canLeave) { history.go(-backState.steps); return; }
      // Nothing before Card Vault (opened on its own, as an app): a second press leaves.
      toast("Press Back again to leave Card Vault.", {duration: 2500});
      setTimeout(armBack, 2600);
    });
    window.addEventListener("hashchange", () => {
      if (history.state && history.state.cv === "base") return;   // (Back has just landed on the entry Card Vault was opened on)
      const t = tabFromHash() || "collection";
      if (t !== settings.tab) setTab(t);
    });
  }

  /* ----- swipe a card: right adds a copy, left takes one away (with Undo) ----- */
  const swipe = {el: null, id: "", pid: 0, x: 0, y: 0, dx: 0, on: false, at: 0};
  function swipeCopies(id, by) {
    const r = collection.find(x => x.id === id);
    if (!r) return;
    if (by < 0 && r.qty <= 1) { toast("That's your only copy of " + r.name + ". Open the card to remove it."); return; }
    if (by > 0 && r.qty >= 999) { toast("You already have " + r.qty + " of " + r.name + "."); return; }
    const was = r.qty;
    r.qty = Math.max(1, was + by);
    save(); render();
    toast((by > 0 ? "Added a copy: " : "Took one away: ") + "you now have " + r.qty + " of " + r.name + ".", {action: "Undo", onAction: () => {
      const cur = collection.find(x => x.id === id);
      if (cur) { cur.qty = was; save(); render(); }
    }});
  }
  function initSwipe() {
    const main = $("collection");
    const cardEl = t => t && t.closest ? t.closest(".tile[data-card]") : null;
    const reset = () => { if (swipe.el) { swipe.el.style.transform = ""; swipe.el.classList.remove("swiping", "swipe-add", "swipe-less"); } swipe.el = null; swipe.on = false; };
    main.addEventListener("pointerdown", e => {
      if (e.pointerType !== "touch") return;
      if (swipe.el) { reset(); return; }   // (a second finger: a pinch, not a swipe)
      if (!settings.swipeCopies || selectMode || !e.isPrimary) return;
      const el = cardEl(e.target);
      if (!el || e.target.closest("input, button:not([data-open]), a, select")) return;
      swipe.el = el; swipe.id = el.dataset.card; swipe.pid = e.pointerId; swipe.x = e.clientX; swipe.y = e.clientY; swipe.dx = 0; swipe.on = false;
    });
    main.addEventListener("pointermove", e => {
      if (!swipe.el || e.pointerId !== swipe.pid) return;
      const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
      if (!swipe.on) {
        if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) { reset(); return; }   // (scrolling up or down)
        if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        swipe.on = true;
        swipe.el.classList.add("swiping");
        try { swipe.el.setPointerCapture(e.pointerId); } catch (err) { /* (not needed) */ }
      }
      swipe.dx = dx;
      swipe.el.style.transform = "translateX(" + Math.max(-70, Math.min(70, dx * .5)) + "px)";
      swipe.el.classList.toggle("swipe-add", dx >= 80);
      swipe.el.classList.toggle("swipe-less", dx <= -80);
    });
    const end = e => {
      if (!swipe.el || e.pointerId !== swipe.pid) return;
      const done = swipe.on && Math.abs(swipe.dx) >= 80 && e.type === "pointerup", id = swipe.id, by = swipe.dx > 0 ? 1 : -1;
      if (swipe.on) swipe.at = Date.now();   // (the tap that ends a swipe doesn't open the card)
      reset();
      if (done) swipeCopies(id, by);
    };
    main.addEventListener("pointerup", end);
    main.addEventListener("pointercancel", end);
  }
  const justSwiped = () => Date.now() - swipe.at < 400;

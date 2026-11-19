  /* ======================= Master set binders ======================= */
  // A real binder (a location in Card Vault) holding a set's master set: one copy of every printing of the set, each
  // rarity counted on its own. 1st Edition or Unlimited, either does: one copy of the printing is enough. From the set
  // on the Sets tab: the binder's name and how many pockets its pages have; a checklist in set order with where each card
  // goes (page and pocket), whether it's in the binder, whether you have one elsewhere (and a button that puts one of each
  // in), and what you still need; and placeholders to print for the gaps, at the size of a card: the card's picture,
  // name, number and rarity, and its page and pocket.
  // settings.binders: [{g: the set's TCGplayer group id, name: its location, pockets: 4, 9 or 12 to a page, t: when it
  // last changed}], kept in the backup and synced like set goals: one by one, the latest change to each binder wins.
  const BINDER_POCKETS = [4, 9, 12];
  function cleanBinders(list) {
    const by = new Map();
    for (const x of Array.isArray(list) ? list : []) {
      const g = Number(x && x.g), name = String((x && x.name) || "").trim().slice(0, 80);
      if (!Number.isFinite(g) || g <= 0 || !name) continue;
      const e = {g, name, pockets: BINDER_POCKETS.includes(+x.pockets) ? +x.pockets : 9, t: modTime(x.t) || 0};
      const cur = by.get(g);
      if (!cur || e.t >= cur.t) by.set(g, e);
    }
    return Array.from(by.values()).sort((a, b) => a.t - b.t).slice(-200);
  }
  function mergeBinders(mine, theirs, fileWins) {
    const a = new Map(cleanBinders(mine).map(e => [e.g, e])), b = new Map(cleanBinders(theirs).map(e => [e.g, e]));
    const same = (x, y) => x.name === y.name && x.pockets === y.pockets && x.t === y.t;
    let changed = false, behind = false;
    for (const [g, e] of b) {
      const m = a.get(g);
      if (!m || e.t > m.t || (fileWins && !same(m, e))) { if (!m || !same(m, e)) changed = true; a.set(g, e); }
      else if (m.t > e.t) behind = true;
    }
    for (const g of a.keys()) if (!b.has(g)) behind = true;
    return {list: cleanBinders(Array.from(a.values())), changed, behind};
  }
  const binderOf = gid => cleanBinders(settings.binders).find(b => b.g === +gid) || null;
  const binderGroup = gid => { const ps = catalog && productsByGroup().get(+gid); return ps && ps.length ? ps[0].group : null; };
  const binderDefault = gid => { const g = binderGroup(gid); return {g: +gid, name: (g ? g.name : "Set") + " master set", pockets: 9}; };
  function binderSave(gid, patch) {
    const was = binderOf(gid);
    const list = cleanBinders(settings.binders).filter(b => b.g !== +gid);
    const b = Object.assign({}, was || binderDefault(gid), patch);
    b.name = String(b.name || "").trim().slice(0, 80) || binderDefault(gid).name;
    if (!BINDER_POCKETS.includes(+b.pockets)) b.pockets = 9;
    // (a new time only when something changed, so opening a binder doesn't count as a change to sync)
    b.t = was && was.name === b.name && was.pockets === +b.pockets ? was.t : Date.now();
    list.push({g: +gid, name: b.name, pockets: +b.pockets, t: b.t});
    settings.binders = cleanBinders(list);
    saveSettings();
    return b;
  }
  // A token card of the set (a Sheep Token, a Field Center Token): TCGplayer gives most of them no card number, so the
  // card list files them with the sealed products. A pack or box of tokens isn't one.
  const binderToken = p => !!p && /\btokens?\b/i.test(p.name) && !/\b(packs?|box(es)?|tins?|display|case|bundle|collection|lot)\b/i.test(p.name);
  // Every printing of the set in binder order: card number, then rarity from the commonest up; then the set's tokens
  function binderPrintings(gid) {
    const prods = ((catalog && productsByGroup().get(+gid)) || []).filter(p => !p.sealed || binderToken(p));
    return prods.slice().sort((a, b) => (!a.number - !b.number) || NATURAL.compare(String(a.number || ""), String(b.number || "")) ||
      rarityRank(a.rarity) - rarityRank(b.rarity) || NATURAL.compare(String(a.rarity || ""), String(b.rarity || "")) || NATURAL.compare(a.name, b.name) || a.id - b.id);
  }
  // A copy that can go into the binder: not graded (a slab doesn't fit a pocket), not away being graded, not in a deck
  const binderCard = r => !r.sealed || binderToken(catalog && catalog.byId.get(r.productId));
  const binderMovable = r => !r.grade && !r.grading && binderCard(r) && !/^deck:/i.test(String(r.location || "").trim());
  // The copy to put in: one not on the sell list, 1st Edition first, then the best condition
  const binderBetter = (a, b) => (!!a.sell - !!b.sell) || (PRINTING_RANK[b.edition] || 0) - (PRINTING_RANK[a.edition] || 0) || (CONDITION_RANK[b.condition] || 0) - (CONDITION_RANK[a.condition] || 0);
  // The checklist: {b, items: [{p, n (its place, from 1), page, pocket, inside (copies in the binder), from (the copy to put
  // in), kept (copies that stay where they are: graded, at the grader, in a deck), state: in | move | kept | need, price}],
  // counts, cost, pages, stray (cards in the binder from other sets)}
  function binderPlan(gid) {
    const b = binderOf(gid) || binderDefault(gid);
    const items = binderPrintings(gid).map((p, i) => {
      const mine = collection.filter(r => r.productId === p.id && binderCard(r));
      const inside = mine.filter(r => sameLoc(r.location, b.name)).reduce((t, r) => t + r.qty, 0);
      const out = mine.filter(r => !sameLoc(r.location, b.name));
      const movable = out.filter(binderMovable).sort(binderBetter), kept = out.filter(r => !binderMovable(r));
      let price = null;
      for (const ed in p.prices) { const v = firstPrice(p.prices[ed]); if (v != null && (price == null || v < price)) price = v; }
      return {p, n: i + 1, page: Math.floor(i / b.pockets) + 1, pocket: i % b.pockets + 1, inside, from: movable[0] || null, kept,
        state: inside ? "in" : movable.length ? "move" : kept.length ? "kept" : "need", price};
    });
    const count = s => items.filter(it => it.state === s).length;
    const need = items.filter(it => it.state === "need");
    const ids = new Set(items.map(it => it.p.id));
    return {b, items, total: items.length, tokens: items.filter(it => it.p.sealed).length, in: count("in"), move: count("move"), kept: count("kept"), need: need.length,
      cost: need.reduce((t, it) => t + (it.price || 0), 0), unpriced: need.filter(it => it.price == null).length,
      pages: Math.ceil(items.length / b.pockets), extra: items.filter(it => it.inside > 1).reduce((t, it) => t + it.inside - 1, 0),
      stray: collection.filter(r => sameLoc(r.location, b.name) && !ids.has(r.productId))};
  }

  const binderMeta = p => [p.number, p.rarity].filter(Boolean).join(" · ") || (p.sealed ? "Token" : "");
  const bx = {gid: 0, show: "all", bw: false, which: "need", view: "list", page: 1};
  function openBinder(gid) {
    if (!catalog || !binderGroup(gid)) { toast("Master set binders need TCGplayer's card list. " + GET_DATA, {kind: "error"}); return; }
    bx.gid = +gid;
    bx.show = "all";
    bx.printOpen = false;
    bx.page = 1;
    drawerCtx = {mode: "binder", gid: +gid};
    openDrawer("Master set binder", '<div id="bxBody"></div>');
    $("drawer").classList.add("wide");
    renderBinder();
  }
  const BX_SHOW = [["all", "All"], ["in", "In the binder"], ["move", "To put in"], ["need", "Needed"]];
  const BX_STATE = {in: "In the binder", move: "To put in", kept: "You have it, kept elsewhere", need: "Needed"};
  function renderBinder() {
    const box = $("bxBody");
    if (!box || !drawerCtx || drawerCtx.mode !== "binder") return;
    const gid = bx.gid, g = binderGroup(gid), made = !!binderOf(gid), plan = binderPlan(gid), b = plan.b;
    const done = plan.total && plan.in === plan.total;
    const where = it => it.state === "in" ? (it.inside > 1 ? it.inside + " in the binder (one is enough)" : "In the binder")
      : it.state === "move" ? "In " + (String(it.from.location || "").trim() || "no location") + (it.from.edition && it.from.edition !== "No edition mark" ? ", " + it.from.edition : "")
      : it.state === "kept" ? "You have it: " + (it.kept[0].grade ? "graded" : it.kept[0].grading ? "away being graded" : "in " + it.kept[0].location)
      : it.price != null ? usd(it.price) : "No recent sales";
    const rows = plan.items.filter(it => bx.show === "all" || it.state === bx.show || (bx.show === "need" && it.state === "kept"));
    let page = 0;
    const list = rows.map(it => {
      const head = it.page !== page ? '<li class="bx-page">Page ' + it.page + "</li>" : "";
      page = it.page;
      return head + '<li class="bx-row bx-' + it.state + '"><span class="bx-slot" title="Page ' + it.page + ", pocket " + it.pocket + '">' + it.pocket + "</span>" +
        '<span class="bx-mark" aria-label="' + esc(BX_STATE[it.state]) + '"></span>' +
        '<span class="bx-name">' + esc(cleanName(it.p.name, it.p.rarity)) + "<small>" + esc(binderMeta(it.p)) + "</small></span>" +
        '<span class="bx-where">' + esc(where(it)) + "</span></li>";
    }).join("");
    box.innerHTML =
      '<p class="small" style="margin:0 0 10px"><b>' + esc(g.name) + "</b>" + (g.abbr ? " (" + esc(g.abbr) + ")" : "") + ": one of every printing, each rarity on its own" +
      (plan.tokens ? ", and its " + plural(plan.tokens, "token") : "") + ". 1st Edition or Unlimited, either does.</p>" +
      '<div class="grid-2"><label class="field"><span>The binder (a location in Card Vault)</span><input class="input" id="bxName" data-loc="1" autocomplete="off" maxlength="80" value="' + esc(b.name) + '"></label>' +
      '<label class="field"><span>Pockets on each page</span><select class="select" id="bxPockets">' + BINDER_POCKETS.map(n => '<option value="' + n + '"' + (n === b.pockets ? " selected" : "") + ">" + n + "</option>").join("") + "</select></label></div>" +
      '<div class="bx-sum"><div class="bx-prog"><span class="progress" aria-hidden="true"><span style="width:' + (plan.total ? plan.in / plan.total * 100 : 0).toFixed(1) + '%"></span></span>' +
      "<b>" + (done ? "Complete: all " + plan.total + " are in the binder" : plan.in + " of " + plan.total + " in the binder") + "</b></div>" +
      '<p class="small">' + [plan.move ? plural(plan.move, "card") + " you have elsewhere to put in" : "", plan.kept ? plan.kept + " you have but keep elsewhere (graded, at the grader or in a deck)" : "",
        plan.need ? plural(plan.need, "card") + " still needed, " + usd(plan.cost) + " at today's prices" + (plan.unpriced ? " (" + plan.unpriced + " unpriced)" : "") : ""].filter(Boolean).join(". ") +
        (plan.move || plan.kept || plan.need ? ". " : "") + plural(plan.pages, "page") + " of " + b.pockets + " pockets (each side of a sheet counts as a page).</p>" +
      (plan.extra ? '<p class="small">' + plural(plan.extra, "extra copy", "extra copies") + " in the binder: a master set needs only one of each.</p>" : "") +
      (plan.stray.length ? '<p class="small">' + plural(plan.stray.reduce((t, r) => t + r.qty, 0), "card") + " in " + esc(b.name) + (plan.stray.reduce((t, r) => t + r.qty, 0) === 1 ? " isn't" : " aren't") + " from this set.</p>" : "") + "</div>" +
      '<div class="btn-row">' + (plan.move ? '<button type="button" class="btn btn-primary" id="bxFill">Put ' + (plan.move === 1 ? "it" : "one of each of the " + plan.move) + " in the binder</button>" : "") +
      (plan.need ? '<button type="button" class="btn" id="bxWant">Add the ' + plural(plan.need, "card") + " I need to my want list</button>" : "") +
      (done ? "" : '<button type="button" class="btn" id="bxShow" title="At a card show or a shop: scan a card to see if it fills a gap here">Show mode</button>') + "</div>" +
      (done ? "" : '<details class="more bx-print"' + (bx.printOpen ? " open" : "") + '><summary>Print placeholders for the gaps</summary>' +
        '<p class="small" style="margin:6px 0 8px">Card-sized slips with the picture, name, number and rarity, nine to a sheet of letter paper, in binder order with each one\'s page and pocket. Cut along the dashed lines.</p>' +
        '<div class="theme-langs"><label class="check-row"><input type="radio" name="bxWhich" value="need"' + (bx.which !== "all" ? " checked" : "") + "> <span>The " + plural(plan.need + plan.kept, "card") + " I don't have" +
          (plan.kept ? " or keep elsewhere" : "") + "</span></label>" +
        '<label class="check-row"><input type="radio" name="bxWhich" value="all"' + (bx.which === "all" ? " checked" : "") + "> <span>Every gap in the binder (" + plural(plan.total - plan.in, "card") + ")</span></label></div>" +
        '<label class="check-row" style="margin-top:8px"><input type="checkbox" class="check" id="bxBw"' + (bx.bw ? " checked" : "") + "> <span>Black-and-white pictures (saves ink)</span></label>" +
        '<div class="form-actions"><button type="button" class="btn" id="bxPrint"' + ((bx.which === "all" ? plan.total - plan.in : plan.need + plan.kept) ? "" : " disabled") + ">Print or save as PDF</button></div></details>") +
      '<div class="seg bx-views" role="group" aria-label="See it as">' + [["list", "Checklist"], ["pages", "Pages"]].map(([k, l]) =>
        '<button type="button" data-bx-view="' + k + '" aria-pressed="' + (bx.view === k) + '">' + l + "</button>").join("") + "</div>" +
      (bx.view === "pages" ? binderPagesHTML(plan) :
        '<div class="seg bx-show" role="group" aria-label="Show">' + BX_SHOW.map(([k, l]) => '<button type="button" data-bx-show="' + k + '" aria-pressed="' + (bx.show === k) + '">' + l +
          " <small>" + (k === "all" ? plan.total : k === "need" ? plan.need + plan.kept : plan[k]) + "</small></button>").join("") + "</div>" +
        (rows.length ? '<ol class="bx-list">' + list + "</ol>" : '<p class="small">None.</p>'));
    const name = $("bxName");
    // (a new name for a binder that has cards in it: its cards go with it, as renaming the binder on the shelf would)
    name.addEventListener("change", () => {
      const old = b.name, to = name.value.trim();
      if (!to || sameLoc(old, to)) { name.value = old; return; }
      const moving = made ? collection.filter(r => sameLoc(r.location, old)) : [];
      binderSave(gid, {name: to});
      save();
      if (moving.length) {
        const res = moveCopies(moving.map(r => ({id: r.id, qty: r.qty})), to);
        save(); render();
        toast("Renamed the binder: its " + plural(res.cards, "card") + " went with it, to " + res.dest + ".",
          {action: "Undo", onAction: () => { res.undo(); binderSave(gid, {name: old}); save(); render(); renderBinder(); }});
      }
      renderBinder(); renderIfSets();
    });
    $("bxPockets").addEventListener("change", e => { binderSave(gid, {pockets: +e.target.value}); save(); renderBinder(); });
    box.querySelectorAll("[data-bx-view]").forEach(x => x.addEventListener("click", () => { bx.view = x.dataset.bxView; renderBinder(); }));
    wireBinderPages(box, plan);
    box.querySelectorAll("[data-bx-show]").forEach(x => x.addEventListener("click", () => { bx.show = x.dataset.bxShow; renderBinder(); }));
    box.querySelectorAll("[name=bxWhich]").forEach(x => x.addEventListener("change", () => { bx.which = x.value; renderBinder(); }));
    const fold = box.querySelector(".bx-print");
    if (fold) fold.addEventListener("toggle", () => { bx.printOpen = fold.open; });
    if ($("bxBw")) $("bxBw").addEventListener("change", e => { bx.bw = e.target.checked; });
    if ($("bxFill")) $("bxFill").addEventListener("click", () => binderFill(gid));
    if ($("bxWant")) $("bxWant").addEventListener("click", () => binderWants(gid));
    if ($("bxPrint")) $("bxPrint").addEventListener("click", () => binderPrint(gid));
    if ($("bxShow")) $("bxShow").addEventListener("click", () => openScanner({show: true}));
  }
  const renderIfSets = () => { if (settings.tab === "sets") renderSets(); };
  // The binder as its pages: one page at a time, its pockets in a grid (2 by 2, 3 by 3, or 3 across and 4 down), a card in
  // the binder showing its picture and a gap showing a faded one with what it is and whether you have it elsewhere. Swipe or
  // use the arrows to turn the page; tap a pocket for the card.
  const BX_GAP = {move: "To put in", kept: "Kept elsewhere", need: "Needed"};
  function binderPagesHTML(plan) {
    const per = plan.b.pockets, cols = per === 4 ? 2 : 3;
    bx.page = Math.min(Math.max(1, bx.page || 1), Math.max(1, plan.pages));
    const items = plan.items.filter(it => it.page === bx.page);
    const pocket = it => {
      const name = cleanName(it.p.name, it.p.rarity), pics = productPics(it.p.sealed ? Object.assign({}, it.p, {sealed: false}) : it.p, "200w");
      return '<button type="button" class="bx-pocket bx-' + it.state + '" data-bx-open="' + it.p.id + '" aria-label="Pocket ' + it.pocket + ": " + esc(name + ", " + binderMeta(it.p) + ", " +
        (it.state === "in" ? "in the binder" : BX_GAP[it.state].toLowerCase())) + '"><span class="bx-pic">' + imgTag(pics, name) + "</span>" +
        (it.state === "in" ? "" : '<span class="bx-gap"><b>' + esc(name) + "</b><small>" + esc(binderMeta(it.p)) + "</small><em>" + esc(BX_GAP[it.state] +
          (it.state === "need" && it.price != null ? " · " + usd(it.price) : "")) + "</em></span>") + '<span class="bx-num">' + it.pocket + "</span></button>";
    };
    const empty = Math.max(0, per - items.length);
    const filled = items.filter(it => it.state === "in").length;
    return '<div class="bx-pager"><button type="button" class="btn btn-small" data-bx-turn="-1" aria-label="Previous page"' + (bx.page <= 1 ? " disabled" : "") + ">‹</button>" +
      '<span><b>Page ' + bx.page + "</b> of " + plan.pages + ' <span class="small">· ' + filled + " of " + items.length + " in</span></span>" +
      '<button type="button" class="btn btn-small" data-bx-turn="1" aria-label="Next page"' + (bx.page >= plan.pages ? " disabled" : "") + ">›</button></div>" +
      '<div class="bx-sheet" tabindex="0" aria-label="Page ' + bx.page + ' of the binder" style="--cols:' + cols + '">' + items.map(pocket).join("") +
      '<span class="bx-pocket bx-empty" aria-hidden="true"></span>'.repeat(empty) + "</div>" +
      '<p class="small bx-legend">Faded pockets are gaps. Swipe or use the arrows to turn the page.</p>';
  }
  function wireBinderPages(box, plan) {
    const sheet = box.querySelector(".bx-sheet");
    if (!sheet) return;
    const turn = d => { const to = bx.page + d; if (to < 1 || to > plan.pages) return; bx.page = to; renderBinder(); const s = $("bxBody").querySelector(".bx-sheet"); if (s) s.focus({preventScroll: true}); };
    box.querySelectorAll("[data-bx-turn]").forEach(x => x.addEventListener("click", () => turn(+x.dataset.bxTurn)));
    sheet.addEventListener("keydown", e => { if (e.key === "ArrowRight") { e.preventDefault(); turn(1); } else if (e.key === "ArrowLeft") { e.preventDefault(); turn(-1); } });
    let x0 = null, y0 = null;
    sheet.addEventListener("touchstart", e => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; }, {passive: true});
    sheet.addEventListener("touchend", e => {
      if (x0 == null) return;
      const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) turn(dx < 0 ? 1 : -1);
    });
    box.querySelectorAll("[data-bx-open]").forEach(x => x.addEventListener("click", () => {
      const pid = +x.dataset.bxOpen, it = plan.items.find(i => i.p.id === pid);
      if (!it) return;
      // (one in the binder: that copy; otherwise the card's prices, where it can go on the want list)
      const mine = it.state === "in" ? collection.find(r => r.productId === pid && sameLoc(r.location, plan.b.name)) : null;
      if (mine) openDetails(mine.id);
      else openPriceCard(String(pid), (it.from && it.from.edition) || printingsFor(it.p).filter(k => k !== "Normal")[0] || printingsFor(it.p)[0] || "");
    }));
  }
  // One copy of each printing you have elsewhere goes into the binder (Undo puts them back)
  function binderFill(gid) {
    const plan = binderPlan(gid), b = binderSave(gid, {});
    const steps = plan.items.filter(it => it.state === "move").map(it => ({id: it.from.id, qty: 1}));
    if (!steps.length) return;
    const res = moveCopies(steps, b.name);
    save(); render(); renderBinder();
    toast("Put " + plural(res.cards, "card") + " into " + res.dest + ".", {action: "Undo", onAction: () => { res.undo(); save(); render(); renderBinder(); }});
  }
  function binderWants(gid) {
    const plan = binderPlan(gid), before = JSON.parse(JSON.stringify(wants));
    let added = 0;
    for (const it of plan.items) if (it.state === "need" && !addWant(wantFromProduct(it.p)).merged) added++;
    binderSave(gid, {});
    save(); render(); renderBinder();
    toast(added ? "Added " + plural(added, "card") + " to your want list." : "They're all on your want list already.", added ? {action: "Undo", onAction: () => { wants = before; save(); render(); renderBinder(); }} : undefined);
  }
  // The placeholders: nine card-sized slips (2.5 by 3.5 inches) to a sheet of letter paper, in binder order
  function binderSlipsHTML(gid, which, bw) {
    const plan = binderPlan(gid), g = binderGroup(gid);
    const gaps = plan.items.filter(it => which === "all" ? it.state !== "in" : it.state === "need" || it.state === "kept");
    const slip = it => '<div class="slip">' + '<div class="slip-pic">' + imgTag(productPics(it.p.sealed ? Object.assign({}, it.p, {sealed: false}) : it.p, "in_1000x1000"), cleanName(it.p.name, it.p.rarity), true) + "</div>" +
      '<b class="slip-name">' + esc(cleanName(it.p.name, it.p.rarity)) + "</b>" +
      '<span class="slip-meta">' + esc(binderMeta(it.p)) + "</span>" +
      '<span class="slip-where">' + esc((g.abbr || g.name) + " · page " + it.page + ", pocket " + it.pocket) + "</span></div>";
    const sheets = [];
    for (let i = 0; i < gaps.length; i += 9) sheets.push('<div class="slip-sheet">' + gaps.slice(i, i + 9).map(slip).join("") + "</div>");
    return {count: gaps.length, html: '<div class="slips' + (bw ? " slips-bw" : "") + '">' + sheets.join("") + "</div>"};
  }
  async function binderPrint(gid) {
    binderSave(gid, {});
    const slips = binderSlipsHTML(gid, bx.which, bx.bw);
    if (!slips.count) return;
    $("report").innerHTML = slips.html;
    // (portrait letter paper for these, only while they print; the reports print sideways)
    const page = document.createElement("style");
    page.id = "phPage";
    page.textContent = "@media print{@page{size:letter portrait;margin:.25in .5in}}";
    document.head.appendChild(page);
    window.addEventListener("afterprint", () => { const s = $("phPage"); if (s) s.remove(); }, {once: true});
    reportPrint.chosen = true;
    closeDrawer();
    await reportPhotosLoaded();
    setTimeout(() => window.print(), 60);
  }

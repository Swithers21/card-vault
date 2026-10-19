  /* ======================= Trades & sales: the trade checker ======================= */
  // Put a trade together: the cards you'd give (from your collection) and the cards you'd get (any TCGplayer printing),
  // each at TCGplayer's market price, plus any cash. "Complete trade" takes your cards out (into the sales log, marked
  // as traded) and adds the ones you get. The trade in progress is kept on this device until you finish or clear it.
  const SALES_VIEWS = [["trade", "Trade checker"], ["selling", "Selling"], ["log", "Sales log"]];
  const salesViewNow = () => SALES_VIEWS.some(v => v[0] === settings.salesView) ? settings.salesView : "trade";
  const TRADE_KEY = "cardvault.v2.trade";
  let trade = null;
  function tradeState() {
    if (!trade) {
      const t = readJSON(TRADE_KEY, null) || {};
      trade = {give: Array.isArray(t.give) ? t.give.filter(x => x && x.id).map(x => ({id: String(x.id), qty: posInt(x.qty) || 1})) : [],
        get: Array.isArray(t.get) ? t.get.filter(x => x && idOrNull(x.productId)).map(x => ({key: String(x.key || newId()), productId: idOrNull(x.productId),
          edition: String(x.edition || ""), condition: CONDITIONS.includes(x.condition) ? x.condition : "Near Mint", qty: posInt(x.qty) || 1})) : [],
        cash: Math.max(0, num(t.cash) || 0), cashDir: t.cashDir === "give" ? "give" : "get", loc: String(t.loc || ""), q1: "", q2: ""};
    }
    // (a card sold or deleted meanwhile drops out; you can't give more copies than you have)
    trade.give = trade.give.filter(x => collection.some(r => r.id === x.id));
    trade.give.forEach(x => { const r = collection.find(y => y.id === x.id); x.qty = Math.min(x.qty, r.qty); });
    return trade;
  }
  function saveTrade() {
    try { localStorage.setItem(TRADE_KEY, JSON.stringify({give: trade.give, get: trade.get, cash: trade.cash, cashDir: trade.cashDir, loc: trade.loc})); } catch (e) { /* optional */ }
  }
  const giveLine = it => { const r = collection.find(x => x.id === it.id); const u = r ? marketValue(r).unit : null; return {r, unit: u, total: u == null ? 0 : u * it.qty}; };
  function getLine(it) {
    const p = catalog ? catalog.byId.get(it.productId) : null;
    const sub = p ? catalogPrice(p, it.edition) : null;
    const m = firstPrice(sub);
    const u = m == null ? null : round2(m * conditionFactor({condition: it.condition}));
    return {p, unit: u, total: u == null ? 0 : u * it.qty};
  }
  function tradeTotals() {
    const t = tradeState();
    let give = t.give.reduce((s, it) => s + giveLine(it).total, 0), get = t.get.reduce((s, it) => s + getLine(it).total, 0);
    const unpriced = t.give.filter(it => giveLine(it).unit == null).length + t.get.filter(it => getLine(it).unit == null).length;
    const cardsGive = give, cardsGet = get;
    if (t.cash) { if (t.cashDir === "get") get += t.cash; else give += t.cash; }
    return {give, get, cardsGive, cardsGet, diff: round2(get - give), unpriced};
  }
  function renderSalesTab() {
    const panel = $("panel-sales");
    const view = salesViewNow(), selling = collection.filter(r => r.sell).length;
    panel.innerHTML = '<div class="panel-head"><div><h2>Trades &amp; sales</h2></div><div class="panel-tools"><div class="seg" role="group" aria-label="Trades and sales" id="salesSeg">' +
      SALES_VIEWS.map(([k, l]) => '<button type="button" data-salesview="' + k + '" aria-pressed="' + (k === view) + '">' + l + (k === "log" && sales.length ? ' <span class="tab-count">' + sales.length + "</span>" : k === "selling" && selling ? ' <span class="tab-count">' + selling + "</span>" : "") + "</button>").join("") +
      '</div></div></div><div id="salesBody"></div>';
    if (view === "log") renderSales(); else if (view === "selling") renderSelling(); else renderTrade();
  }
  const tradeThumb = (pics, name) => '<span class="sleeve">' + imgTag(pics, name) + "</span>";
  function tradeRowsHTML(side) {
    const t = tradeState();
    const list = side === "give" ? t.give : t.get;
    if (!list.length) return '<p class="trade-empty">' + (side === "give" ? "Search your collection above to add the cards you'd trade away." : "Search TCGplayer above to add the cards you'd get.") + "</p>";
    return '<ul class="trade-list">' + list.map((it, i) => {
      if (side === "give") {
        const {r, unit, total} = giveLine(it);
        return '<li class="trade-item">' + tradeThumb(recordPics(r, "200w"), r.name) + '<div class="ti-main"><b>' + esc(r.name) + '</b><span class="cell-sub">' +
          esc([r.number, r.edition, r.grade ? gradeLabel(r.grade) : r.condition].filter(Boolean).join(", ")) + ". You have " + r.qty + "</span></div>" +
          '<div class="ti-qty stepper"><button type="button" class="icon-btn" data-tq="give:' + i + ':-1" aria-label="One fewer">&minus;</button><span class="ti-n">' + it.qty + '</span>' +
          '<button type="button" class="icon-btn" data-tq="give:' + i + ':1" aria-label="One more"' + (it.qty >= r.qty ? " disabled" : "") + ">+</button></div>" +
          '<div class="ti-val">' + (unit == null ? '<span class="small">no price</span>' : esc(usd(total)) + (it.qty > 1 ? "<small>" + esc(usd(unit)) + " each</small>" : "")) + "</div>" +
          '<button type="button" class="icon-btn ti-x" data-tx="give:' + i + '" aria-label="Remove ' + esc(r.name) + '">&times;</button></li>';
      }
      const {p, unit, total} = getLine(it);
      const eds = p ? printingsFor(p).filter(k => k !== "Normal") : [];
      return '<li class="trade-item">' + tradeThumb(productPics(p, "200w"), p ? p.name : "") + '<div class="ti-main"><b>' + esc(p ? cleanName(p.name, p.rarity) : "Unknown card") + '</b><span class="cell-sub">' +
        esc(p ? [p.number, p.rarity].filter(Boolean).join(", ") : "") + "</span>" +
        '<span class="ti-pick">' + (eds.length ? '<select class="select" data-tg="ed:' + i + '" aria-label="Printing">' + options(eds, it.edition) + "</select>" : "") +
        '<select class="select" data-tg="cond:' + i + '" aria-label="Condition">' + options(CONDITIONS, it.condition) + "</select></span></div>" +
        '<div class="ti-qty stepper"><button type="button" class="icon-btn" data-tq="get:' + i + ':-1" aria-label="One fewer">&minus;</button><span class="ti-n">' + it.qty + '</span>' +
        '<button type="button" class="icon-btn" data-tq="get:' + i + ':1" aria-label="One more">+</button></div>' +
        '<div class="ti-val">' + (unit == null ? '<span class="small">no price</span>' : esc(usd(total)) + (it.qty > 1 ? "<small>" + esc(usd(unit)) + " each</small>" : "")) + "</div>" +
        '<button type="button" class="icon-btn ti-x" data-tx="get:' + i + '" aria-label="Remove">&times;</button></li>';
    }).join("") + "</ul>";
  }
  function tradeSummaryHTML() {
    const t = tradeState(), s = tradeTotals();
    const big = Math.max(s.give, s.get), pct = big ? Math.abs(s.diff) / big : 0;
    const verdict = !t.give.length && !t.get.length ? "Add cards to both sides to compare."
      : Math.abs(s.diff) < 0.01 ? "An even trade."
      : s.diff > 0 ? "You get <b>" + esc(usd(s.diff)) + "</b> more in value (" + Math.round(pct * 100) + "%)."
      : "You give <b>" + esc(usd(-s.diff)) + "</b> more in value (" + Math.round(pct * 100) + "%).";
    const giveW = big ? s.give / big * 100 : 0, getW = big ? s.get / big * 100 : 0;
    return '<div class="trade-totals"><div><span class="small">You give</span><b>' + esc(usd(s.give)) + "</b></div>" +
      '<div class="trade-verdict' + (Math.abs(s.diff) >= 0.01 && pct > 0.1 ? " uneven" : "") + '" role="status">' + verdict + "</div>" +
      '<div class="tt-right"><span class="small">You get</span><b>' + esc(usd(s.get)) + "</b></div></div>" +
      '<div class="trade-scale" aria-hidden="true"><span class="ts-give" style="width:' + (giveW / 2).toFixed(1) + '%"></span><span class="ts-mid"></span><span class="ts-get" style="width:' + (getW / 2).toFixed(1) + '%"></span></div>' +
      (s.unpriced ? '<p class="small" style="margin:6px 0 0">' + plural(s.unpriced, "card") + " without a price count as $0.</p>" : "");
  }
  function renderTrade() {
    const el = $("salesBody") || $("panel-sales");
    const t = tradeState();
    el.innerHTML = '<p class="small" style="margin:0 0 14px">Check a trade before you make it: both sides at TCGplayer\'s market prices' +
      (settings.condAdjust ? ", played cards at your condition percentages" : "") + ".</p>" +
      (!catalog ? '<div class="notice" style="margin:0 0 14px">TCGplayer\'s card list isn\'t loaded, so you can only add cards from your collection.</div>' : "") +
      '<div class="trade">' +
      '<section class="trade-side" aria-labelledby="tradeGiveH"><h3 id="tradeGiveH">You give</h3>' +
      '<div class="search-wrap"><svg class="search-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.6 10.6 14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' +
      '<input class="search" id="tradeGiveQ" type="search" placeholder="Find a card in your collection" autocomplete="off" aria-label="Find a card you\'d give" value="' + esc(t.q1) + '"></div>' +
      '<div class="trade-results" id="tradeGiveResults"></div><div id="tradeGiveList">' + tradeRowsHTML("give") + "</div></section>" +
      '<section class="trade-side" aria-labelledby="tradeGetH"><h3 id="tradeGetH">You get</h3>' +
      '<div class="search-wrap"><svg class="search-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.6 10.6 14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' +
      '<input class="search" id="tradeGetQ" type="search" placeholder="Card name or number" autocomplete="off" aria-label="Find a card you\'d get"' + (catalog ? "" : " disabled") + ' value="' + esc(t.q2) + '"></div>' +
      '<div class="trade-results" id="tradeGetResults"></div><div id="tradeGetList">' + tradeRowsHTML("get") + "</div></section></div>" +
      '<div class="box trade-sum"><div id="tradeSummary">' + tradeSummaryHTML() + "</div>" +
      '<div class="trade-extra"><label class="basis">Cash <select class="select" id="tradeCashDir"><option value="get"' + (t.cashDir === "get" ? " selected" : "") + '>they pay me</option>' +
      '<option value="give"' + (t.cashDir === "give" ? " selected" : "") + '>I pay them</option></select>' +
      '<input class="input" id="tradeCash" type="number" min="0" step="0.01" placeholder="$0" value="' + (t.cash || "") + '"></label>' +
      '<label class="basis">Put the cards I get in <input class="input" id="tradeLoc" list="locationList" autocomplete="off" placeholder="No location" value="' + esc(t.loc) + '"></label></div>' +
      '<div class="btn-row"><button class="btn btn-primary" type="button" id="tradeDo"' + (t.give.length || t.get.length ? "" : " disabled") + ">Complete trade</button>" +
      '<button class="btn" type="button" id="tradeClear"' + (t.give.length || t.get.length || t.cash ? "" : " disabled") + ">Clear</button></div>" +
      '<p class="small" style="margin:10px 0 0">Complete trade takes the cards you give out of your collection (they show in the sales log as traded, at their market value) and adds the cards you get, with their market value as what you paid.</p></div>';
    if (t.q1) showTradeResults("give");
    if (t.q2) showTradeResults("get");
  }
  function refreshTrade(side) {
    if (side) { const box = $(side === "give" ? "tradeGiveList" : "tradeGetList"); if (box) box.innerHTML = tradeRowsHTML(side); }
    const sum = $("tradeSummary");
    if (sum) sum.innerHTML = tradeSummaryHTML();
    const t = tradeState();
    if ($("tradeDo")) $("tradeDo").disabled = !(t.give.length || t.get.length);
    if ($("tradeClear")) $("tradeClear").disabled = !(t.give.length || t.get.length || t.cash);
    saveTrade();
  }
  function showTradeResults(side) {
    const t = tradeState();
    const q = (side === "give" ? t.q1 : t.q2).trim().toLowerCase();
    const box = $(side === "give" ? "tradeGiveResults" : "tradeGetResults");
    if (!box) return;
    if (q.length < 2) { box.innerHTML = ""; return; }
    let rows = [];
    if (side === "give") {
      rows = collection.filter(r => [r.name, r.number, r.setName].join(" ").toLowerCase().includes(q))
        .sort((a, b) => (marketValue(b).unit || 0) - (marketValue(a).unit || 0)).slice(0, 8)
        .map(r => ({key: r.id, pics: recordPics(r, "200w"), name: r.name, sub: [r.number, r.edition, r.grade ? gradeLabel(r.grade) : r.condition].filter(Boolean).join(", ") + " (you have " + r.qty + ")",
          price: marketValue(r).unit}));
    } else if (catalog) {
      const byNum = findByNumber(q);
      const found = (byNum.length ? byNum : searchByName(q, 8).items).slice(0, 8);
      rows = found.map(p => ({key: String(p.id), pics: productPics(p, "200w"), name: cleanName(p.name, p.rarity), sub: [p.number, p.rarity, p.group.name].filter(Boolean).join(", "),
        price: firstPrice(catalogPrice(p, printingsFor(p).filter(k => k !== "Normal")[0] || ""))}));
    }
    box.innerHTML = rows.length ? '<ul class="tr-results">' + rows.map(x => '<li><button type="button" class="tr-pick" data-tadd="' + side + ":" + esc(x.key) + '">' +
      '<span class="sleeve">' + imgTag(x.pics, x.name) + '</span><span class="ti-main"><b>' + esc(x.name) + '</b><span class="cell-sub">' + esc(x.sub) + "</span></span>" +
      '<span class="ti-val">' + (x.price == null ? "" : esc(usd(x.price))) + "</span></button></li>").join("") + "</ul>"
      : '<p class="small" style="margin:6px 0 0">Nothing matches "' + esc(q) + '".</p>';
  }
  function completeTrade() {
    const t = tradeState();
    if (!t.give.length && !t.get.length) return;
    const s = tradeTotals();
    if (!confirm("Complete this trade? You give " + usd(s.give) + " and get " + usd(s.get) + ".")) return;
    const beforeCollection = collection.map(r => Object.assign({}, r)), beforeSales = sales.slice(), beforeTrade = JSON.parse(JSON.stringify(t));
    const day = localDay(new Date());
    const note = "Traded" + (t.get.length ? " for " + t.get.map(it => { const p = catalog && catalog.byId.get(it.productId); return (it.qty > 1 ? it.qty + " × " : "") + (p ? cleanName(p.name, p.rarity) : "a card"); }).join(", ") : "") +
      (t.cash ? (t.cashDir === "get" ? " plus " : " and ") + usd(t.cash) + " cash" + (t.cashDir === "get" ? " to me" : " from me") : "");
    for (const it of t.give) {
      const r = collection.find(x => x.id === it.id);
      if (!r) continue;
      const qty = Math.min(it.qty, r.qty), u = marketValue(r).unit;
      sales.push(upgradeSale({id: newId(), date: day, qty, price: u == null ? 0 : u, fees: 0, notes: note.slice(0, 400), traded: true,
        name: r.name, productId: r.productId, number: r.number, setName: r.setName, rarity: r.rarity, edition: r.edition, condition: r.condition,
        language: r.language, grade: r.grade, paid: r.paid, market: u, image: imageFor(r, "200w"), record: JSON.parse(JSON.stringify(Object.assign({}, r, {qty})))}));
      r.qty -= qty;
      if (r.qty <= 0) { collection = collection.filter(x => x !== r); selected.delete(r.id); }
    }
    let added = 0;
    for (const it of t.get) {
      const p = catalog && catalog.byId.get(it.productId);
      if (!p) continue;
      const u = getLine(it).unit;
      addOrMerge(upgradeRecord({id: newId(), productId: p.id, productName: p.name, name: cleanName(p.name, p.rarity), setName: p.group.name, number: p.number, rarity: p.rarity,
        edition: it.edition || printingsFor(p).filter(k => k !== "Normal")[0] || "", condition: it.condition, language: "English", qty: it.qty, paid: u,
        location: t.loc, notes: "From a trade on " + fmtDate(parseDay(day)), added: new Date().toISOString()}));
      added += it.qty;
    }
    const gave = t.give.reduce((n, it) => n + it.qty, 0);
    trade = {give: [], get: [], cash: 0, cashDir: "get", loc: t.loc, q1: "", q2: ""};
    saveTrade();
    save(); render();
    toast("Trade done: " + plural(gave, "card") + " out, " + plural(added, "card") + " in.", {action: "Undo", onAction: () => {
      collection = beforeCollection; sales = beforeSales; trade = Object.assign(beforeTrade, {q1: "", q2: ""}); saveTrade(); save(); render();
    }});
  }
  function wireTrade(panel) {
    panel.addEventListener("click", e => {
      if (settings.tab !== "sales") return;
      const v = e.target.closest("[data-salesview]");
      if (v) { settings.salesView = v.dataset.salesview; saveSettings(); renderSalesTab(); const b = document.querySelector('[data-salesview="' + v.dataset.salesview + '"]'); if (b) b.focus(); return; }
      if (salesViewNow() !== "trade") return;
      const t = tradeState();
      const add = e.target.closest("[data-tadd]");
      if (add) {
        const [side, key] = add.dataset.tadd.split(/:(.*)/s);
        if (side === "give") {
          const r = collection.find(x => x.id === key);
          const it = t.give.find(x => x.id === key);
          if (it) it.qty = Math.min(r.qty, it.qty + 1); else t.give.push({id: key, qty: 1});
          t.q1 = ""; $("tradeGiveQ").value = ""; $("tradeGiveResults").innerHTML = "";
        } else {
          const p = catalog.byId.get(+key);
          t.get.push({key: newId(), productId: p.id, edition: printingsFor(p).filter(k => k !== "Normal")[0] || "", condition: "Near Mint", qty: 1});
          t.q2 = ""; $("tradeGetQ").value = ""; $("tradeGetResults").innerHTML = "";
        }
        refreshTrade(side);
        $(side === "give" ? "tradeGiveQ" : "tradeGetQ").focus();
        return;
      }
      const q = e.target.closest("[data-tq]");
      if (q) {
        const [side, i, d] = q.dataset.tq.split(":");
        const list = side === "give" ? t.give : t.get, it = list[+i];
        if (!it) return;
        const max = side === "give" ? (collection.find(r => r.id === it.id) || {qty: 1}).qty : 999;
        it.qty = Math.max(1, Math.min(max, it.qty + +d));
        refreshTrade(side);
        const again = document.querySelector('[data-tq="' + q.dataset.tq + '"]'); if (again && !again.disabled) again.focus();
        return;
      }
      const x = e.target.closest("[data-tx]");
      if (x) { const [side, i] = x.dataset.tx.split(":"); (side === "give" ? t.give : t.get).splice(+i, 1); refreshTrade(side); return; }
      if (e.target.closest("#tradeDo")) { completeTrade(); return; }
      if (e.target.closest("#tradeClear")) { trade = {give: [], get: [], cash: 0, cashDir: "get", loc: t.loc, q1: "", q2: ""}; saveTrade(); renderTrade(); }
    });
    panel.addEventListener("input", e => {
      if (settings.tab !== "sales" || salesViewNow() !== "trade") return;
      const t = tradeState();
      if (e.target.id === "tradeGiveQ") { t.q1 = e.target.value; showTradeResults("give"); }
      else if (e.target.id === "tradeGetQ") { t.q2 = e.target.value; showTradeResults("get"); }
      else if (e.target.id === "tradeCash") { t.cash = Math.max(0, num(e.target.value) || 0); refreshTrade(); }
      else if (e.target.id === "tradeLoc") { t.loc = e.target.value.trim(); saveTrade(); }
    });
    panel.addEventListener("change", e => {
      if (settings.tab !== "sales" || salesViewNow() !== "trade") return;
      const t = tradeState();
      if (e.target.id === "tradeCashDir") { t.cashDir = e.target.value === "give" ? "give" : "get"; refreshTrade(); return; }
      const g = e.target.closest("[data-tg]");
      if (g) { const [what, i] = g.dataset.tg.split(":"); const it = t.get[+i]; if (!it) return; if (what === "ed") it.edition = g.value; else it.condition = g.value; refreshTrade("get"); }
    });
  }

  /* ----- One card's price over time: the website keeps every evening's TCGplayer prices, a file per set */
  const histFiles = new Map();   // set (group) id -> promise of {days: [...], p: {productId: {printing: [cents or null per day]}}}
  function setHistory(groupId) {
    if (!histFiles.has(groupId)) histFiles.set(groupId, fetch("history/" + groupId + ".json").then(res => res.ok ? res.json() : null).catch(() => null));
    return histFiles.get(groupId);
  }
  function cardSeries(h, p, edition) {
    const sub = h && h.p && h.p[p.id];
    if (!sub || !Array.isArray(h.days)) return [];
    const keys = Object.keys(sub), printings = printingsFor(p);
    const key = keys.includes(edition) ? edition
      : (!edition || edition === "No edition mark") && keys.includes("Normal") ? "Normal"
      : printings.length <= 1 && keys.length === 1 ? keys[0]       // (a card printed only one way)
      : !edition ? printings.find(k => keys.includes(k)) : null;
    const arr = (key && sub[key]) || [];
    return h.days.map((d, i) => ({date: parseDay(d), v: typeof arr[i] === "number" ? arr[i] / 100 : null})).filter(x => x.date && x.v != null);
  }
  const HIST_RANGES = [["30", "30 days"], ["90", "90 days"], ["all", "All"]];
  async function loadCardHistory(r, p) {
    const h = await setHistory(p.group.id);
    const box = $("cardHist");
    if (!box || !drawerCtx || drawerCtx.id !== r.id) return;
    const all = cardSeries(h, p, r.edition);
    const sub = catalogPrice(p, r.edition), today = catalog && catalog.priceDay;
    if (sub && sub.market != null && today && !all.some(x => localDay(x.date) === today)) all.push({date: parseDay(today), v: sub.market});
    all.sort((a, b) => a.date - b.date);
    if (all.length < 2) {
      box.innerHTML = '<p class="small">Card Vault saves TCGplayer\'s market price every evening' + (h && h.days && h.days.length ? " (since " + esc(fmtDate(parseDay(h.days[0]))) + ")" : "") +
        ". The chart appears once this printing has prices from two days.</p>";
      return;
    }
    drawPriceHistory(box, all, (r.edition || printingsFor(p)[0] || "") + ", market price", x => "<b>" + esc(usd(x.v)) + "</b><span>" + esc(fmtDate(x.date)) + "</span>");
  }
  // The chart with its time range, from the points {date, v} (and whatever else the tooltip wants)
  function drawPriceHistory(box, all, label, tip) {
    const draw = range => {
      const cut = range === "all" ? 0 : Date.now() - (+range) * 86400000;
      let pts = all.filter(x => x.date.getTime() >= cut);
      if (pts.length < 2) pts = all.slice(-2);
      const first = pts[0].v, last = pts[pts.length - 1].v;
      box.innerHTML = '<div class="box-head"><span class="small">' + esc(label) + ". " + esc(fmtShortDate(pts[0].date)) + " to " + esc(fmtShortDate(pts[pts.length - 1].date)) + ": " +
        changeHTML(last - first, first > 0 ? (last - first) / first : null, true) + '</span><div class="seg" role="group" aria-label="Time range">' +
        HIST_RANGES.map(([k, l]) => '<button type="button" data-hr="' + k + '" aria-pressed="' + (k === range) + '">' + l + "</button>").join("") + "</div></div>" +
        '<div class="chart" id="cardChart" tabindex="0" role="img" aria-label="Price over time, ' + esc(usd(first)) + " to " + esc(usd(last)) + '. Use the arrow keys to read each day."></div><p class="sr" id="cardChartLive" aria-live="polite"></p>';
      renderChart($("cardChart"), pts, {tip: (ps, i) => tip(ps[i]), live: "cardChartLive", liveText: q => usd(q.v) + " on " + fmtDate(q.date)});
      box.querySelectorAll("[data-hr]").forEach(b => b.addEventListener("click", () => { settings.cardHistRange = b.dataset.hr; saveSettings(); draw(b.dataset.hr); }));
    };
    draw(HIST_RANGES.some(x => x[0] === settings.cardHistRange) ? settings.cardHistRange : "90");
  }

  /* ======================= Sets tab ======================= */
  let setsCache = null;
  // For every set you have a card from: how many of its cards you have, and the cheapest way to finish it.
  function setsData() {
    const master = settings.setsMode === "master";
    const out = ocgSetsData(master);
    if (!catalog) return out;
    const byGroup = productsByGroup();
    const owned = new Map();
    for (const r of collection) {
      const p = r.productId ? catalog.byId.get(r.productId) : null;
      if (!p || !p.group.id || p.sealed) continue;
      let o = owned.get(p.group.id);
      if (!o) owned.set(p.group.id, o = {ids: new Set(), numbers: new Set()});
      o.ids.add(p.id);
      o.numbers.add(normNumber(p.number));
    }
    for (const [gid, o] of owned) {
      const prods = (byGroup.get(gid) || []).filter(p => !p.sealed);
      if (!prods.length) continue;
      const items = new Map();
      for (const p of prods) {
        const n = normNumber(p.number);
        const byProduct = master || !n;
        const key = byProduct ? "p" + p.id : "n" + n;
        let it = items.get(key);
        if (!it) items.set(key, it = {key, products: [], owned: byProduct ? o.ids.has(p.id) : o.numbers.has(n), best: null});
        it.products.push(p);
        for (const ed in p.prices) {
          const v = firstPrice(p.prices[ed]);
          if (v != null && (!it.best || v < it.best.price)) it.best = {price: v, edition: ed, product: p};
        }
      }
      const all = Array.from(items.values());
      const missing = all.filter(it => !it.owned).sort((a, b) =>
        String(a.products[0].number).localeCompare(String(b.products[0].number), undefined, {numeric: true}) || a.products[0].name.localeCompare(b.products[0].name));
      out.push({group: prods[0].group, total: all.length, have: all.length - missing.length, missing,
        cost: missing.reduce((s, it) => s + (it.best ? it.best.price : 0), 0), unpriced: missing.filter(it => !it.best).length});
    }
    return out;
  }
  // The Japanese and Korean sets you have cards from, from the daily list: each card number once, or every rarity
  function ocgSetsData(master) {
    const mine = new Map();
    for (const r of collection) {
      if (!isOcg(r)) continue;
      const g = ocgRegion(r.number), k = (g.region === "JP" ? "jp:" : "kr:") + g.set;
      if (!mine.has(k)) mine.set(k, true);
    }
    if (!mine.size || !ocgCardsReady()) return [];
    const owned = ocgOwnedMaps(), out = [];
    for (const k of mine.keys()) {
      const set = ocgSetOf(k);
      if (!set || !set.cards.length) continue;
      const mkSet = ocgFindSet(k), tag = set.region === "jp" ? "-JP" : "-KR";
      const group = {id: k, name: mkSet ? mkSet.name : set.prefix + tag, abbr: set.prefix + tag, published: mkSet ? mkSet.date : ""};
      const items = [];
      for (const card of set.cards) {
        if (master) { for (const row of card.rows) items.push({key: ocgRef(row), card, row, owned: !!ocgRowOwned(owned, row)}); continue; }
        const priced = card.rows.filter(x => x.local > 0);
        items.push({key: card.number, card, row: priced.length ? priced.reduce((a, b) => (b.local < a.local ? b : a)) : card.rows[0] || null, owned: !!owned.byNumber.get(card.number)});
      }
      for (const it of items) it.best = it.row && it.row.local ? {price: ocgUSD(it.row.local, set.region), row: it.row} : null;
      const missing = items.filter(it => !it.owned);
      out.push({group, ocg: set, total: items.length, have: items.length - missing.length, missing,
        cost: missing.reduce((t, it) => t + (it.best && it.best.price != null ? it.best.price : 0), 0), unpriced: missing.filter(it => !it.best || it.best.price == null).length});
    }
    return out;
  }
  function ocgSetMissingHTML(s) {
    const region = s.ocg.region, master = settings.setsMode === "master";
    const every = '<p class="small sets-links" style="margin:12px 0 0"><button type="button" class="link-btn" data-cs-browse="' + esc(s.group.id) + '">See every card in this set, with prices</button></p>';
    if (!s.missing.length) return '<p class="small" style="margin:12px 0 0">You have every card in this set.</p>' + every;
    const shown = s.missing.slice(0, 150);
    return every + '<p class="results-head" style="margin-top:12px">Missing ' + plural(s.missing.length, "card") + (master ? " (every rarity counts separately)" : "") + ':</p><div class="results">' + shown.map(it => {
      const c = it.card, row = it.row, rarities = master ? [row ? row.rarity : ""] : c.rows.map(x => x.rarity).filter(Boolean);
      const ref = row ? esc(ocgRef(row)) : "", like = row ? ocgChaseLike(row).c : {number: c.number, rarity: ""};
      return '<div class="result static"><span class="sleeve"' + foilAttr(row && row.rarity) + ">" + imgTag({list: [row && row.img].filter(Boolean).concat(namePics(c.name, "200w", row && row.rarity).list)}, c.name) + "</span>" +
        '<span class="result-name">' + esc(c.name) + "</span>" +
        '<span class="result-meta">' + esc(c.number) + ", " + esc(rarities.join(" / ") || "rarity not stated") + "</span>" +
        '<span class="result-price">' + (it.best && it.best.price != null ? ocgMoneyHTML(row.local, region) + (!master && c.rows.filter(x => x.local).length > 1 ? ' <span class="small">' + esc(row.rarity) + "</span>" : "")
          : '<span class="small">' + (region === "jp" ? "Sold out at " + ocgSrc("jp", c.number) : "No Bunjang listings") + "</span>") + "</span>" +
        '<span class="result-actions">' + (ref ? (ocgWanted(like) ? '<span class="on-list">On want list</span>' : '<button class="btn" type="button" data-ocgc-want="' + ref + '">Want</button>') +
          '<button class="btn" type="button" data-ocgc-have="' + ref + '">I have it</button>' : "") + "</span></div>";
    }).join("") + "</div>" + (s.missing.length > shown.length ? '<p class="small">Showing the first ' + shown.length + ".</p>" : "");
  }
  function renderSets() {
    const panel = $("panel-sets");
    setsCache = null;
    if (!catalog && !(collection.some(isOcg) && ocgCardsReady())) {
      panel.innerHTML = emptyPanel("Set completion needs TCGplayer data", (SITE ? "Reload the page (it needs an internet connection)." : "Double-click <b>Update TCGplayer Data</b> in the Card Vault folder, then press F5 here.") + " Card Vault then shows how much of each set you have and what the rest would cost.");
      return;
    }
    setsCache = setsData();
    if (!setsCache.length) {
      panel.innerHTML = emptyPanel("No sets yet", collection.length
        ? (collection.some(isOcg) && !ocgCd.data ? "Loading the Japanese and Korean card list…" : "Sets come from TCGplayer's English catalog and Card Vault's Japanese and Korean lists, so cards added manually with other numbers aren't counted.")
        : "Add cards and Card Vault shows how complete each set is.");
      return;
    }
    const complete = setsCache.filter(s => !s.missing.length).length;
    const sorts = [["complete", "Most complete first"], ["cost", "Cheapest to finish"], ["name", "Set name"], ["newest", "Newest sets first"]];
    panel.innerHTML = '<div class="panel-head"><div><h2>Sets</h2><p>' + plural(setsCache.length, "set") + " you have cards from" +
      (complete ? ", " + complete + " complete" : "") + '.</p><p class="small">Collecting an archetype or a monster rather than a set? <button type="button" class="link-btn" data-theme-pick>Track every Shaddoll, Dark Magician Girl… card</button></p></div>' +
      '<div class="panel-tools"><input class="search" id="setsQ" type="search" placeholder="Find a set" aria-label="Find a set" value="' + esc(setsQuery) + '" style="flex:1 1 180px">' +
      '<label class="basis">Count <select class="select" id="setsMode"><option value="number"' + (settings.setsMode !== "master" ? " selected" : "") +
      '>Each card number once</option><option value="master"' + (settings.setsMode === "master" ? " selected" : "") + ">Every rarity (master set)</option></select></label>" +
      '<label class="basis">Sort <select class="select" id="setsSort">' + sorts.map(([v, l]) => '<option value="' + v + '"' + (settings.setsSort === v ? " selected" : "") + ">" + l + "</option>").join("") +
      "</select></label></div></div>" +
      '<div id="setsList"></div>' +
      '<p class="small">Cost to finish adds up the cheapest price of one copy of each card you\'re missing: TCGplayer\'s market price, BIGWEB\'s price for Japanese sets (Fullahead\'s for Rush Duel), Bunjang prices for Korean ones. ' +
      "Sets come from TCGplayer's English catalog and Card Vault's Japanese and Korean lists; cards added manually with other numbers aren't counted.</p>";
    renderSetsList();
  }
  function renderSetsList() {
    const box = $("setsList");
    if (!box || !setsCache) return;
    const q = setsQuery.trim().toLowerCase();
    const pct = s => s.total ? s.have / s.total : 0;
    const sorters = {
      complete: (a, b) => pct(b) - pct(a) || a.missing.length - b.missing.length || a.group.name.localeCompare(b.group.name),
      cost: (a, b) => a.cost - b.cost || pct(b) - pct(a),
      name: (a, b) => a.group.name.localeCompare(b.group.name),
      newest: (a, b) => String(b.group.published || "").localeCompare(String(a.group.published || "")) || a.group.name.localeCompare(b.group.name)
    };
    const list = setsCache.filter(s => !q || s.group.name.toLowerCase().includes(q) || String(s.group.abbr || "").toLowerCase().includes(q) || (s.ocg && ocgLangOf(s.ocg.region, s.ocg.prefix).toLowerCase().includes(q)))
      .sort(sorters[settings.setsSort] || sorters.complete);
    box.innerHTML = list.length ? list.map(setRowHTML).join("") : '<p class="small">No set name contains "' + esc(setsQuery.trim()) + '".</p>';
  }
  function setRowHTML(s) {
    const gid = s.group.id;
    const open = openSets.has(gid);
    const done = !s.missing.length;
    const shown = done ? 100 : Math.floor(s.have / s.total * 100);
    const year = s.group.published ? String(s.group.published).slice(0, 4) : "";
    return '<article class="set-row" data-gid="' + gid + '"><button type="button" class="set-toggle" aria-expanded="' + open + '" data-set="' + gid + '">' +
      '<span style="min-width:0"><span class="set-name">' + esc(s.group.name) + (isGoal(gid) ? ' <span class="goal-tag">Goal</span>' : "") + '</span><span class="set-sub">' + esc([s.group.abbr, year, s.ocg ? ocgLangOf(s.ocg.region, s.ocg.prefix) : ""].filter(Boolean).join(", ")) + "</span></span>" +
      '<span class="set-prog"><span class="progress" aria-hidden="true"><span style="width:' + (s.have / s.total * 100).toFixed(1) + '%"></span></span>' +
      '<span class="set-count"><b>' + s.have + " of " + s.total + "</b> (" + shown + "%)</span></span>" +
      '<span class="set-cost">' + (done ? "<b>Complete</b>" : "<b>" + esc(usd(s.cost)) + "</b><small>to finish" + (s.unpriced ? ", " + s.unpriced + " unpriced" : "") + "</small>") + "</span>" +
      '<span class="caret" aria-hidden="true"></span></button>' +
      (open ? '<div class="set-body">' + setMissingHTML(s) + "</div>" : "") + "</article>";
  }
  function setMissingHTML(s) {
    if (s.ocg) return ocgSetMissingHTML(s);
    const goal = isGoal(s.group.id);
    const every = '<p class="small sets-links" style="margin:12px 0 0"><button type="button" class="link-btn" data-cs-browse="en:' + s.group.id + '">See every card in this set, with prices</button>' +
      '<button type="button" class="link-btn" data-goal-toggle="' + s.group.id + '">' + (goal ? "Remove it from your goals" : "Make this set a goal") + "</button></p>";
    if (!s.missing.length) return '<p class="small" style="margin:12px 0 0">You have every card in this set.</p>' + every;
    const wanted = new Set(wants.map(w => w.productId));
    const shown = s.missing.slice(0, 150);
    return every + '<p class="results-head" style="margin-top:12px">Missing ' + plural(s.missing.length, "card") +
      (settings.setsMode === "master" ? " (every rarity counts separately)" : "") + ":</p><div class=\"results\">" + shown.map(it => {
        const p = it.best ? it.best.product : it.products[0];
        const rarities = Array.from(new Set(it.products.map(x => x.rarity).filter(Boolean)));
        const onList = it.products.some(x => wanted.has(x.id));
        return '<div class="result static"><span class="sleeve">' + imgTag(productPics(p, "200w"), p.name) + "</span>" +
          '<span class="result-name">' + esc(cleanName(p.name, p.rarity)) + "</span>" +
          '<span class="result-meta">' + esc(p.number) + ", " + esc(rarities.join(" / ") || "rarity unknown") + "</span>" +
          '<span class="result-price">' + (it.best ? esc(usd(it.best.price)) + (Object.keys(it.best.product.prices).length > 1 ? ' <span class="small">' + esc(it.best.edition) + "</span>" : "")
            : '<span class="small">No recent sales</span>') + "</span>" +
          '<span class="result-actions">' + (onList ? '<span class="on-list">On want list</span>' : '<button class="btn" type="button" data-want="' + p.id + '">Want</button>') +
          '<button class="btn" type="button" data-have="' + p.id + '">I have it</button></span></div>';
      }).join("") + "</div>" + (s.missing.length > shown.length ? '<p class="small">Showing the first ' + shown.length + ".</p>" : "");
  }

  // A Japanese or Korean card from the daily list: its prices by rarity, changes, chart, and the buttons to own or want it
  function openOcgCardPage(number, rarity, opts) {
    const card = ocgCardAt(number);
    if (!card) return;
    const region = card.region, lang = ocgLangOf(region, card.number), mkSet = ocgFindSet(card.set.id), rush = isRushNo(card.number), src = ocgSrc(region, card.number);
    const row = (typeof rarity === "string" ? card.rows.find(x => x.rarity === rarity) : null) || ocgRowFor(card, rarity) || card.rows.find(x => x.local) || card.rows[0] || null;
    const id = "ocg:" + card.number + ":" + (row ? row.rarity : "");
    drawerCtx = {mode: "price", id};
    csRemember(card.name);
    const mine = collection.filter(r => isOcg(r) && normNumber(r.number) === card.number);
    const want = wants.find(w => !w.productId && !w.ref && normNumber(w.number) === card.number && (!row || !w.rarity || !row.rarity || sameRowRarity(card.number, w.rarity, row.rarity)));
    const pics = {list: [row && row.img].filter(Boolean).concat(card.rows.map(x => x.img).filter(Boolean)).concat(namePics(card.name, "in_1000x1000", row && row.rarity).list)};
    const big = firstPhoto(pics);
    const q = encodeURIComponent((card.number + " " + card.name).trim());
    const ref = row ? esc(ocgRef(row)) : "";
    openDrawer(lang + " card price",
      '<a href="' + esc(big || "#") + '" target="_blank" rel="noopener" class="detail-img" title="Open full-size image"' + (big ? "" : ' onclick="return false"') + ">" +
      '<span class="sleeve"' + foilAttr(row && row.rarity) + ">" + imgTag(pics, card.name, true) + "</span></a>" +
      '<h3 class="detail-title">' + esc(card.name) + "</h3>" + (row && row.ja ? '<p class="detail-sub">' + esc(row.ja) + "</p>" : "") +
      '<p class="detail-sub"><button type="button" class="link-btn" id="csSetLink" title="Every card in this set">' + esc(mkSet ? mkSet.name : card.set.prefix + (region === "jp" ? "-JP" : "-KR")) + "</button>" +
      (mkSet && mkSet.date ? " (" + esc(mkSet.date.slice(0, 4)) + ")" : "") + "<br>" + esc(card.number) + (row && row.rarity ? ", " + esc(row.rarity) : "") + ", " + esc(lang) + "</p>" +
      '<div class="links">' + (region === "jp" ? (rush ? '<a target="_blank" rel="noopener" href="' + esc(FULLAHEAD_RD) + '">Fullahead</a>' : "") +
          '<a target="_blank" rel="noopener" href="https://auctions.yahoo.co.jp/search/search?p=' + q + '">Yahoo! Auctions JP</a>'
        : '<a target="_blank" rel="noopener" href="' + esc(bunjangSearchURL(card.number)) + '">Bunjang</a>') +
      '<a target="_blank" rel="noopener" href="https://www.ebay.com/sch/i.html?_nkw=' + q + '">eBay</a>' +
      '<a target="_blank" rel="noopener" href="https://www.cardmarket.com/en/YuGiOh/Products/Search?searchString=' + encodeURIComponent(card.name) + '">Cardmarket</a></div>' +
      '<div class="section"><h3>' + (region === "jp" ? src + " price" : "Bunjang price") + "</h3>" +
      '<table class="price-table"><thead><tr><th>Rarity</th><th class="num">Price</th><th>' + (region === "jp" ? "Stock" : "Listings") + "</th></tr></thead><tbody>" +
      card.rows.map(x => "<tr" + (x === row && card.rows.length > 1 ? ' class="mine"' : "") + "><td>" + esc(x.rarity || "not stated") + '</td><td class="num">' +
        (x.local ? ocgMoneyHTML(x.local, region) : '<span class="small">' + (region === "jp" ? "sold out" : "none") + "</span>") + "</td><td>" +
        esc(region === "jp" ? (x.stock ? (rush ? jpStockNote(x.stock, card.number) : String(x.stock)) : x.local ? "sold out, last price" : "") : x.n ? String(x.n) : "") + "</td></tr>").join("") + "</tbody></table>" +
      (row ? ocgChangesHTML(row, "Price change" + (card.rows.length > 1 ? " for " + (row.rarity || "this rarity") : "")) : "") +
      '<p class="small">From Card Vault\'s daily list, ' + esc(ocgListDate()) + ". " + esc(ocgShopAbout(region, card.number)) + "</p></div>" +
      (ocgHistoryBase() ? '<div class="section"><h3>Price over time</h3><div id="cardHist" class="card-hist"><p class="small">Loading…</p></div></div>' : "") +
      '<div class="section"><h3>Yours</h3>' +
      (mine.length ? '<ul class="cs-mine">' + mine.map(x => "<li><span>" + esc([x.qty > 1 ? x.qty + " ×" : "", x.rarity, x.grade ? gradeLabel(x.grade) : x.condition].filter(Boolean).join(" ")) +
        '<span class="small">' + esc(x.location ? " · " + x.location : "") + "</span></span>" +
        '<button type="button" class="link-btn" data-cs-mine="' + esc(x.id) + '">Open</button></li>').join("") + "</ul>" : '<p class="small">Not in your collection.</p>') +
      (want ? '<p class="small">On your want list' + (want.target != null ? ", target " + esc(usd(want.target)) : "") + ".</p>" : "") +
      '<div class="form-actions">' + (ref ? '<button class="btn btn-primary" type="button" data-ocgc-have="' + ref + '">' + (mine.length ? "Add more" : "I have it") + "</button>" +
        (want ? "" : '<button class="btn" type="button" data-ocgc-want="' + ref + '">Want</button>') : "") +
      (opts && opts.fromScan ? '<span class="spacer"></span><button class="btn" type="button" id="csScanMore">Scan another card</button>' : "") + "</div></div>");
    if ($("csScanMore")) $("csScanMore").addEventListener("click", () => openScanner({check: true}));
    $("csSetLink").addEventListener("click", () => openSearchSet(card.set.id));
    $("drawerBody").querySelectorAll("[data-cs-mine]").forEach(b => b.addEventListener("click", () => openDetails(b.dataset.csMine)));
    if (ocgHistoryBase() && row) loadOcgHistory({number: card.number, rarity: row.rarity}, row);
  }

  /* ======================= Want list tab ======================= */
  // A want's photo: the product's, the shop's, or (a card known only by name) any printing's.
  function wantPics(w, size) {
    const p = w.productId && catalog ? catalog.byId.get(w.productId) : null;
    if (p) return productPics(p, size);
    if (wantIsSealed(w)) {
      // (a Korean box has no photo: the drawn box shows its set's top card)
      const ref = String(w.ref || "");
      const s = ref.startsWith("krbox:") ? ocgFindSet("kr:" + ref.slice(6)) : null;
      return {list: [w.image, w.productId ? tcgImg(w.productId, size) : ""], sub: WANT_ONE[wantKind(w)], art: s && s.top && s.top.img ? s.top.img : ""};
    }
    if (ocgRegion(w.number)) return {list: [ocgImage(w)].concat(namePics(w.name, size, w.rarity).list)};
    return namePics(w.name, size, w.rarity);
  }
  // Where to buy a sealed product: the shop it came from, or TCGplayer
  function wantShopLink(w) {
    if (w.link) return {url: w.link, label: w.shop || "Shop"};
    if (w.productId) return {url: tcgPage(w.productId), label: "TCGplayer"};
    return null;
  }
  // Editing a want: the TCGplayer form (printing, target...) for a TCGplayer product, else target, quantity and notes.
  function openWantEdit(w) {
    const p = w.productId && catalog ? catalog.byId.get(w.productId) : null;
    if (p) { openWantForm(p, w); return; }
    drawerCtx = {mode: "want-edit", wantId: w.id};
    const sealed = wantIsSealed(w), live = w.ref ? shopWantLive(w) : null, price = wantPrice(w), src = wantSource(w);
    const shop = wantShopLink(w);
    const region = /korean/i.test(w.notes) || String(w.ref || "").startsWith("krbox:") ? "Korean" : /japanese/i.test(w.notes) || w.shop === "Yugi-Market" ? "Japanese" : "";
    const where = w.ref ? (w.shop === "Bunjang" ? "Bunjang (a Korean marketplace): the middle of the sellers' asking prices for an unopened box"
      : w.shop === "Yugi-Market" ? "Yugi-Market (based in Japan, ships worldwide), checked when you open the Market or this list, twice a day at most" : w.shop || "the shop")
      : src === "BIGWEB" ? "BIGWEB (a large Japanese card shop)" : src === "Fullahead" ? "Fullahead (a Japanese card shop), from Card Vault's daily list"
      : src === "Bunjang" ? "Bunjang (a Korean marketplace): what it sold for lately, else the middle of the sellers' asking prices" : "TCGplayer";
    openDrawer(sealed ? "Want list item" : "Want list card",
      '<div class="picked"><span class="sleeve' + (sealed ? " boxed" : "") + '">' + imgTag(wantPics(w, "in_400x400"), w.name, true) + "</span><div>" +
      "<h3>" + esc(w.name) + "</h3><p>" + esc(w.setName) + "</p><p>" +
      esc(sealed ? [WANT_ONE[wantKind(w)], region].filter(Boolean).join(", ") : [w.number, w.rarity].filter(Boolean).join(", ")) + "</p>" +
      (shop && sealed ? '<p style="margin-top:8px"><a target="_blank" rel="noopener" href="' + esc(shop.url) + '">' + esc(w.shop === "Bunjang" ? "See the boxes on Bunjang" : "Open at " + shop.label) + "</a></p>" : "") +
      "</div></div>" +
      '<form id="wantEditForm" class="stack">' +
      '<div class="grid-2"><label class="field"><span>Your target price (optional)</span><input class="input" id="weTarget" type="number" min="0" step="0.01" placeholder="$" value="' +
      (w.target == null ? "" : w.target) + '"></label>' +
      '<label class="field"><span>How many you want</span><input class="input" id="weQty" type="number" min="1" step="1" value="' + (w.qty || 1) + '"></label></div>' +
      '<div class="price-line" id="wePrice"></div>' +
      '<label class="field"><span>Notes (optional)</span><input class="input" id="weNotes" value="' + esc(w.notes || "") + '"></label>' +
      '<p class="hint" style="margin:0">Card Vault flags ' + (sealed ? "it" : "the card") + " when the price is at or below your target. The price is from " + esc(where) + ".</p>" +
      '<div class="form-actions"><button class="btn btn-primary" type="submit">Save</button><button class="btn" type="button" id="weGot">I got it</button>' +
      '<span class="spacer"></span><button class="btn btn-danger" type="button" id="weRemove">Remove</button></div></form>');
    const update = () => {
      const target = num($("weTarget").value);
      let html = price == null ? '<span class="small">No price yet' + (w.productId && !catalog ? " (it needs TCGplayer's price list)" : "") + ".</span>"
        : esc(src || "Price") + (w.ref && live == null ? " price when you added it" : " price") + ": <b>" + esc(usd(price)) + "</b>";
      if (shopWantSoldOut(w)) html += '<br><span class="small">Sold out at ' + esc(w.shop) + " right now.</span>";
      else if (price != null && target != null) {
        html += "<br>" + (price <= target ? '<span class="status"><span class="status-icon good" aria-hidden="true">&#10003;</span>At or below your target</span>'
          : '<span class="small">' + esc(usd(price - target)) + " above your target</span>");
      }
      $("wePrice").innerHTML = html;
    };
    $("weTarget").addEventListener("input", update);
    update();
    $("weGot").addEventListener("click", () => gotWant(w.id));
    $("weRemove").addEventListener("click", () => removeWant(w.id));
    const shown = formValues("wantEditForm");
    $("wantEditForm").addEventListener("submit", e => {
      e.preventDefault();
      const cur = wants.find(x => x.id === w.id);
      if (!cur) { closeDrawer(); toast("That isn't on your want list anymore, so nothing was saved.", {kind: "error"}); return; }
      const now = formValues("wantEditForm");
      if (now.weTarget !== shown.weTarget) cur.target = num($("weTarget").value);
      if (now.weQty !== shown.weQty) cur.qty = posInt($("weQty").value) || 1;
      if (now.weNotes !== shown.weNotes) cur.notes = $("weNotes").value.trim();
      save(); render(); closeDrawer();
      toast("Saved " + cur.name + ".");
    });
  }
  // How the want list is sorted (in each section); remembered on this device
  const WANT_SORTS = [["target", "At target first"], ["close", "Closest to target"], ["high", "Price: highest first"], ["low", "Price: lowest first"],
    ["drop", "Biggest price drop (7 days)"], ["name", "Name (A to Z)"], ["set", "Set and card number"], ["added", "Recently added"]];
  function wantSorter(by) {
    const byStr = (a, b) => String(a || "").localeCompare(String(b || ""), undefined, {numeric: true, sensitivity: "base"});
    const byName = (a, b) => byStr(a.w.name, b.w.name) || byStr(a.w.setName, b.w.setName) || byStr(a.w.number, b.w.number) || byStr(a.w.rarity, b.w.rarity);
    const none = (x, y) => (x == null) - (y == null);   // (no price, no target... at the end)
    // how far above the target, as a share of it (at or below the target: 0 or less)
    const gap = x => x.st.price != null && x.w.target != null && x.w.target > 0 ? (x.st.price - x.w.target) / x.w.target : null;
    // the 7-day change in the price you'd pay (TCGplayer printings only)
    const drop = x => {
      const p = x.w.productId && catalog ? catalog.byId.get(x.w.productId) : null;
      if (!p || x.st.price == null) return null;
      let then = null;
      for (const ed of (x.w.edition && x.w.edition !== "Any" ? [x.w.edition] : printingsFor(p))) {
        const sub = catalogPrice(p, ed);
        if (sub && firstPrice(sub) === x.st.price && sub.m7 != null) { then = sub.m7; break; }
      }
      return then == null ? null : x.st.price - then;
    };
    const sorters = {
      target: (a, b) => b.st.hit - a.st.hit || byName(a, b),
      close: (a, b) => none(gap(a), gap(b)) || (gap(a) - gap(b)) || byName(a, b),
      high: (a, b) => none(a.st.price, b.st.price) || b.st.price - a.st.price || byName(a, b),
      low: (a, b) => none(a.st.price, b.st.price) || a.st.price - b.st.price || byName(a, b),
      drop: (a, b) => none(drop(a), drop(b)) || (drop(a) - drop(b)) || byName(a, b),
      name: byName,
      set: (a, b) => byStr(a.w.setName, b.w.setName) || byStr(a.w.number, b.w.number) || byName(a, b),
      added: (a, b) => String(b.w.added || "").localeCompare(String(a.w.added || "")) || byName(a, b)
    };
    return sorters[by] || sorters.target;
  }
  // ----- Cheapest place to buy: a wanted card's price in the other markets Card Vault knows (TCGplayer for English
  // copies, BIGWEB/Fullahead for Japanese, Bunjang for Korean), in US$ before shipping and import costs. Shown when one
  // is at least 10% (and $1) cheaper than the want's own price. Rush Duel cards only compare with Rush Duel cards.
  const REGION_WORD = {en: "English", jp: "Japanese", kr: "Korean"};
  function wantElsewhere(w, price) {
    if (wantKind(w) !== "card" || price == null || price <= 0) return null;
    const rush = isRushNo(w.number);
    const mine = w.productId ? "en" : (ocgRegion(w.number) || {}).region === "KR" ? "kr" : "jp";
    const offers = [];
    if (ocgCd.data) {
      for (const c of ocgCd.data.byName.get(csNorm(plainName(w.name))) || []) {
        if (c.region === mine || isRushNo(c.number) !== rush) continue;
        for (const row of c.rows) {
          // (a Japanese copy the shop has in stock; a Korean one listed or sold lately)
          const live = c.region === "jp" ? row.stock !== 0 : (row.n > 0 || row.sales > 0);
          const usdv = row.local > 0 && live ? ocgUSD(row.local, c.region) : null;
          if (usdv != null) offers.push({region: c.region, usd: usdv, rarity: row.rarity, number: c.number, src: ocgSrc(c.region, c.number)});
        }
      }
    }
    if (mine !== "en" && catalog && !rush) {
      const best = cheapestByName(normCardName(w.name));
      if (best) offers.push({region: "en", usd: best.price, rarity: best.product.rarity, number: best.product.number, src: "TCGplayer", productId: best.product.id});
    }
    if (!offers.length) return null;
    offers.sort((a, b) => a.usd - b.usd);
    const o = offers[0];
    return o.usd <= price * 0.9 && price - o.usd >= 1 ? Object.assign({}, o, {saves: round2(price - o.usd)}) : null;
  }
  function wantElsewhereHTML(w, o) {
    if (!o) return "";
    const what = o.src + (o.rarity ? ", " + o.rarity : "");
    return '<span class="cell-sub abroad">Cheaper as ' + (o.region === "en" ? "an " : "a ") + REGION_WORD[o.region] + " copy: " + esc(usd(o.usd)) + " (" + esc(what) + ") " +
      (o.region === "en" ? '<a target="_blank" rel="noopener" href="' + esc(tcgPage(o.productId)) + '">See it</a>'
        : '<button type="button" class="link-btn" data-want-abroad="' + esc(o.number + "|" + (o.rarity || "")) + '">See it</button>') + "</span>";
  }
  function renderWants() {
    const panel = $("panel-wants");
    // (Yugi-Market's prices now: read twice a day at most, as in the Market)
    if (wants.some(w => String(w.ref || "").startsWith("ym:"))) loadYugiMarket();
    const sortBy = WANT_SORTS.some(x => x[0] === settings.wantsSort) ? settings.wantsSort : "target";
    // (the Japanese and Korean list, for cheaper copies elsewhere: loaded once, then this redraws)
    if (wants.some(w => wantKind(w) === "card")) ocgCardsReady();
    const rows = wants.map(w => { const st = wantStatus(w); return {w, st, kind: wantKind(w), away: wantElsewhere(w, st.price)}; }).sort(wantSorter(sortBy));
    const cheaperAway = rows.filter(x => x.away).length;
    const hits = rows.filter(x => x.st.hit).length;
    const sum = list => list.reduce((s, x) => s + (x.st.price || 0) * x.w.qty, 0);
    const priced = rows.some(x => x.st.price != null);
    const head = '<div class="panel-head"><div><h2>Want list</h2><p>' + (wants.length
      ? wantCount(wants.length) + (catalog || priced ? ", " + esc(usd(sum(rows))) + " at today's prices" : "") + (hits ? ", " + hits + " at or below your target" : "") +
        (cheaperAway ? ", " + plural(cheaperAway, "card") + " cheaper in another market" : "")
      : "Cards and sealed products you're looking for, with the price you'd pay.") + "</p></div>" +
      '<div class="panel-tools">' + (SITE && wants.length ? '<button class="btn" type="button" data-want-action="share">Share…</button>' : "") +
      (wants.some(w => w.productId && wantKind(w) === "card") ? '<button class="btn" type="button" data-want-action="tcg-cart">Buy on TCGplayer…</button>' : "") +
      '<button class="btn" type="button" data-want-action="add-sealed">Add sealed</button>' +
      '<button class="btn btn-primary" type="button" data-want-action="add">Add a card</button></div></div>';
    if (!wants.length) {
      panel.innerHTML = head + emptyPanel("Your want list is empty", "Add the cards, booster boxes and packs you're looking for, and the price you'd pay. Card Vault flags them when the price reaches your target. " +
        "You can also add them from the Market tab (English, Japanese and Korean), and missing cards from the Sets tab.");
      return;
    }
    // Cards, booster boxes, booster packs, other sealed: a table each, and a switch to show just one
    const groups = WANT_GROUPS.filter(([k]) => rows.some(x => x.kind === k));
    const view = groups.length > 1 && groups.some(([k]) => k === settings.wantsView) ? settings.wantsView : "";
    const seg = '<div class="want-view">' + (groups.length > 1 ? '<div class="seg seg-scroll" role="group" aria-label="Show" id="wantView">' +
      [["", "All"]].concat(groups).map(([k, l]) => '<button type="button" data-wantview="' + k + '" aria-pressed="' + (view === k) + '">' +
        (WANT_SHORT[k] ? '<span class="long">' + esc(l) + '</span><span class="short">' + WANT_SHORT[k] + "</span>" : esc(l)) +
        '<span class="tab-count">' + (k ? rows.filter(x => x.kind === k).length : rows.length) + "</span></button>").join("") + "</div>" : "") +
      '<label class="want-sort"><span class="small">Sort</span><select class="select" id="wantSort">' +
      WANT_SORTS.map(([k, l]) => '<option value="' + k + '"' + (k === sortBy ? " selected" : "") + ">" + esc(l) + "</option>").join("") + "</select></label></div>";
    const owned = pid => collection.filter(r => r.productId === pid).reduce((s, r) => s + r.qty, 0);
    const table = (kind, list) => {
      const sealed = kind !== "card";
      return '<div class="table-wrap"><table class="table want-table"><thead><tr><th class="c-thumb"><span class="sr">Image</span></th>' +
        "<th>" + (sealed ? "Product" : "Card") + "</th><th>" + (sealed ? "Where" : "Printing") + '</th><th class="num">' + (sealed ? "Price" : "Market price") +
        '</th><th class="num">Your target</th><th>Status</th><th><span class="sr">Actions</span></th></tr></thead><tbody>' +
        list.map(({w, st, away}) => {
          const have = w.productId ? owned(w.productId) : 0;
          let status;
          if (st.hit) status = '<span class="status"><span class="status-icon good" aria-hidden="true">&#10003;</span>At or below target</span>';
          else if (st.soldOut) status = '<span class="small">Sold out at ' + esc(w.shop || "the shop") + "</span>";
          else if (st.price == null) status = '<span class="small">' + (w.productId && !catalog ? "Needs TCGplayer data" : w.productId ? "No recent price" : "No price yet") + "</span>";
          else if (w.target == null) status = '<span class="small">No target set</span>';
          else status = esc(usd(st.price - w.target)) + ' <span class="small">above target</span>';
          const shop = sealed ? wantShopLink(w) : null;
          const sub = sealed ? [w.setName, /^(japanese|korean)$/i.test(w.notes) ? w.notes : ""] : [w.setName, w.number, w.rarity];
          const old = st.price != null && w.ref && shopWantLive(w) == null;
          return '<tr class="' + (st.hit ? "hit" : "") + '" data-want-row="' + esc(w.id) + '"><td class="c-thumb"><span class="sleeve' + (sealed ? " boxed" : "") + '">' +
            imgTag(wantPics(w, "200w"), w.name) + "</span></td>" +
            '<td><button type="button" class="cell-name" data-want-action="edit" data-id="' + esc(w.id) + '">' + esc(w.name) + (w.qty > 1 ? " ×" + w.qty : "") + '</button><span class="cell-sub">' +
            esc(sub.filter(Boolean).join(", ")) + (have ? ". You have " + have : "") + "</span></td>" +
            (sealed ? '<td data-label="Where"' + (shop ? "" : " data-empty") + ">" + (shop ? '<a target="_blank" rel="noopener" href="' + esc(shop.url) + '">' + esc(shop.label) + "</a>" : "") + "</td>"
              : '<td data-label="Printing">' + esc(w.edition === "Any" ? "Any printing" : w.edition) + "</td>") +
            '<td class="num" data-label="' + (sealed ? "Price" : "Market price") + '"' + (st.price == null ? " data-empty" : "") + ">" + esc(st.price == null ? "" : usd(st.price)) +
            (old ? ' <span class="small">when added</span>' : "") +
            '</td><td class="num" data-label="Your target"' + (w.target == null ? " data-empty" : "") + ">" + esc(w.target == null ? "" : usd(w.target)) +
            "</td><td>" + status + wantElsewhereHTML(w, away) + "</td>" +
            '<td><div class="want-actions"><button class="btn btn-small" type="button" data-want-action="got" data-id="' + esc(w.id) + '">I got it</button>' +
            '<button class="btn btn-small" type="button" data-want-action="edit" data-id="' + esc(w.id) + '">Edit</button>' +
            '<button class="btn btn-small" type="button" data-want-action="remove" data-id="' + esc(w.id) + '" aria-label="Remove ' + esc(w.name) + '">Remove</button></div></td></tr>';
        }).join("") + "</tbody></table></div>";
    };
    // (only cards: one table, as before)
    const titled = groups.length > 1 || (groups[0] && groups[0][0] !== "card");
    panel.innerHTML = head + seg + groups.filter(([k]) => !view || k === view).map(([k, l]) => {
      const list = rows.filter(x => x.kind === k);
      const hitsHere = list.filter(x => x.st.hit).length;
      return '<section class="want-group" data-want-group="' + k + '">' +
        (titled ? '<h3 class="want-h">' + esc(l) + ' <span class="small">' + esc([plural(list.length, k === "card" ? "card" : "item"),
          list.some(x => x.st.price != null) ? usd(sum(list)) : "", hitsHere ? hitsHere + " at or below target" : ""].filter(Boolean).join(" · ")) + "</span></h3>" : "") +
        table(k, list) + "</section>";
    }).join("") + (cheaperAway ? '<p class="small">"Cheaper as a Japanese, Korean or English copy": the lowest price Card Vault has for the same card (any rarity) in that market: ' +
      "TCGplayer's market price, BIGWEB's or Fullahead's price for a copy in stock, or Bunjang's recent sales or listings. In US$ at today's exchange rate, before shipping and import costs; shown when it's at least 10% cheaper than the price above.</p>" : "");
  }


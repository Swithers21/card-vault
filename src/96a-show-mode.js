  /* ======================= Show mode ======================= */
  // At a card show or a shop: scan or type a card (the price-checking scanner, 96-adding-cards) and, under its prices,
  // see whether it fills a gap in one of your master set binders (which one, and the page and pocket), whether you have
  // one already or it's on your want list, and how their asking price compares to TCGplayer's market price for that
  // printing in that condition. "I bought it" adds it at that price, into the binder when it fills a gap there.
  const SHOW_GOOD = 0.85, SHOW_FAIR = 1.05;   // (up to 15% under the market: a good deal; up to 5% over: fair)
  // How their price compares: {k: good | fair | high | none, t: the words}
  function dealVerdict(ask, market, low) {
    if (ask == null || !(ask >= 0)) return null;
    const under = low != null && low > 0 && ask < low ? " That's less than any TCGplayer listing (" + usd(low) + ")." : "";
    if (market == null || !(market > 0)) return {k: "none", t: (low != null ? "No recent sales to compare with; the lowest TCGplayer listing is " + usd(low) + "." : "No TCGplayer price to compare with.")};
    const r = ask / market, pct = Math.round(Math.abs(1 - r) * 100);
    if (r <= SHOW_GOOD) return {k: "good", t: "Good deal: " + pct + "% under the market price of " + usd(market) + "." + under};
    if (r <= SHOW_FAIR) return {k: "fair", t: "Fair: " + (pct === 0 ? "right at" : pct + "% " + (r < 1 ? "under" : "over")) + " the market price of " + usd(market) + "." + under};
    return {k: "high", t: "Above market: " + pct + "% over the market price of " + usd(market) + "."};
  }
  // What it means for you: a gap in a binder, one you have to put in, one already in, on the want list
  function showFacts(p) {
    const out = [];
    const b = p.group && binderOf(p.group.id);
    const it = b ? binderPlan(p.group.id).items.find(x => x.p.id === p.id) : null;
    if (it) {
      out.push(it.state === "in" ? {k: "have", t: "Already in " + b.name + " (page " + it.page + ", pocket " + it.pocket + ")."}
        : it.state === "move" ? {k: "have", t: "You have one to put in " + b.name + ": it's in " + (String(it.from.location || "").trim() || "no location") + "."}
        : {k: "gap", t: "Fills a gap in " + b.name + ": page " + it.page + ", pocket " + it.pocket + "." + (it.state === "kept" ? " (Yours is graded or kept elsewhere.)" : "")});
    }
    const w = wants.find(x => x.productId === p.id);
    if (w) out.push({k: "want", t: "On your want list" + (w.target != null ? ", up to " + usd(w.target) : "") + "."});
    return {facts: out, gap: !!(it && it.state !== "in" && it.state !== "move"), binder: b};
  }
  function showModeHTML(p, eds) {
    const f = showFacts(p);
    const ed0 = eds.filter(e => e !== "Normal")[0] || eds[0] || "";
    const last = (settings.lastAdd && settings.lastAdd.condition) || "Near Mint";
    return '<div class="show-box" data-show="' + p.id + '">' + f.facts.map(x => '<p class="show-fact show-' + x.k + '">' + esc(x.t) + "</p>").join("") +
      '<div class="show-ask"><label class="field"><span>Their price</span><span class="pct">$<input class="input" type="number" min="0" step="0.01" inputmode="decimal" data-show-ask aria-label="Their price"></span></label>' +
      (eds.length > 1 ? '<label class="field"><span>Printing</span><select class="select" data-show-ed>' + eds.map(e => '<option value="' + esc(e) + '"' + (e === ed0 ? " selected" : "") + ">" +
        esc(csPrinting(e)) + "</option>").join("") + "</select></label>" : "") +
      '<label class="field"><span>Condition</span><select class="select" data-show-cond>' + CONDITIONS.map(c => '<option' + (c === last ? " selected" : "") + ">" + c + "</option>").join("") + "</select></label></div>" +
      '<p class="show-verdict" data-show-verdict role="status"></p>' +
      '<button type="button" class="btn btn-small' + (f.gap ? " btn-primary" : "") + '" data-show-buy>' + (f.gap ? "I bought it: put it in " + esc(f.binder.name) : "I bought it: add it to my collection") + "</button></div>";
  }
  // The market price of that printing in that condition (adjusted as your collection's values are)
  function showMarket(p, ed, cond) {
    const sub = p.prices[ed] || p.prices[Object.keys(p.prices)[0]] || {};
    const f = conditionFactor({condition: cond});
    return {market: sub.market != null ? round2(sub.market * f) : null, low: sub.low != null ? round2(sub.low * f) : null};
  }
  function wireShowMode(out, products) {
    out.querySelectorAll(".show-box").forEach(box => {
      const p = products.find(x => x.id === +box.dataset.show);
      if (!p) return;
      const ask = box.querySelector("[data-show-ask]"), edSel = box.querySelector("[data-show-ed]"), condSel = box.querySelector("[data-show-cond]"), verdict = box.querySelector("[data-show-verdict]");
      const ed = () => edSel ? edSel.value : (printingsFor(p)[0] || "");
      const update = () => {
        const m = showMarket(p, ed(), condSel.value), v = dealVerdict(num(ask.value), m.market, m.low);
        verdict.textContent = v ? v.t : "";
        verdict.className = "show-verdict" + (v ? " show-" + v.k : "");
      };
      ask.addEventListener("input", update);
      if (edSel) edSel.addEventListener("change", update);
      condSel.addEventListener("change", update);
      box.querySelector("[data-show-buy]").addEventListener("click", () => showBuy(p, ed(), condSel.value, num(ask.value), box));
    });
  }
  // "I bought it": the card goes into the collection at their price, into the binder when it fills a gap there
  function showBuy(p, ed, cond, paid, box) {
    const f = showFacts(p);
    const location = f.gap ? f.binder.name : String((settings.lastAdd && settings.lastAdd.location) || "");
    const rec = upgradeRecord({id: newId(), productId: p.id, productName: p.name, name: cleanName(p.name, p.rarity), setName: p.group.name, number: p.number, rarity: p.rarity,
      edition: ed === "Normal" ? "No edition mark" : ed, condition: cond, language: "English", qty: 1, paid: paid != null && paid >= 0 ? round2(paid) : null, location,
      snap: snapFromCatalog(p, ed), added: new Date().toISOString()});
    const before = collection.slice(), res = addOrMerge(rec), was = res.merged ? res.record.qty - 1 : 0;
    save(); render();
    if (box) box.innerHTML = '<p class="show-fact show-have">Added' + (location ? " to " + esc(location) : "") + (paid != null ? " at " + esc(usd(paid)) : "") + ".</p>";
    toast("Added " + cleanName(p.name, p.rarity) + (location ? " to " + location : "") + ".", {action: "Undo", onAction: () => {
      if (res.merged) res.record.qty = was; else collection = before;
      save(); render();
    }});
  }

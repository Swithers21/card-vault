  /* ======================= Price paid, for many cards at once ======================= */
  // "Price paid…" on the bar of selected cards: fills in what you paid for every selected card at once (filter the
  // collection by set or location, "Select all shown", then this). Four ways: what each was worth the day you added it
  // (the price kept with the card then; today's for one added without it), today's value, the same price for each, or
  // one total split across them by what each is worth (a box's cost over the cards it gave you). Only the ones with no
  // price paid yet, unless you say otherwise; Undo puts back what was there.
  const pp = {ids: [], how: "added", each: "", total: "", onlyEmpty: true};
  const PP_HOW = [["added", "What each was worth when I added it"], ["today", "What each is worth today"], ["each", "The same price for each card"],
    ["total", "One total for all of them, split by what each is worth"]];
  function openPaidTool(ids) {
    pp.ids = Array.from(ids || []);
    pp.onlyEmpty = true;
    drawerCtx = {mode: "price-paid"};
    openDrawer("Price paid", '<div id="ppBody"></div>');
    renderPaidTool();
  }
  const ppToday = r => { const v = marketValue(r).unit; return v != null && v > 0 ? round2(v) : null; };
  const ppAdded = r => { const s = r.snap && (r.snap.market != null ? r.snap.market : r.snap.low); return s != null && s > 0 ? {v: round2(s), when: true} : (ppToday(r) != null ? {v: ppToday(r), when: false} : null); };
  // What each selected card would get: {rows: [{r, unit}], kept (already have one), unpriced, today (worth today, not when added), copies, sum}
  function paidPlan() {
    const recs = collection.filter(r => pp.ids.includes(r.id));
    const out = {rows: [], kept: 0, unpriced: 0, today: 0, copies: 0, sum: 0, entries: recs.length};
    const todo = [];
    for (const r of recs) { if (pp.onlyEmpty && r.paid != null) out.kept += r.qty; else todo.push(r); }
    if (pp.how === "total") {
      const total = num(pp.total);
      if (total == null || total < 0) return out;
      const w = todo.map(r => ppToday(r));
      const known = w.filter(x => x != null);
      // (a card with no value yet weighs as much as the average one; with none valued, it's an even split)
      const avg = known.length ? known.reduce((t, x) => t + x, 0) / known.length : 1;
      const weight = w.map(x => (x != null ? x : avg) || 1);
      const all = todo.reduce((t, r, i) => t + weight[i] * r.qty, 0);
      todo.forEach((r, i) => out.rows.push({r, unit: all > 0 ? round2(total * weight[i] / all) : 0}));
      // (the cents lost or gained rounding go to the biggest single card, so it adds up to what you paid)
      const off = round2(total - out.rows.reduce((t, x) => t + x.unit * x.r.qty, 0));
      const one = out.rows.filter(x => x.r.qty === 1).sort((a, b) => b.unit - a.unit)[0];
      if (off && one && one.unit + off >= 0) one.unit = round2(one.unit + off);
    } else {
      for (const r of todo) {
        let unit = null;
        if (pp.how === "each") unit = num(pp.each);
        else if (pp.how === "today") unit = ppToday(r);
        else { const a = ppAdded(r); if (a) { unit = a.v; if (!a.when) out.today += r.qty; } }
        if (unit == null || unit < 0) { out.unpriced += r.qty; continue; }
        out.rows.push({r, unit: round2(unit)});
      }
    }
    for (const x of out.rows) { out.copies += x.r.qty; out.sum += x.unit * x.r.qty; }
    out.sum = round2(out.sum);
    return out;
  }
  function renderPaidTool() {
    const box = $("ppBody");
    if (!box || !drawerCtx || drawerCtx.mode !== "price-paid") return;
    const recs = collection.filter(r => pp.ids.includes(r.id));
    const copies = recs.reduce((t, r) => t + r.qty, 0), withPaid = recs.filter(r => r.paid != null).length;
    const plan = paidPlan();
    const field = (id, label, value, hint) => '<label class="field pp-amount"><span>' + label + '</span><span class="pct">$<input class="input" type="number" min="0" step="0.01" inputmode="decimal" id="' + id +
      '" value="' + esc(value) + '"></span>' + (hint ? '<span class="hint">' + hint + "</span>" : "") + "</label>";
    box.innerHTML = '<p class="small" style="margin:0 0 12px">Fills in the price you paid for the ' + plural(copies, "card") + " you selected" + (recs.length !== copies ? " (" + plural(recs.length, "entry", "entries") + ")" : "") +
      ". Tip: filter your collection by set or location, tap <b>Select all shown</b>, then come here.</p>" +
      '<div class="field"><span>Use</span><div class="pp-how">' + PP_HOW.map(([k, l]) => '<label class="check-row"><input type="radio" name="ppHow" value="' + k + '"' + (pp.how === k ? " checked" : "") + "> <span>" + l + "</span></label>").join("") + "</div></div>" +
      (pp.how === "each" ? field("ppEach", "Price paid, each", pp.each) : "") +
      (pp.how === "total" ? field("ppTotal", "What you paid for all of them", pp.total, "A booster box, a lot or a bundle: the cards worth more get more of it.") : "") +
      (withPaid ? '<label class="check-row" style="margin-top:12px"><input type="checkbox" class="check" id="ppOnlyEmpty"' + (pp.onlyEmpty ? " checked" : "") + "> <span>Only the ones without a price paid (" +
        plural(withPaid, "entry", "entries") + " already " + (withPaid === 1 ? "has" : "have") + " one)</span></label>" : "") +
      '<div class="pcx-sum" id="ppSum">' + (plan.rows.length
        ? '<p class="pcx-line"><b>' + plural(plan.copies, "card") + " get a price paid, " + esc(usd(plan.sum)) + " in all.</b></p>" +
          '<ul class="pcx-left pp-rows">' + plan.rows.slice(0, 8).map(x => "<li>" + esc(x.r.name) + (x.r.number ? " · " + esc(x.r.number) : "") + ": " + esc(usd(x.unit)) + " each" +
            (x.r.qty > 1 ? " ×" + x.r.qty : "") + (x.r.paid != null ? ' <span class="small">(was ' + esc(usd(x.r.paid)) + ")</span>" : "") + "</li>").join("") +
          (plan.rows.length > 8 ? "<li>…and " + (plan.rows.length - 8) + " more</li>" : "") + "</ul>"
        : '<p class="pcx-line">' + (pp.how === "each" || pp.how === "total" ? "Type the amount above." : "Nothing to fill in.") + "</p>") +
      (plan.today ? '<p class="pcx-line small">' + (plan.today === 1 ? "1 card was added before Card Vault kept its price, so it gets today's." :
        plan.today + " cards were added before Card Vault kept their prices, so they get today's.") + "</p>" : "") +
      (plan.unpriced ? '<p class="pcx-line small">' + plural(plan.unpriced, "card has", "cards have") + " no price to go by, so " + (plan.unpriced === 1 ? "it stays" : "they stay") + " empty.</p>" : "") +
      (plan.kept && pp.onlyEmpty ? '<p class="pcx-line small">' + plural(plan.kept, "card keeps its", "cards keep their") + " price paid.</p>" : "") + "</div>" +
      '<div class="form-actions"><button type="button" class="btn btn-primary" id="ppGo"' + (plan.rows.length ? "" : " disabled") + ">Fill in " + (plan.rows.length ? plural(plan.copies, "card") : "") + "</button></div>";
    box.querySelectorAll("[name=ppHow]").forEach(b => b.addEventListener("change", () => { pp.how = b.value; renderPaidTool(); const f = $(pp.how === "each" ? "ppEach" : "ppTotal"); if (f) f.focus(); }));
    const typed = (id, key) => { const f = $(id); if (f) f.addEventListener("input", () => { pp[key] = f.value; const at = f.selectionStart; renderPaidTool(); const g = $(id); if (g) { g.focus(); try { g.setSelectionRange(at, at); } catch (e) { /* number fields */ } } }); };
    typed("ppEach", "each"); typed("ppTotal", "total");
    if ($("ppOnlyEmpty")) $("ppOnlyEmpty").addEventListener("change", e => { pp.onlyEmpty = e.target.checked; renderPaidTool(); });
    $("ppGo").addEventListener("click", applyPaid);
  }
  function applyPaid() {
    const plan = paidPlan();
    if (!plan.rows.length) return;
    const was = new Map(plan.rows.map(x => [x.r.id, x.r.paid]));
    for (const x of plan.rows) x.r.paid = x.unit;
    save();
    closeDrawer();
    render();
    toast("Filled in the price paid of " + plural(plan.copies, "card") + " (" + usd(plan.sum) + ").", {action: "Undo", onAction: () => {
      for (const r of collection) if (was.has(r.id)) { const v = was.get(r.id); if (v == null) r.paid = null; else r.paid = v; }
      save(); render(); toast("Put back.");
    }});
  }

  /* ======================= Shop money: month by month ======================= */
  // Trades & sales > Shop money. For each month: what you spent on cards (their prices paid, in the month you added
  // them to Card Vault, the ones sold since included), what cards sold for, the fees, what the cards sold had cost you,
  // the profit (sold less fees and cost) and the money in less the money out (sold less fees and spending). Trades
  // aren't counted, since no money changed hands: cards traded away, and cards from a trade. A card sold without a
  // price paid counts as costing nothing (and it says how many). As a file too, for your records or taxes.
  const fromTrade = r => /^From a trade on /.test(String((r && r.notes) || ""));
  const monthOf = iso => { const d = parseDate(iso); return d ? localDay(d).slice(0, 7) : ""; };
  const MONEY_COLS = [["bought", "Spent on cards"], ["sold", "Sold"], ["fees", "Fees"], ["cost", "Cost of cards sold"], ["profit", "Profit"], ["cash", "Money in less out"]];
  // {list: [{m: "2026-10", bought, boughtN, sold, soldN, fees, cost, noCost (cards sold with no price paid), profit, cash}]
  // newest first, total (the same, for them all), unpriced (cards of yours with no price paid, so not in spending), years}
  function moneyByMonth(year) {
    const months = new Map(), years = new Set();
    const at = m => {
      years.add(m.slice(0, 4));
      if (year && !m.startsWith(year)) return null;
      if (!months.has(m)) months.set(m, {m, bought: 0, boughtN: 0, sold: 0, soldN: 0, fees: 0, cost: 0, noCost: 0});
      return months.get(m);
    };
    let unpriced = 0;
    const buy = (r, qty) => {
      if (!r || fromTrade(r)) return;
      const m = monthOf(r.added);
      if (!m) return;
      if (r.paid == null) { if (!year || m.startsWith(year)) unpriced += qty; years.add(m.slice(0, 4)); return; }
      const x = at(m);
      if (x) { x.bought += r.paid * qty; x.boughtN += qty; }
    };
    for (const r of collection) buy(r, r.qty);
    // (a box or packs you opened: what you paid, in the month you opened it, since it's left your sealed products;
    // it counts in bought, not in boughtN, the cards)
    for (const o of openings) {
      if (o.cost == null || !parseDay(o.date)) continue;
      const x = at(o.date.slice(0, 7));
      if (x) x.bought += o.cost;
    }
    for (const s of sales) {
      if (s.record) buy(s.record, s.qty);
      if (s.traded) continue;
      const x = parseDay(s.date) ? at(s.date.slice(0, 7)) : null;
      if (!x) continue;
      x.sold += s.price * s.qty; x.soldN += s.qty; x.fees += s.fees || 0;
      if (s.paid != null) x.cost += s.paid * s.qty; else x.noCost += s.qty;
    }
    const list = Array.from(months.values()).sort((a, b) => b.m.localeCompare(a.m));
    const total = {m: "", bought: 0, boughtN: 0, sold: 0, soldN: 0, fees: 0, cost: 0, noCost: 0};
    for (const x of list) {
      for (const k of Object.keys(total)) if (k !== "m") total[k] += x[k];
      finishMoney(x);
    }
    return {list, total: finishMoney(total), unpriced, years: Array.from(years).sort().reverse()};
  }
  function finishMoney(x) {
    for (const k of ["bought", "sold", "fees", "cost"]) x[k] = round2(x[k]);
    x.profit = round2(x.sold - x.fees - x.cost);
    x.cash = round2(x.sold - x.fees - x.bought);
    return x;
  }
  const monthName = m => new Date(+m.slice(0, 4), +m.slice(5, 7) - 1, 1).toLocaleDateString("en-US", {month: "short", year: "numeric"});
  const moneyYear = () => settings.moneyYear == null ? String(new Date().getFullYear()) : String(settings.moneyYear);
  function renderMoney() {
    const panel = $("salesBody") || $("panel-sales");
    if (!panel) return;
    let year = moneyYear();
    let d = moneyByMonth(year);
    if (year && !d.years.includes(year)) { year = d.years[0] || ""; d = moneyByMonth(year); }
    const head = '<div class="panel-head sub-head"><div><h3 class="sub-h">Shop money</h3><p>What you spent on cards and what they sold for, month by month' + (year ? ", in " + esc(year) : "") + ".</p></div>" +
      (d.years.length ? '<div class="panel-tools"><label class="basis">Year <select class="select" id="moneyYear"><option value="">All years</option>' +
        d.years.map(y => '<option value="' + y + '"' + (y === year ? " selected" : "") + ">" + y + "</option>").join("") + "</select></label>" +
        '<button class="btn btn-small" type="button" id="moneyExport">Export CSV</button></div>' : "") + "</div>";
    if (!d.list.length) {
      panel.innerHTML = head + emptyPanel("Nothing to count yet", "Prices you paid for your cards and the sales you record (or bring in from SortSwift) show here, month by month.");
      return;
    }
    const t = d.total, money = v => esc(usd(v)), signed = v => v ? changeHTML(v, null, true) : money(0);
    const fact = (value, label) => '<div class="fact"><b>' + value + "</b><span>" + label + "</span></div>";
    // (a month with no sales has no profit to show)
    const cell = (x, k, label) => '<td class="num" data-label="' + label + '"' + (k === "profit" && !x.soldN ? " data-empty>" : k === "profit" || k === "cash" ? ">" + signed(x[k]) : (x[k] ? ">" + money(x[k]) : " data-empty>")) + "</td>";
    const notes = [
      "Spent on cards goes by the day each card was added to Card Vault, so cards brought in all at once from a file count in that month; a box or packs you opened count in the month you opened them." +
        (d.unpriced ? " " + plural(d.unpriced, "card has", "cards have") + ' no price paid, so ' + (d.unpriced === 1 ? "it isn't" : "they aren't") + ' counted: <button type="button" class="link-btn" id="moneyPaid">fill in prices paid</button>.' : ""),
      t.noCost ? plural(t.noCost, "card sold has", "cards sold have") + " no price paid, so " + (t.noCost === 1 ? "it counts" : "they count") + " as costing nothing in the profit." : "",
      "Trades aren't counted: no money changed hands. Profit is what cards sold for, less fees and what they cost you; money in less out takes off everything you spent on cards that month instead."
    ].filter(Boolean);
    panel.innerHTML = head + '<div class="facts sales-facts money-facts">' +
      fact(money(t.sold), "sold, " + plural(t.soldN, "card")) + fact(money(t.fees), "in fees") + fact(signed(t.profit), "profit") +
      fact(money(t.bought), "spent on cards") + fact(signed(t.cash), "money in less out") + "</div>" +
      '<div class="table-wrap"><table class="table stack-table money-table"><thead><tr><th>Month</th>' + MONEY_COLS.map(([, l]) => '<th class="num">' + esc(l) + "</th>").join("") + "</tr></thead><tbody>" +
      d.list.map(x => '<tr><th scope="row" class="money-month">' + esc(monthName(x.m)) + "</th>" + MONEY_COLS.map(([k, l]) => cell(x, k, l)).join("") + "</tr>").join("") +
      "</tbody>" + (d.list.length > 1 ? '<tfoot><tr><th scope="row" class="money-month">' + (year ? esc(year) : "All years") + "</th>" + MONEY_COLS.map(([k, l]) => cell(t, k, l)).join("") + "</tr></tfoot>" : "") +
      "</table></div>" + notes.map(n => '<p class="small">' + n + "</p>").join("");
    $("moneyYear").addEventListener("change", e => { settings.moneyYear = e.target.value; saveSettings(); renderMoney(); });
    $("moneyExport").addEventListener("click", () => exportMoneyCSV(year));
    if ($("moneyPaid")) $("moneyPaid").addEventListener("click", () => openPaidTool());
  }
  function exportMoneyCSV(year) {
    const d = moneyByMonth(year);
    if (!d.list.length) { toast("There's nothing to export."); return; }
    const money2 = v => (Math.round(v * 100) / 100).toFixed(2);
    const head = ["Month"].concat(MONEY_COLS.map(([, l]) => l + " (USD)"), ["Cards Bought", "Cards Sold"]);
    const line = (label, x) => [label].concat(MONEY_COLS.map(([k]) => money2(x[k])), [x.boughtN, x.soldN]).map(csvCell).join(",");
    const lines = [head.map(csvCell).join(",")].concat(d.list.slice().reverse().map(x => line(x.m, x)), [line(year ? year + " total" : "Total", d.total)]);
    download(new Blob(["﻿" + lines.join("\r\n")], {type: "text/csv;charset=utf-8"}), "card-vault-shop-money" + (year ? "-" + year : "") + ".csv");
    toast("Exported " + plural(d.list.length, "month") + ".");
  }

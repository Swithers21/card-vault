  /* ======================= Price history tab ======================= */
  const emptyPanel = (title, text, actions) => '<div class="empty"><h2>' + esc(title) + "</h2><p>" + text + "</p>" +
    (actions ? '<div class="actions">' + actions + "</div>" : "") + "</div>";
  function currentPeriod() {
    const avail = PERIODS.map(p => p[0]).filter(k => catalog && catalog.refDays[k]);
    return avail.includes(settings.histPeriod) ? settings.histPeriod : avail.includes("m7") ? "m7" : avail[0] || null;
  }
  function renderHistory() {
    const panel = insightBody();
    if (!collection.length) {
      panel.innerHTML = emptyPanel("Nothing to chart yet", "Add cards or import your TCGplayer CSV, and Card Vault keeps track of what your collection is worth over time.");
      return;
    }
    const period = currentPeriod();
    const ch = period ? periodChange(period) : null;
    let value = 0;
    for (const r of collection) { const u = marketValue(r).unit; if (u != null) value += u * r.qty; }
    const adjusted = settings.condAdjust && collection.some(r => marketValue(r).factor < 1);
    const pts = historySeries();
    const valueLine = "Collection value now: " + (usd(value) || "$0.00") + " (TCGplayer market" + (adjusted ? ", adjusted for condition" : "") + ").";
    let head;
    if (ch && ch.covered) {
      head = '<div class="value-label">Price change for the cards you have now</div>' +
        '<div class="hist-value">' + changeHTML(ch.diff, ch.pct, true) + "</div>" +
        '<div class="hist-change">' + esc(sinceLabel(period)) + ", from TCGplayer's market prices" + (ch.movers.some(m => isOcg(m.r)) ? " and the Japanese and Korean lists" : "") + "</div>" +
        '<div class="hist-note">' + esc(valueLine) + " " + plural(ch.covered, "card") + " had a price on both days.</div>";
    } else {
      head = '<div class="value-label">Collection value (TCGplayer market' + (adjusted ? ", adjusted for condition" : "") + ")</div>" +
        '<div class="hist-value">' + esc(usd(value) || "$0.00") + "</div>" + '<div class="hist-note">' +
        (!catalog ? (SITE ? "Prices need TCGplayer's card list (reload the page)." : "Load TCGplayer data (Update TCGplayer Data) to track prices.")
          : !period ? "Price changes show up once the updater has run on more than one day. Turn on daily updates to have Windows do that for you."
          : "None of your cards have TCGplayer prices from " + esc(fmtDate(parseDay(catalog.refDays[period]))) + ".") + "</div>";
    }
    panel.innerHTML = '<div class="hist-top"><div>' + head + "</div>" +
      (catalog ? '<div class="seg" role="group" aria-label="Compare prices with">' + PERIODS.map(([k, label]) => {
        const day = catalog.refDays[k];
        return '<button type="button" data-period="' + k + '" aria-pressed="' + (k === period) + '"' +
          (day ? ' title="TCGplayer prices from ' + esc(fmtDate(parseDay(day))) + '"' : ' disabled title="No saved prices from then yet"') + ">" + label + "</button>";
      }).join("") + "</div>" : "") + "</div>" +
      '<div class="box"><div class="box-head"><h3>Collection value over time</h3>' +
      (pts.length ? '<button class="link-btn" type="button" id="chartMode">' + (settings.chartTable ? "Show as chart" : "Show as table") + "</button>" : "") +
      '</div><div id="chartArea"></div>' +
      (pts.length ? '<p class="small" style="margin:10px 0 0">One point for each day of TCGplayer prices Card Vault has seen. Jumps also come from cards you add or remove.' +
        (pts.some(p => p.est) ? " Points before you started tracking are estimated from TCGplayer's saved prices for the cards you have now." : "") + "</p>" : "") +
      "</div>" +
      (ch && ch.covered ? '<div class="movers">' + moversHTML(ch, period) + "</div>" : "") +
      (catalog && period ? '<p class="small movers-more"><button type="button" class="link-btn" data-to-movers>More in Price movers: by percent, your want list, and every card on TCGplayer</button></p>' : "");
    drawHistory(pts);
  }
  function moversHTML(ch, period) {
    const gains = ch.movers.filter(m => m.total > 0).sort((a, b) => b.total - a.total).slice(0, 8);
    const drops = ch.movers.filter(m => m.total < 0).sort((a, b) => a.total - b.total).slice(0, 8);
    const item = m => '<button type="button" class="mover" data-open="' + esc(m.r.id) + '"><span class="sleeve">' + imgTag(recordPics(m.r, "200w"), m.r.name) + "</span>" +
      '<span style="min-width:0"><span class="mover-name">' + esc(m.r.name) + '</span><span class="mover-sub">' +
      esc([m.r.number, m.r.edition].filter(Boolean).join(", ")) + ": " + esc(usd(m.ch.then)) + " to " + esc(usd(m.ch.now)) +
      (m.r.qty > 1 ? ", " + m.r.qty + " copies" : "") + "</span></span>" +
      '<span class="mover-amt">' + changeHTML(m.total, m.ch.pct, true) + "</span></button>";
    const since = esc(sinceLabel(period));
    const box = (title, list, none) => '<section class="box"><div class="box-head"><h3>' + title + '</h3><span class="small">' + since + "</span></div>" +
      (list.length ? '<div class="mover-list">' + list.map(item).join("") + "</div>" : '<p class="small" style="margin:0">' + none + "</p>") + "</section>";
    return box("Biggest gains", gains, "None of your cards went up.") + box("Biggest drops", drops, "None of your cards went down.");
  }
  // ----- Price movers: the biggest TCGplayer price changes among your cards, your want list, and every card
  const MOVER_MINS = [["0", "Any price"], ["1", "$1 and up"], ["5", "$5 and up"], ["20", "$20 and up"], ["100", "$100 and up"]];
  function moverRowHTML(o) {
    // o: {pic, name, sub, then, now, diff, pct, attr, badge}
    return '<button type="button" class="mover" ' + o.attr + '><span class="sleeve' + (o.boxed ? " boxed" : "") + '"' + (o.foil || "") + ">" + imgTag(o.pic, o.name) + "</span>" +
      '<span style="min-width:0"><span class="mover-name">' + esc(o.name) + '</span><span class="mover-sub">' + esc(o.sub) + (o.sub ? ": " : "") +
      esc(usd(o.then)) + " to " + esc(usd(o.now)) + (o.each ? " each, " + o.each + " copies" : "") + "</span>" + (o.badge ? '<span class="mover-sub">' + o.badge + "</span>" : "") + "</span>" +
      '<span class="mover-amt">' + changeHTML(o.diff, o.pct, true) + "</span></button>";
  }
  // Up and down lists, biggest first by dollars or by percent; each item: {diff, pct, ...}
  function moverPair(items, by, n) {
    const key = x => by === "pct" ? (x.pct == null ? 0 : x.pct) : x.diff;
    const up = items.filter(x => x.diff > 0.004).sort((a, b) => key(b) - key(a)).slice(0, n);
    const down = items.filter(x => x.diff < -0.004).sort((a, b) => key(a) - key(b)).slice(0, n);
    return {up, down};
  }
  function moverBoxes(title, sub, pair, labels, none) {
    const box = (h, list, empty) => '<section class="box"><div class="box-head"><h3>' + h + "</h3></div>" +
      (list.length ? '<div class="mover-list">' + list.map(moverRowHTML).join("") + "</div>" : '<p class="small" style="margin:0">' + empty + "</p>") + "</section>";
    return '<div class="mv-section"><h3 class="sub-h">' + esc(title) + "</h3>" + (sub ? '<p class="small mv-sub">' + sub + "</p>" : "") +
      '<div class="movers">' + box(labels[0], pair.up, none[0]) + box(labels[1], pair.down, none[1]) + "</div></div>";
  }
  function renderMovers() {
    const panel = insightBody();
    if (!catalog) {
      panel.innerHTML = emptyPanel("Price movers need TCGplayer data", SITE ? "Reload the page (it needs an internet connection)." : "Double-click <b>Update TCGplayer Data</b> in the Card Vault folder, then press F5 here.");
      return;
    }
    const period = currentPeriod();
    if (!period) {
      panel.innerHTML = emptyPanel("No earlier prices yet", "Price movers compare today's TCGplayer prices with earlier ones. They show up after the next daily price update.");
      return;
    }
    const by = settings.moverBy === "pct" ? "pct" : "usd";
    const min = num(settings.moverMin) == null ? 1 : num(settings.moverMin);
    const big = (now, then) => Math.max(now || 0, then || 0) >= min;
    const owned = csOwnedMap();
    // your cards: each printing once (copies added together)
    const mine = new Map();
    for (const m of periodChange(period).movers) {
      if (!big(m.ch.marketNow, m.ch.marketThen)) continue;
      const k = (m.r.productId || normNumber(m.r.number) + "|" + m.r.rarity) + "|" + m.r.edition;
      const cur = mine.get(k);
      if (cur) { cur.diff += m.total; cur.qty += m.r.qty; continue; }
      mine.set(k, {r: m.r, qty: m.r.qty, diff: m.total, pct: m.ch.pct, then: m.ch.then, now: m.ch.now});
    }
    const mineItems = Array.from(mine.values()).map(x => ({diff: x.diff, pct: x.pct, then: x.then, now: x.now, pic: recordPics(x.r, "200w"), name: x.r.name, foil: foilAttr(x.r.rarity),
      sub: [x.r.number, x.r.edition].filter(Boolean).join(", "), each: x.qty > 1 ? x.qty : 0, attr: 'data-open="' + esc(x.r.id) + '"'}));
    // your want list: the printing you want (the cheapest when any will do)
    const wantItems = [];
    for (const w of wants) {
      const p = w.productId ? catalog.byId.get(w.productId) : null;
      if (!p) continue;
      let pick = null;
      for (const ed of (w.edition && w.edition !== "Any" ? [w.edition] : printingsFor(p))) {
        const s = catalogPrice(p, ed);
        if (s && s.market != null && s[period] != null && (!pick || s.market < pick.s.market)) pick = {ed, s};
      }
      if (!pick || !big(pick.s.market, pick.s[period])) continue;
      const diff = pick.s.market - pick.s[period];
      const hit = w.target != null && pick.s.market <= w.target;
      wantItems.push({diff, pct: pick.s[period] > 0 ? diff / pick.s[period] : null, then: pick.s[period], now: pick.s.market, pic: wantPics(w, "200w"), name: w.name,
        boxed: wantIsSealed(w), foil: wantIsSealed(w) ? "" : foilAttr(w.rarity), sub: [w.number, Object.keys(p.prices).length > 1 ? csPrinting(pick.ed) : ""].filter(Boolean).join(", "),
        badge: hit ? '<span class="status"><span class="status-icon good" aria-hidden="true">&#10003;</span>At or below your target</span>' : "", attr: 'data-mv-want="' + esc(w.id) + '"'});
    }
    // every English card and sealed product
    const market = [], sealed = [];
    for (const p of catalog.products) {
      for (const ed in p.prices) {
        const s = p.prices[ed];
        if (s.market == null || s[period] == null || !big(s.market, s[period])) continue;
        const diff = s.market - s[period];
        if (Math.abs(diff) < 0.005) continue;
        (p.sealed ? sealed : market).push({p, ed, diff, pct: s[period] > 0 ? diff / s[period] : null, then: s[period], now: s.market});
      }
    }
    const toRow = x => ({diff: x.diff, pct: x.pct, then: x.then, now: x.now, pic: productPics(x.p, "200w"), boxed: x.p.sealed, foil: x.p.sealed ? "" : foilAttr(x.p.rarity),
      name: x.p.sealed ? x.p.name : cleanName(x.p.name, x.p.rarity),
      sub: x.p.sealed ? x.p.group.name : [x.p.number, x.p.rarity, Object.keys(x.p.prices).length > 1 ? csPrinting(x.ed) : ""].filter(Boolean).join(", "),
      badge: owned.get(x.p.id) ? '<span class="cs-own">You have ' + owned.get(x.p.id) + "</span>" : "",
      attr: x.p.sealed ? 'data-mv-sealed="' + x.p.id + '"' : 'data-mv-card="' + esc(x.p.id + "|" + x.ed) + '"'});
    const mkPair = list => { const pr = moverPair(list, by, 12); return {up: pr.up.map(toRow), down: pr.down.map(toRow)}; };
    panel.innerHTML = '<div class="mv-tools"><div class="seg" role="group" aria-label="Compare prices with">' + PERIODS.map(([k, label]) => {
        const day = catalog.refDays[k];
        return '<button type="button" data-period="' + k + '" aria-pressed="' + (k === period) + '"' +
          (day ? ' title="TCGplayer prices from ' + esc(fmtDate(parseDay(day))) + '"' : ' disabled title="No saved prices from then yet"') + ">" + label + "</button>";
      }).join("") + "</div>" +
      '<div class="seg" role="group" aria-label="Biggest by"><button type="button" data-mover-by="usd" aria-pressed="' + (by === "usd") + '">Dollars</button>' +
      '<button type="button" data-mover-by="pct" aria-pressed="' + (by === "pct") + '">Percent</button></div>' +
      '<select class="select" id="moverMin" aria-label="Cards worth">' + MOVER_MINS.map(([k, l]) => '<option value="' + k + '"' + (num(k) === min ? " selected" : "") + ">" + l + "</option>").join("") + "</select></div>" +
      '<p class="small mv-note">TCGplayer market prices on ' + esc(fmtDate(parseDay(catalog.refDays[period]))) + " compared with " + esc(fmtDate(catalog.generated)) +
      ". A card that sold only once or twice can jump, so the price filter leaves out the cheapest ones" + (min ? " (under " + esc(usd(min)) + ")" : "") + "." +
      (ocgCd.data ? " Japanese and Korean cards: each set's prices against its latest earlier check at least that long ago." : "") + "</p>" +
      moverBoxes("Your cards", collection.length ? "All your copies of each printing together." : "", moverPair(mineItems, by, 10), ["Went up", "Went down"],
        [collection.length ? "None of your cards went up." : "Add cards to see yours here.", collection.length ? "None of your cards went down." : ""]) +
      (wants.length ? moverBoxes("Your want list", "The printing you want; the cheapest one when any will do.", moverPair(wantItems, by, 10), ["Went up", "Cheaper now"],
        ["Nothing on your want list went up.", "Nothing on your want list got cheaper."]) : "") +
      moverBoxes("Every card on TCGplayer", "", mkPair(market), ["Biggest risers", "Biggest drops"], ["No card went up.", "No card went down."]) +
      (sealed.length ? moverBoxes("Sealed products", "Booster boxes, packs, tins, decks…", mkPair(sealed), ["Went up", "Went down"], ["None went up.", "None went down."]) : "") +
      ocgMoversHTML(period, by, min);
  }
  // Japanese and Korean cards, from the daily list: each set's prices are compared with its latest earlier reading
  // at least a day, a week or a month old (new sets are checked daily, older ones weekly).
  function ocgMoversHTML(period, by, min) {
    if (!ocgCardsReady()) return ocgCardsURL() && !ocgCd.failed ? '<p class="small mv-sub">Loading the Japanese and Korean card list…</p>' : "";
    const big = (now, then) => Math.max(now || 0, then || 0) >= min;
    const owned = ocgOwnedMaps();
    let html = "";
    // (Rush Duel's cards in boxes of their own: another game, and Japanese ones from another shop)
    for (const [region, rush] of [["jp", false], ["kr", false], ["jp", true], ["kr", true]]) {
      const sets = Array.from(ocgCd.data[region].values()).filter(set => isRushNo(set.prefix) === rush);
      if (!sets.length) continue;
      const items = [];
      for (const set of sets) for (const card of set.cards) for (const row of card.rows) {
        if (!row.local || !row[period]) continue;
        const now = ocgUSD(row.local, region), then = ocgUSD(row[period], region);
        if (now == null || then == null || !big(now, then)) continue;
        const diff = now - then;
        if (Math.abs(diff) < 0.005) continue;
        items.push({row, diff, pct: then > 0 ? diff / then : null, then, now});
      }
      const toRow = x => { const c = x.row.card, s = ocgFindSet(c.set.id), have = ocgRowOwned(owned, x.row); return {diff: x.diff, pct: x.pct, then: x.then, now: x.now,
        pic: {list: [x.row.img].filter(Boolean).concat(namePics(c.name, "200w", x.row.rarity).list)}, name: c.name, foil: foilAttr(x.row.rarity),
        sub: [c.number, x.row.rarity, s ? s.name : ""].filter(Boolean).join(", "), badge: have ? '<span class="cs-own">You have ' + have + "</span>" : "", attr: 'data-ocgc-open="' + esc(ocgRef(x.row)) + '"'}; };
      const pr = moverPair(items, by, 12);
      html += moverBoxes("Every " + ocgLang(region) + (rush ? " Rush Duel" : "") + " card", region === "jp" ? (rush ? "Fullahead's" : "BIGWEB's") + " prices, in US$ at today's rate." : "Bunjang prices (sales, else asking), in US$ at today's rate.",
        {up: pr.up.map(toRow), down: pr.down.map(toRow)}, ["Biggest risers", "Biggest drops"], ["No card went up.", "No card went down."]);
    }
    return html;
  }

  function drawHistory(pts) {
    const area = $("chartArea");
    if (!area) return;
    if (!pts.length) {
      area.innerHTML = '<div class="chart-empty">' + (catalog ? "Your first point appears once your cards have TCGplayer prices."
        : "Load TCGplayer data to start tracking your collection's value.") + "</div>";
      return;
    }
    if (settings.chartTable) { area.innerHTML = historyTableHTML(pts); return; }
    const first = pts[0], last = pts[pts.length - 1];
    const label = "Collection value over time: " + (pts.length === 1 ? usd(last.v) + " on " + fmtDate(last.date)
      : "from " + usd(first.v) + " on " + fmtDate(first.date) + " to " + usd(last.v) + " on " + fmtDate(last.date)) +
      ". Use the left and right arrow keys to read each point.";
    area.innerHTML = '<div class="chart" id="valueChart" tabindex="0" role="group" aria-roledescription="chart" aria-label="' + esc(label) + '"></div>' +
      '<p class="sr" aria-live="polite" id="chartLive"></p>' +
      (pts.length === 1 ? '<p class="small" style="margin:6px 0 0">More points appear with each new day of prices.</p>' : "");
    renderChart($("valueChart"), pts);
  }
  function historyTableHTML(pts) {
    return '<div class="table-wrap" style="border:0"><table class="data-table"><thead><tr><th>Price day</th><th class="num">Value</th><th class="num">Cards</th><th>Note</th></tr></thead><tbody>' +
      pts.slice().reverse().map((p, i, arr) => {
        const prev = arr[i + 1];
        const note = p.est ? "Estimated for the cards you have now" : prev && !prev.est && prev.c !== p.c
          ? (p.c > prev.c ? "+" : "−") + plural(Math.abs(p.c - prev.c), "card") + " since the day before" : "";
        return "<tr><td>" + esc(fmtDate(p.date)) + '</td><td class="num">' + esc(usd(p.v)) + '</td><td class="num">' + p.c.toLocaleString() +
          "</td><td>" + esc(note) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }
  // Clean y-axis values around the data (a price chart doesn't need to start at $0).
  function niceTicks(min, max) {
    let lo = min, hi = max;
    if (hi - lo < 1e-9) { const pad = Math.max(1, Math.abs(hi) * 0.05); lo -= pad; hi += pad; }
    else { const pad = (hi - lo) * 0.08; lo -= pad; hi += pad; }
    if (min >= 0 && lo < 0) lo = 0;
    const raw = (hi - lo) / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    const step = Math.max(0.01, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag);
    const start = Math.floor(lo / step + 1e-9) * step, end = Math.ceil(hi / step - 1e-9) * step;
    const ticks = [];
    for (let i = 0; start + i * step <= end + step / 2; i++) ticks.push(start + i * step);
    const lead = step / Math.pow(10, Math.floor(Math.log10(step)));
    const decimals = Math.min(2, Math.max(0, -Math.floor(Math.log10(step) + 1e-9) + (Math.abs(lead - 2.5) < 1e-9 ? 1 : 0)));
    return {lo: start, hi: end, step, ticks, decimals, compact: step >= 1000};
  }
  function axisUSD(v, decimals, compact) {
    // Short labels ($12K, $12.5K) only when the steps are big enough for them to stay different.
    if (compact) return new Intl.NumberFormat("en-US", {style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1}).format(v);
    return new Intl.NumberFormat("en-US", {style: "currency", currency: "USD", minimumFractionDigits: decimals, maximumFractionDigits: decimals}).format(v);
  }
  function dateTicks(t0, t1, maxTicks) {
    if (t1 <= t0) return [{t: t0, label: fmtShortDate(new Date(t0))}];
    const spanDays = (t1 - t0) / 86400000;
    const step = [1, 2, 3, 7, 14, 21, 28].find(s => spanDays / s <= maxTicks - 1);
    const out = [];
    const d = new Date(t0);
    d.setHours(0, 0, 0, 0);
    if (step) {
      while (d.getTime() <= t1 + 3600000) {
        out.push({t: d.getTime(), label: fmtShortDate(d)});
        d.setDate(d.getDate() + step);
      }
    } else {
      const months = [1, 2, 3, 6, 12].find(mo => spanDays / (mo * 30.4) <= maxTicks - 1) || 12;
      d.setDate(1);
      if (d.getTime() < t0) d.setMonth(d.getMonth() + 1);
      while (d.getMonth() % months) d.setMonth(d.getMonth() + 1);
      while (d.getTime() <= t1) {
        out.push({t: d.getTime(), label: d.toLocaleDateString("en-US", d.getMonth() === 0 || !out.length ? {month: "short", year: "numeric"} : {month: "short"})});
        d.setMonth(d.getMonth() + months);
      }
    }
    return out.length ? out : [{t: t0, label: fmtShortDate(new Date(t0))}];
  }
  function tipHTML(pts, i) {
    const p = pts[i], prev = i > 0 ? pts[i - 1] : null;
    let note = "";
    if (p.est) note = "<span>Estimated from TCGplayer's saved prices for the cards you have now</span>";
    else if (prev && !prev.est && prev.c !== p.c) note = "<span>" + (p.c > prev.c ? "+" : "−") + esc(plural(Math.abs(p.c - prev.c), "card")) + " since " + esc(fmtShortDate(prev.date)) + "</span>";
    return "<b>" + esc(usd(p.v)) + "</b><span>" + esc(fmtDate(p.date)) + ", " + esc(plural(p.c, "card")) + "</span>" + note;
  }
  // A single-series line with a light area wash, hairline grid, an end marker, and a crosshair
  // tooltip that works with the mouse and with the arrow keys.
  function renderChart(el, pts, opts) {
    opts = opts || {};
    const tipFor = opts.tip || tipHTML;
    const W = Math.max(280, Math.round(el.getBoundingClientRect().width || el.clientWidth || 640));
    const H = W < 520 ? 210 : 250;
    const yt = niceTicks(Math.min(...pts.map(p => p.v)), Math.max(...pts.map(p => p.v)));
    const tickText = yt.ticks.map(v => axisUSD(v, yt.decimals, yt.compact));
    const M = {l: Math.max(...tickText.map(s => s.length)) * 7 + 14, r: 16, t: 14, b: 30};
    const iw = W - M.l - M.r, ih = H - M.t - M.b;
    const t0 = pts[0].date.getTime(), t1 = pts[pts.length - 1].date.getTime();
    const x = t => t1 === t0 ? M.l + iw / 2 : M.l + (t - t0) / (t1 - t0) * iw;
    const y = v => M.t + (1 - (v - yt.lo) / (yt.hi - yt.lo)) * ih;
    const P = pts.map(p => ({x: x(p.date.getTime()), y: y(p.v)}));
    const f = n => n.toFixed(1);
    let svg = '<svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" aria-hidden="true" focusable="false">';
    yt.ticks.forEach((v, i) => {
      const yy = Math.round(y(v)) + 0.5;
      if (i > 0) svg += '<line class="c-grid" x1="' + M.l + '" x2="' + (W - M.r) + '" y1="' + yy + '" y2="' + yy + '"/>';
      svg += '<text class="tick" x="' + (M.l - 8) + '" y="' + yy + '" text-anchor="end" dominant-baseline="middle">' + esc(tickText[i]) + "</text>";
    });
    const base = Math.round(M.t + ih) + 0.5;
    svg += '<line class="c-base" x1="' + M.l + '" x2="' + (W - M.r) + '" y1="' + base + '" y2="' + base + '"/>';
    for (const tk of dateTicks(t0, t1, Math.max(2, Math.floor(iw / 70)))) {
      const xx = x(tk.t);
      if (xx < M.l - 1 || xx > W - M.r + 1) continue;
      const anchor = xx < M.l + 24 ? "start" : xx > W - M.r - 24 ? "end" : "middle";
      svg += '<text class="tick" x="' + f(xx) + '" y="' + (H - 9) + '" text-anchor="' + anchor + '">' + esc(tk.label) + "</text>";
    }
    if (P.length > 1) {
      const line = P.map((q, i) => (i ? "L" : "M") + f(q.x) + " " + f(q.y)).join(" ");
      svg += '<path class="c-area" d="' + line + " L" + f(P[P.length - 1].x) + " " + (M.t + ih) + " L" + f(P[0].x) + " " + (M.t + ih) + ' Z"/>' +
        '<path class="c-line" d="' + line + '"/>';
    }
    const end = P[P.length - 1];
    svg += '<circle class="c-dot" cx="' + f(end.x) + '" cy="' + f(end.y) + '" r="5"/>' +
      '<g class="c-hover" visibility="hidden"><line class="c-cross" x1="0" x2="0" y1="' + M.t + '" y2="' + (M.t + ih) + '"/><circle class="c-dot" cx="0" cy="0" r="5"/></g>' +
      '<rect class="c-hit" x="' + (M.l - 12) + '" y="0" width="' + (iw + 24) + '" height="' + (M.t + ih) + '"/></svg>';
    el.innerHTML = svg + '<div class="chart-tip" hidden></div>';
    const svgEl = el.querySelector("svg"), tip = el.querySelector(".chart-tip"), hover = el.querySelector(".c-hover");
    const cross = hover.querySelector("line"), dot = hover.querySelector("circle");
    let active = -1;
    const show = i => {
      active = i;
      const q = P[i];
      hover.setAttribute("visibility", "visible");
      cross.setAttribute("x1", f(q.x));
      cross.setAttribute("x2", f(q.x));
      dot.setAttribute("cx", f(q.x));
      dot.setAttribute("cy", f(q.y));
      tip.innerHTML = tipFor(pts, i);
      tip.hidden = false;
      const scale = (svgEl.getBoundingClientRect().width || W) / W;
      const tw = tip.offsetWidth, th = tip.offsetHeight, cw = el.clientWidth || W;
      let left = q.x * scale - tw / 2;
      left = Math.max(0, Math.min(left, cw - tw));
      let top = q.y * scale - th - 14;
      if (top < 0) top = q.y * scale + 14;
      tip.style.left = left + "px";
      tip.style.top = top + "px";
    };
    const hide = () => { active = -1; hover.setAttribute("visibility", "hidden"); tip.hidden = true; };
    const nearest = clientX => {
      const box = svgEl.getBoundingClientRect();
      const vx = (clientX - box.left) / ((box.width || W) / W);
      let best = 0, bd = Infinity;
      P.forEach((q, i) => { const d = Math.abs(q.x - vx); if (d < bd) { bd = d; best = i; } });
      return best;
    };
    svgEl.addEventListener("pointermove", e => show(nearest(e.clientX)));
    svgEl.addEventListener("pointerleave", () => { if (document.activeElement !== el) hide(); });
    el.addEventListener("focus", () => show(active >= 0 ? active : P.length - 1));
    el.addEventListener("blur", hide);
    el.addEventListener("keydown", e => {
      let i = active < 0 ? P.length - 1 : active;
      if (e.key === "ArrowLeft") i = Math.max(0, i - 1);
      else if (e.key === "ArrowRight") i = Math.min(P.length - 1, i + 1);
      else if (e.key === "Home") i = 0;
      else if (e.key === "End") i = P.length - 1;
      else if (e.key === "Escape") { hide(); return; }
      else return;
      e.preventDefault();
      show(i);
      const p = pts[i], live = $(opts.live || "chartLive");
      if (live) live.textContent = opts.liveText ? opts.liveText(p) : usd(p.v) + " on " + fmtDate(p.date) + ", " + plural(p.c, "card") + (p.est ? ", estimated" : "");
    });
  }

  /* ======================= Insights: price history, where your value is, worth grading, tidy up ======================= */
  const INSIGHT_VIEWS = [["history", "Price history"], ["movers", "Price movers"], ["value", "Where your value is"], ["grading", "Worth grading"], ["openings", "Box openings"],
    ["watch", "Ban list & reprints"], ["tidy", "Tidy up"]];
  function renderInsights() {
    const panel = $("panel-history");
    const view = INSIGHT_VIEWS.some(v => v[0] === settings.insightView) ? settings.insightView : "history";
    panel.innerHTML = '<div class="panel-head"><div><h2>Insights</h2></div><div class="panel-tools"><div class="seg seg-scroll" role="group" aria-label="Insights" id="insightSeg">' +
      INSIGHT_VIEWS.map(([k, l]) => '<button type="button" data-insight="' + k + '" aria-pressed="' + (k === view) + '">' + esc(l) + "</button>").join("") +
      '</div></div></div><div id="insightBody"></div>';
    if (view === "movers") renderMovers();
    else if (view === "value") renderValueBreakdown();
    else if (view === "grading") renderWorthGrading();
    else if (view === "tidy") renderTidy();
    else if (view === "openings") renderOpenings();
    else if (view === "watch") renderWatch();
    else renderHistory();
  }
  const insightBody = () => $("insightBody") || $("panel-history");
  const miniThumb = r => '<button type="button" class="ins-thumb" data-open="' + esc(r.id) + '" aria-label="Open ' + esc(r.name) + '"><span class="sleeve' + (r.sealed ? " boxed" : "") + '">' +
    imgTag(recordPics(r, "200w"), r.name) + "</span></button>";

  // ----- Where your value is: by set, rarity and location, and how much rides on the top cards
  // How many copies count: all of them, or in the PSA 10 view one of each ungraded printing (like the summary).
  function countedCopies() {
    if (!settings.gradedView) return collection.map(r => ({r, n: r.qty}));
    const seen = new Set(), out = [];
    for (const r of collection) {
      if (r.sealed) continue;
      if (!r.grade) { const k = printingKey(r); if (seen.has(k)) continue; seen.add(k); }
      out.push({r, n: r.grade ? r.qty : 1});
    }
    return out;
  }
  function valueBy(keyOf) {
    const m = new Map();
    let total = 0;
    for (const {r, n} of countedCopies()) {
      const u = unitValue(r);
      if (u == null) continue;
      const v = u * n, k = keyOf(r);
      total += v;
      const e = m.get(k) || {label: k, value: 0, cards: 0};
      e.value += v; e.cards += n;
      m.set(k, e);
    }
    return {total, rows: Array.from(m.values()).filter(e => e.value > 0).sort((a, b) => b.value - a.value)};
  }
  // A list of bars, one hue, longest first, each with its amount and share written out.
  function barListHTML(title, g, limit) {
    if (!g.rows.length) return "";
    const rows = g.rows.slice(0, limit), rest = g.rows.slice(limit);
    if (rest.length) rows.push({label: plural(rest.length, "other"), value: rest.reduce((t, e) => t + e.value, 0), cards: rest.reduce((t, e) => t + e.cards, 0), other: true});
    const max = Math.max(...rows.map(e => e.value));
    return '<div class="box vb-box"><h3 class="vb-h">' + esc(title) + '</h3><ul class="vb-list">' + rows.map(e => {
      const share = g.total ? e.value / g.total : 0;
      return '<li class="vb-row' + (e.other ? " other" : "") + '" title="' + esc(e.label + ": " + usd(e.value) + ", " + plural(e.cards, "card")) + '">' +
        '<span class="vb-label">' + esc(e.label) + '</span><span class="vb-val">' + esc(usd(e.value)) + " <small>" + (share * 100).toFixed(share < 0.1 ? 1 : 0) + "%</small></span>" +
        '<span class="vb-track" aria-hidden="true"><span style="width:' + Math.max(1, e.value / max * 100).toFixed(1) + '%"></span></span></li>';
    }).join("") + "</ul></div>";
  }
  function renderValueBreakdown() {
    const el = insightBody();
    if (!collection.length) { el.innerHTML = emptyPanel("Nothing here yet", "Add cards and Card Vault shows where your collection's value sits."); return; }
    const items = countedCopies().map(({r, n}) => ({r, n, v: (unitValue(r) || 0) * n})).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
    const total = items.reduce((t, x) => t + x.v, 0);
    if (!total) { el.innerHTML = '<div class="notice">None of your cards have a price yet, so there\'s nothing to break down.</div>'; return; }
    const top = items.slice(0, 10), topV = top.reduce((t, x) => t + x.v, 0), share = topV / total;
    const basis = settings.gradedView ? "PSA 10 values" : settings.basis === "paid" ? "what you paid" : "TCGplayer market prices";
    const byLoc = valueBy(r => r.location || "No location");
    el.innerHTML = '<p class="small" style="margin:0 0 14px">Your collection is worth <b>' + esc(usd(total)) + "</b> at " + basis + ". Here's where that sits.</p>" +
      '<div class="box vb-top"><div class="box-head"><h3>Your ' + (top.length < 10 ? top.length : 10) + " most valuable printings</h3>" +
      '<span class="small">' + esc(usd(topV)) + ", " + Math.round(share * 100) + "% of the total</span></div>" +
      '<div class="share-bar" role="img" aria-label="' + Math.round(share * 100) + "% of your collection's value is in these " + top.length + ' printings"><span style="width:' + (share * 100).toFixed(1) + '%"></span></div>' +
      '<ol class="vb-cards">' + top.map(x => '<li>' + miniThumb(x.r) + '<span class="vb-card-name"><button type="button" class="cell-name" data-open="' + esc(x.r.id) + '">' + esc(x.r.name) + "</button>" +
        '<span class="cell-sub">' + esc([x.r.number, x.r.rarity].filter(Boolean).join(", ") || x.r.setName) + (x.n > 1 ? ", " + x.n + " copies" : "") + "</span></span>" +
        '<span class="vb-val">' + esc(usd(x.v)) + " <small>" + (x.v / total * 100).toFixed(1) + "%</small></span></li>").join("") + "</ol></div>" +
      '<div class="vb-grid">' + barListHTML("By set", valueBy(r => r.setName || "Set unknown"), 10) +
      barListHTML("By rarity", valueBy(r => r.sealed ? "Sealed products" : r.rarity || "Rarity unknown"), 8) +
      (byLoc.rows.some(e => e.label !== "No location") ? barListHTML("By location", byLoc, 8) : "") +
      barListHTML("By printing", valueBy(r => r.sealed ? "Sealed products" : r.grade ? "Graded" : r.edition || "Printing unknown"), 6) + "</div>";
  }

  // ----- Worth grading: cards where a PSA 10 (or 9) beats the raw price by more than grading costs
  // The general cost per card, for a company whose fees you haven't entered (and for "Other").
  const gradingCostEach = () => { const n = num(settings.gradingCost); return n == null ? 30 : Math.max(0, n); };
  const gradingMinGain = () => { const n = num(settings.gradingMin); return n == null ? 50 : n; };
  // Your own fees at each company (Settings > Grading fees): the service level you use, its fee per card, and shipping
  // and insurance per card (your share of an order's).
  function cleanGradingFees(o) {
    const out = {};
    for (const c of GRADING_COS) {
      const f = o && typeof o === "object" && o[c.id];
      if (!f || typeof f !== "object") continue;
      const fee = num(f.fee), ship = num(f.ship), level = String(f.level || "").trim().slice(0, 60);
      if (fee == null && ship == null && !level) continue;
      out[c.id] = {level, fee: fee == null ? null : Math.max(0, round2(fee)), ship: ship == null ? null : Math.max(0, round2(ship))};
    }
    return out;
  }
  // What a card costs at this company: the fee you typed, or else the built-in price list's fee for the level you chose
  // (or the usual level), plus your shipping. builtin: the fee came from the price list. info: that level's details.
  function gradingFee(co) {
    const f = (settings.gradingFees || {})[co] || {};
    const own = num(f.fee), ship = num(f.ship) || 0, level = String(f.level || "");
    const picked = level ? gradingLevel(co, level) : null;
    if (own != null) return {level, fee: own, ship, total: round2(own + ship), builtin: false, info: picked};
    const l = picked && picked.fee != null ? picked : gradingUsual(co);
    if (!l) return ship ? {level, fee: 0, ship, total: round2(ship), builtin: false, info: null} : null;
    return {level: l.name, fee: l.fee, ship, total: round2(l.fee + ship), builtin: true, info: l};
  }
  const gradingCostFor = co => { const f = gradingFee(co); return f ? f.total : gradingCostEach(); };
  const gradingCoNow = () => GRADING_COS.some(c => c.id === settings.gradingCo) ? settings.gradingCo : "PSA";
  const gradingCoName = id => (GRADING_COS.find(c => c.id === id) || {name: id}).name;
  function gradingEstimate(r, co) {
    if (r.sealed || r.grade) return null;
    const raw = rawMarket(r), ten = psa10Value(r);
    if (raw == null || !ten) return null;
    const cost = gradingCostFor(co || gradingCoNow()), nine = round2(ten.unit * (gradeShare("9") || 0.3));
    return {raw, ten, nine, cost, gain10: round2(ten.unit - raw - cost), gain9: round2(nine - raw - cost)};
  }
  const tenSource = ten => ten.from === "pricecharting" ? "PriceCharting" : ten.from === "yours" ? "your value" : "estimate";
  // ----- Your grading results: every graded card you have, what grading cost and what it's worth now against the
  // raw card, by company. A card graded before Card Vault kept these counts without its cost.
  function gradingResults() {
    const rows = [];
    for (const r of collection) {
      if (r.sealed || !r.grade || !r.grade.company) continue;
      const gv = gradedValue(r), raw = priceInfo(r).unit, res = r.gradeResult;
      const cost = res && res.cost != null ? res.cost : null;
      const added = gv && raw != null ? gv.unit - raw : null;
      rows.push({r, co: gradingCoName(r.grade.company) || r.grade.company, grade: num(String(r.grade.grade || "").replace(/[^0-9.]/g, "")), gv, raw, cost,
        added, net: added != null && cost != null ? added - cost : null, est: !!(gv && /estimate|share/.test(gv.from)),
        days: res && res.sent && res.back ? Math.round(((parseDay(res.back) || 0) - (parseDay(res.sent) || 0)) / 86400000) : null});
    }
    const byCo = new Map();
    for (const x of rows) {
      const q = x.r.qty, c = byCo.get(x.co) || {co: x.co, cards: 0, tens: 0, nines: 0, lower: 0, spent: 0, costed: 0, added: 0, valued: 0, net: 0, netCards: 0, days: [], est: 0};
      c.cards += q;
      if (x.grade >= 10) c.tens += q; else if (x.grade >= 9) c.nines += q; else c.lower += q;
      if (x.cost != null) { c.spent += x.cost * q; c.costed += q; }
      if (x.added != null) { c.added += x.added * q; c.valued += q; if (x.est) c.est += q; }
      if (x.net != null) { c.net += x.net * q; c.netCards += q; }
      if (x.days != null) c.days.push(x.days);
      byCo.set(x.co, c);
    }
    return {rows: rows.sort((a, b) => ((b.added || 0) - (a.added || 0))), byCo: Array.from(byCo.values()).sort((a, b) => b.cards - a.cards)};
  }
  function gradingResultsHTML() {
    const g = gradingResults();
    if (!g.rows.length) return "";
    const sign = v => (v >= 0 ? "+" : "−") + usd(Math.abs(v));
    const mid = list => { const s = list.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
    return '<div class="box" style="margin-bottom:16px"><div class="box-head"><h3>Your grading results</h3><span class="small">' + plural(g.rows.reduce((n, x) => n + x.r.qty, 0), "graded card") + "</span></div>" +
      '<div class="table-wrap"><table class="table stack-table gr-cos"><thead><tr><th>Company</th><th class="num">Cards</th><th>Grades</th><th class="num">Spent grading</th><th class="num">Value added</th><th class="num">After costs</th><th class="num">Turnaround</th></tr></thead><tbody>' +
      g.byCo.map(c => "<tr><td><b>" + esc(c.co) + '</b></td><td class="num" data-label="Cards">' + c.cards + '</td><td data-label="Grades">' +
        esc([c.tens ? c.tens + " × 10" : "", c.nines ? c.nines + " × 9–9.5" : "", c.lower ? c.lower + " lower" : ""].filter(Boolean).join(", ")) + "</td>" +
        '<td class="num" data-label="Spent grading"' + (c.costed ? "" : " data-empty") + ">" + (c.costed ? esc(usd(c.spent)) + (c.costed < c.cards ? '<span class="cell-sub">' + c.costed + " of " + c.cards + " cards</span>" : "") : "") + "</td>" +
        '<td class="num" data-label="Value added"' + (c.valued ? "" : " data-empty") + ">" + (c.valued ? changeHTML(c.added, null, true) + (c.est ? '<span class="cell-sub">' + c.est + " estimated</span>" : "") : "") + "</td>" +
        '<td class="num" data-label="After costs"' + (c.netCards ? "" : " data-empty") + ">" + (c.netCards ? changeHTML(c.net, null, true) : "") + "</td>" +
        '<td class="num" data-label="Turnaround"' + (c.days.length ? "" : " data-empty") + ">" + (c.days.length ? mid(c.days) + " days" : "") + "</td></tr>").join("") + "</tbody></table></div>" +
      '<details class="more" style="margin-top:8px"><summary>Card by card</summary><div class="table-wrap"><table class="table stack-table gr-cards"><thead><tr><th class="c-thumb"><span class="sr">Image</span></th><th>Card</th>' +
        '<th class="num">Raw now</th><th class="num">Graded now</th><th class="num">Grading cost</th><th class="num">Gain</th></tr></thead><tbody>' +
        g.rows.map(x => "<tr><td class=\"c-thumb\">" + miniThumb(x.r) + '</td><td><button type="button" class="cell-name" data-open="' + esc(x.r.id) + '">' + esc(x.r.name) + '</button><span class="cell-sub">' +
          esc(gradeLabel(x.r.grade) + (x.r.qty > 1 ? ", " + x.r.qty + " copies" : "") + (x.r.gradeResult && x.r.gradeResult.back ? ", back " + fmtDate(parseDay(x.r.gradeResult.back)) : "") +
            (x.r.gradeResult && x.r.gradeResult.raw != null ? "; raw " + usd(x.r.gradeResult.raw) + " when sent" : "")) + "</span></td>" +
          '<td class="num" data-label="Raw now"' + (x.raw == null ? " data-empty" : "") + ">" + esc(x.raw == null ? "" : usd(x.raw)) + "</td>" +
          '<td class="num" data-label="Graded now"' + (x.gv ? "" : " data-empty") + ">" + (x.gv ? esc(usd(x.gv.unit)) + '<span class="cell-sub">' + esc(x.gv.from === "yours" ? "your value" : x.gv.from === "pricecharting" ? "PriceCharting" : "estimate") + "</span>" : "") + "</td>" +
          '<td class="num" data-label="Grading cost"' + (x.cost == null ? " data-empty" : "") + ">" + esc(x.cost == null ? "" : usd(x.cost)) + "</td>" +
          '<td class="num" data-label="Gain"' + (x.added == null ? " data-empty" : "") + ">" + (x.added == null ? "" : x.net != null ? esc(sign(x.net)) + '<span class="cell-sub">after the cost</span>' : esc(sign(x.added)) + '<span class="cell-sub">before costs</span>') + "</td></tr>").join("") +
        "</tbody></table></div></details>" +
      '<p class="small" style="margin:8px 0 0">Value added is what each graded card is worth now (the graded value you entered, PriceCharting\'s sales at its grade, or the estimate from Settings) minus the raw card\'s market price now. ' +
      "Costs and turnaround are kept for cards you mark \"I sent it\" and then \"It's back\" in Card Vault.</p></div>";
  }
  function renderWorthGrading() {
    const el = insightBody();
    const away = collection.filter(r => r.grading);
    const min = gradingMinGain();
    const co = gradingCoNow(), fee = gradingFee(co), cost = gradingCostFor(co), inPlan = new Set(planIds());
    const list = collection.filter(r => !r.grading && /^near mint/i.test(r.condition || "Near Mint"))
      .map(r => ({r, e: gradingEstimate(r)})).filter(x => x.e && x.e.gain10 >= min).sort((a, b) => b.e.gain10 - a.e.gain10);
    const estimates = list.filter(x => x.e.ten.from === "estimate").length;
    const sign = v => (v >= 0 ? "+" : "−") + usd(Math.abs(v));
    el.innerHTML = (away.length ? '<div class="box" style="margin-bottom:16px"><div class="box-head"><h3>At the grader</h3><span class="small">' + plural(away.length, "card") + "</span></div>" +
      '<ul class="away-list">' + away.map(r => {
        const days = Math.max(0, Math.round((Date.now() - (parseDay(r.grading.sent) || new Date()).getTime()) / 86400000));
        return "<li>" + miniThumb(r) + '<span><button type="button" class="cell-name" data-open="' + esc(r.id) + '">' + esc(r.name) + '</button><span class="cell-sub">' +
          esc(r.grading.company) + (r.grading.level ? " " + esc(r.grading.level) : "") + ", sent " + esc(fmtDate(parseDay(r.grading.sent))) + " (" + plural(days, "day") + " ago)" + (r.grading.order ? ", order " + esc(r.grading.order) : "") +
          (backText(r.grading) ? ". " + (expectedBack(r.grading).late ? '<b class="late">' + esc(backText(r.grading).replace(/^d/, "D")) + "</b>" : esc(backText(r.grading).replace(/^b/, "B"))) : "") +
          '</span></span><button type="button" class="btn btn-small" data-grade-back="' + esc(r.id) + '">It\'s back</button></li>';
      }).join("") + "</ul></div>" : "") + gradingResultsHTML() +
      '<div class="wg-controls"><label class="basis">Grading with <select class="select" id="wgCo">' +
        GRADING_COS.map(c => '<option value="' + c.id + '"' + (c.id === co ? " selected" : "") + ">" + esc(c.name) + "</option>").join("") + "</select></label>" +
      '<label class="basis">Cost per card <span class="pct">$<input class="input" id="wgCost" type="number" min="0" step="1" value="' + cost + '"></span></label>' +
      '<label class="basis">Show cards that gain at least <input class="input" id="wgMin" type="number" step="5" value="' + min + '"> at a 10</label></div>' +
      '<p class="small wg-fee">' + (fee ? esc(gradingCoName(co)) + (fee.level ? ", " + esc(fee.level) : "") + ": " + esc(usd(fee.fee)) + " fee" + (fee.ship ? " + " + esc(usd(fee.ship)) + " shipping" : "") + " per card" +
          (fee.builtin ? " from their price list (" + esc(feeCheckedText(co)) + (fee.info && fee.info.days ? "; about " + esc(fee.info.days) + " business days" : "") + ")" : "") + ". "
        : "No fees for " + esc(gradingCoName(co)) + " yet: this is your general estimate. ") +
        '<button type="button" class="link-btn" data-wg-fees>' + (fee && !fee.builtin ? "Edit grading fees" : "Choose a service level") + "</button></p>" +
      (!list.length ? '<div class="notice">No ungraded Near Mint card gains ' + esc(usd(min)) + " or more at a PSA 10 after " + esc(usd(cost)) + " in grading costs. Try a lower amount.</div>"
      : '<div class="wg-plan-bar"><button type="button" class="btn btn-small btn-primary" data-wg-plan>' + esc(planButtonText()) + "</button>" +
        '<button type="button" class="btn btn-small" data-wg-top>Add the top 10</button><span class="small">Tick cards to see what sending them costs at each company.</span></div>' +
        '<div class="table-wrap"><table class="table stack-table wg-table"><thead><tr><th class="c-pick"><span class="sr">In the grading plan</span></th><th class="c-thumb"><span class="sr">Image</span></th><th>Card</th><th class="num">Raw</th><th class="num">PSA 10</th>' +
        '<th class="num">If it gets a 10</th><th class="num">If it gets a 9</th><th><span class="sr">Actions</span></th></tr></thead><tbody>' +
        list.slice(0, 100).map(({r, e}) => '<tr><td class="c-pick"><input type="checkbox" class="check" data-wg-pick="' + esc(r.id) + '" aria-label="Add ' + esc(r.name) + ' to the grading plan"' +
          (inPlan.has(r.id) ? " checked" : "") + '></td><td class="c-thumb"><span class="sleeve">' + imgTag(recordPics(r, "200w"), r.name) + "</span></td>" +
          '<td><button type="button" class="cell-name" data-open="' + esc(r.id) + '">' + esc(r.name) + '</button><span class="cell-sub">' + esc([r.number, r.rarity, r.edition].filter(Boolean).join(", ")) +
          (r.qty > 1 ? ". You have " + r.qty : "") + "</span></td>" +
          '<td class="num" data-label="Raw">' + esc(usd(e.raw)) + '</td><td class="num" data-label="PSA 10">' + esc(usd(e.ten.unit)) + '<span class="cell-sub">' + tenSource(e.ten) + "</span></td>" +
          '<td class="num" data-label="If it gets a 10"><b>' + esc(sign(e.gain10)) + '</b></td><td class="num" data-label="If it gets a 9">' + esc(sign(e.gain9)) + "</td>" +
          '<td><button type="button" class="btn btn-small" data-grade-it="' + esc(r.id) + '">Grade it…</button></td></tr>').join("") + "</tbody></table></div>" +
        (list.length > 100 ? '<p class="small">Showing the top 100 of ' + list.length + ".</p>" : "")) +
      '<p class="small" style="margin-top:12px">"If it gets a 10" is the PSA 10 value minus the raw price and the grading cost at ' + esc(gradingCoName(co)) + '; a 9 counts at ' +
      Math.round((gradeShare("9") || 0.3) * 100) + "% of a 10 (Settings &gt; Graded values). Played cards and cards already graded are left out." +
      (estimates ? " " + plural(estimates, "PSA 10 value is an estimate", "PSA 10 values are estimates") + " (raw × " + esc(String(num(settings.psa10Mult) == null ? 4 : num(settings.psa10Mult))) +
        " + " + esc(usd(num(settings.psa10Floor) == null ? 25 : num(settings.psa10Floor))) + "); a PriceCharting key in Settings gives real sold prices." : "") + "</p>";
  }

  // ----- Tidy up: entries with no price, the same card in two entries, a missing printing or location, cards not linked to TCGplayer
  const dupKey = r => [r.productId ? "p" + r.productId : "n" + String(r.name).toLowerCase() + "|" + normNumber(r.number) + "|" + String(r.rarity || "").toLowerCase(), r.edition, r.condition, r.language,
    String(r.location || "").trim().toLowerCase(), r.sealed ? 1 : 0].join("|");
  function tidyData() {
    const groups = new Map();
    for (const r of collection) {
      if (r.grade || r.grading) continue;
      const k = dupKey(r);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    const product = r => catalog && r.productId ? catalog.byId.get(r.productId) : null;
    const dups = Array.from(groups.values()).filter(g => g.length > 1);
    return {
      noPrice: collection.filter(r => marketValue(r).unit == null),
      dups, mergeable: dups.filter(canMerge),
      noEdition: collection.filter(r => !r.sealed && !r.edition && product(r) && printingsFor(product(r)).some(k => k !== "Normal")),
      unlinked: collection.filter(r => !r.productId && !r.sealed && !isOcg(r)),
      noLocation: collection.some(r => r.location) ? collection.filter(r => !r.location) : []
    };
  }
  function tidyListHTML(list, extra) {
    const shown = list.slice(0, 12);
    return '<ul class="away-list">' + shown.map(r => "<li>" + miniThumb(r) + '<span><button type="button" class="cell-name" data-open="' + esc(r.id) + '">' + esc(r.name) + '</button><span class="cell-sub">' +
      esc([r.setName, r.number, r.edition, r.condition !== "Near Mint" ? r.condition : "", r.location].filter(Boolean).join(", ")) + (r.qty > 1 ? " (×" + r.qty + ")" : "") + "</span></span>" +
      (extra ? extra(r) : "") + "</li>").join("") + "</ul>" + (list.length > shown.length ? '<p class="small">And ' + (list.length - shown.length) + " more.</p>" : "");
  }
  function renderTidy() {
    const el = insightBody();
    if (!collection.length) { el.innerHTML = emptyPanel("Nothing to tidy", "Add cards and Card Vault points out entries that need a look."); return; }
    const t = tidyData();
    const box = (title, why, body, actions) => '<div class="box tidy-box"><div class="box-head"><h3>' + title + "</h3>" + (actions || "") + '</div><p class="small" style="margin:0 0 6px">' + why + "</p>" + body + "</div>";
    const parts = [];
    if (t.dups.length) {
      const held = t.dups.length - t.mergeable.length;
      parts.push(box("The same card in two entries (" + t.dups.length + ")", "Same printing, condition, language and location, kept as separate entries. Merging adds up the copies." +
        (held ? " " + (held === 1 ? "One of them has" : held + " of them have") + " a different price paid or your own value on each entry, so open " + (held === 1 ? "it" : "them") + " to merge by hand." : ""),
        tidyListHTML(t.dups.map(g => g[0]), r => '<span class="small">' + plural(t.dups.find(g => g[0] === r).length, "entry", "entries") +
          (canMerge(t.dups.find(g => g[0] === r)) ? "" : ", details differ") + "</span>"),
        t.mergeable.length ? '<button type="button" class="btn btn-small" data-tidy="merge">Merge ' + (held ? "the " + t.mergeable.length : "them") + "</button>" : ""));
    }
    if (t.noEdition.length) {
      const single = t.noEdition.filter(r => printingsFor(catalog.byId.get(r.productId)).filter(k => k !== "Normal").length === 1);
      parts.push(box("No printing (" + t.noEdition.length + ")", "1st Edition and Unlimited copies can have very different prices. Pick the printing so the right one counts.",
        tidyListHTML(t.noEdition, r => '<select class="select" data-tidy-ed="' + esc(r.id) + '" aria-label="Printing of ' + esc(r.name) + '">' +
          options(printingsFor(catalog.byId.get(r.productId)).filter(k => k !== "Normal"), "", "Choose…") + "</select>"),
        single.length ? '<button type="button" class="btn btn-small" data-tidy="edition">Fill in the ' + plural(single.length, "card") + " with only one printing</button>" : ""));
    }
    if (t.noPrice.length) parts.push(box("No price (" + t.noPrice.length + ")", "These count as $0. Open one to link it to a TCGplayer printing or enter your own estimate.", tidyListHTML(t.noPrice)));
    if (t.unlinked.length) parts.push(box("Not linked to TCGplayer (" + t.unlinked.length + ")", "Added by hand, so there's no TCGplayer photo or price. Card Vault can link the ones whose card number and rarity match exactly one printing.",
      tidyListHTML(t.unlinked), catalog ? '<button type="button" class="btn btn-small" data-tidy="link">Link automatically</button>' : ""));
    if (t.noLocation.length) parts.push(box("No location (" + t.noLocation.length + ")", "Everything else has a binder or box. Give these one too.",
      tidyListHTML(t.noLocation), '<button type="button" class="btn btn-small" data-tidy="move">Move them…</button>'));
    el.innerHTML = parts.length ? parts.join("") : '<div class="notice"><strong>All tidy.</strong> Every card has a price, a printing and ' + (collection.some(r => r.location) ? "a location" : "one entry") + ", and nothing is entered twice.</div>";
  }
  // Entries merge only when nothing would be lost or made up: the same price paid (known for all copies or for none),
  // and the same own estimate, photo, PSA 10 value and Japan/Korea prices where both have one.
  const MERGE_FIELDS = ["manualPrice", "customImage", "g10", "jp", "kr"];
  function canMerge(g) {
    const paidKnown = g.filter(r => r.paid != null).length;
    if (paidKnown && paidKnown < g.length) return false;
    return MERGE_FIELDS.every(f => new Set(g.map(r => r[f]).filter(v => v != null && v !== "")).size <= 1);
  }
  function mergeDuplicates() {
    const t = tidyData();
    if (!t.mergeable.length) return;
    const before = collection.map(r => Object.assign({}, r));
    const gone = new Set();
    let merged = 0;
    for (const g of t.mergeable) {
      const keep = g[0];
      for (const r of g.slice(1)) {
        if (r.paid != null && keep.paid != null) keep.paid = round2((keep.paid * keep.qty + r.paid * r.qty) / (keep.qty + r.qty));
        for (const f of MERGE_FIELDS.concat(["snap", "sku"])) if ((keep[f] == null || keep[f] === "") && r[f] != null && r[f] !== "") keep[f] = r[f];
        keep.qty += r.qty;
        if (r.notes && !keep.notes.includes(r.notes)) keep.notes = (keep.notes ? keep.notes + " " : "") + r.notes;
        if (r.added < keep.added) keep.added = r.added;
        gone.add(r.id);
        merged++;
      }
    }
    collection = collection.filter(r => !gone.has(r.id));
    gone.forEach(id => selected.delete(id));
    save(); render();
    toast("Merged " + plural(merged, "entry", "entries") + " into the matching ones.", {action: "Undo", onAction: () => { collection = before; save(); render(); }});
  }
  function fillSingleEditions() {
    const t = tidyData();
    let n = 0;
    for (const r of t.noEdition) {
      const eds = printingsFor(catalog.byId.get(r.productId)).filter(k => k !== "Normal");
      if (eds.length === 1) { r.edition = eds[0]; n++; }
    }
    if (n) { save(); render(); toast("Filled in the printing of " + plural(n, "card") + "."); }
  }
  function wireInsights(panel) {
    panel.addEventListener("click", e => {
      if (settings.tab !== "history") return;
      const v = e.target.closest("[data-insight]");
      if (v) { settings.insightView = v.dataset.insight; saveSettings(); renderInsights(); const b = document.querySelector('[data-insight="' + v.dataset.insight + '"]'); if (b) b.focus(); return; }
      const back = e.target.closest("[data-grade-back]");
      if (back) { openDetails(back.dataset.gradeBack, {grading: "back"}); return; }
      const g = e.target.closest("[data-grade-it]");
      if (g) { openDetails(g.dataset.gradeIt, {grading: "start"}); return; }
      if (e.target.closest("[data-wg-fees]")) { openSettings({section: "gradingFees"}); return; }
      if (e.target.closest("[data-wg-plan]")) { openGradePlan(); return; }
      if (e.target.closest("[data-wg-top]")) {
        const top = collection.filter(r => !r.grading && /^near mint/i.test(r.condition || "Near Mint")).map(r => ({r, e: gradingEstimate(r)}))
          .filter(x => x.e && x.e.gain10 >= gradingMinGain()).sort((a, b) => b.e.gain10 - a.e.gain10).slice(0, 10).map(x => x.r.id);
        setPlanIds(planIds().concat(top)); renderWorthGrading(); return;
      }
      const td = e.target.closest("[data-tidy]");
      if (td) {
        const a = td.dataset.tidy;
        if (a === "merge") mergeDuplicates();
        else if (a === "edition") fillSingleEditions();
        else if (a === "link") { const n = autoLink(); if (n) { save(); render(); } toast(n ? "Linked " + plural(n, "card") + " to TCGplayer." : "None of them match exactly one TCGplayer printing. Open a card to pick its printing."); }
        else if (a === "move") openMove(tidyData().noLocation.map(r => r.id));
      }
    });
    panel.addEventListener("change", e => {
      if (settings.tab !== "history") return;
      const ed = e.target.closest("[data-tidy-ed]");
      if (ed && ed.value) { const r = collection.find(x => x.id === ed.dataset.tidyEd); if (r) { r.edition = ed.value; save(); render(); toast("Saved " + r.name + " as " + ed.value + "."); } return; }
      const pick = e.target.closest("[data-wg-pick]");
      if (pick) { togglePlan(pick.dataset.wgPick, pick.checked); const b = document.querySelector("[data-wg-plan]"); if (b) b.textContent = planButtonText(); return; }
      if (e.target.id === "wgCost" || e.target.id === "wgMin" || e.target.id === "wgCo") {
        const v = num(e.target.value);
        if (e.target.id === "wgCo") settings.gradingCo = e.target.value;
        else if (e.target.id === "wgMin") settings.gradingMin = v == null ? 50 : v;
        else {   // the cost per card at this company: its fee, keeping the shipping you entered
          const co = gradingCoNow(), f = Object.assign({level: "", fee: null, ship: null}, (settings.gradingFees || {})[co]);
          f.fee = v == null ? null : Math.max(0, round2(v - (num(f.ship) || 0)));
          settings.gradingFees = cleanGradingFees(Object.assign({}, settings.gradingFees, {[co]: f}));
        }
        saveSettings(); save({quiet: true}); renderWorthGrading();
        const again = $(e.target.id); if (again) again.focus();
      }
    });
  }


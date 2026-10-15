  /* ======================= Getting a card graded ======================= */
  // Each company's own pages: the "start a submission" link needs an account there. Their fees are built in below
  // (as of the day they were checked) and linked, since they change often.
  const GRADING_COS = [
    {id: "PSA", name: "PSA", start: "https://www.psacard.com/startsubmission", prices: "https://www.psacard.com/services/tradingcardgrading"},
    {id: "BGS", name: "Beckett (BGS)", start: "https://beckett.jotform.com/form/beckett-card-grading-submission", prices: "https://www.beckett.com/grading"},
    {id: "CGC", name: "CGC Cards", start: "https://www.cgcgrading.com/submit/services/", prices: "https://www.cgcgrading.com/submit/services/"},
    {id: "SGC", name: "SGC", start: "https://gosgc.com/card-grading", prices: "https://gosgc.com/card-grading/services-pricing"},
    {id: "TAG", name: "TAG", start: "https://my.taggrading.com/", prices: "https://taggrading.com/pages/pricing"}
  ];
  // Each company's public price list for standard-size cards, as read on their own site on the "checked" day. The
  // nightly update reads their pages again (grading_fees.py) and feeTable() puts that on top of this list.
  // Settings > Grading fees offers these levels; a fee you type yourself always wins. Per level: fee in US$ per card
  // (null when the company isn't posting it), max = the highest declared value it takes, days = business days
  // (the company's estimate), paused = not taking cards when checked (its last posted price is kept), min = the
  // fewest cards in an order, pct = plus this % of the card's value, per10k = plus this for each $10,000 over
  // $100,000, usual = what Card Vault assumes for that company until you choose a level.
  const GRADING_FEE_TABLE = {
    PSA: {checked: "2026-10-08", source: "https://www.psacard.com/services/tradingcardgrading",
      note: "The Value levels need a Collectors Club membership; while they're paused, their last posted prices (February 2026) are kept here.",
      levels: [
        {name: "Value Bulk", fee: 24.99, max: 500, days: "", paused: true, min: 20, note: "Collectors Club members only"},
        {name: "Value", fee: 32.99, max: 500, days: "", paused: true},
        {name: "Value Plus", fee: 49.99, max: 500, days: "45", paused: true},
        {name: "Value Max", fee: 64.99, max: 1000, days: "35", paused: true},
        {name: "Standard", fee: 59.99, max: 1000, days: "90–100", usual: true},
        {name: "Priority", fee: 79.99, max: 1500, days: "70–80"},
        {name: "Express", fee: 199, max: 2500, days: "20–30"},
        {name: "Super Express", fee: 349, max: 5000, days: "10–15"},
        {name: "Premier", fee: 599, max: 10000, days: "7–10"}]},
    BGS: {checked: "2026-10-08", source: "https://www.beckett.com/grading",
      note: "Beckett.com is offline for maintenance, so submissions go through a temporary form. Subgrades are included; a card that grades a 10 costs $3 more, an autograph $5 more. Return insurance is $1.50 per $100 of declared value (count it as shipping).",
      levels: [
        {name: "Base", fee: 17.95, max: null, days: "75", paused: true},
        {name: "Standard", fee: 34.95, max: null, days: "45", paused: true},
        {name: "Express", fee: 79.95, max: null, days: "15", usual: true},
        {name: "Priority", fee: 124.95, max: null, days: "5", paused: true}]},
    CGC: {checked: "2026-10-08", source: "https://www.cgcgrading.com/submit/services/",
      note: "No membership needed; CGC's paid memberships take 10 to 20% off.",
      levels: [
        {name: "Bulk Economy", fee: 17, max: 500, days: "150", min: 25},
        {name: "Economy", fee: 20, max: 500, days: "90", usual: true},
        {name: "Standard", fee: 55, max: 3000, days: "10"},
        {name: "Express", fee: 100, max: 10000, days: "5"},
        {name: "WalkThrough", fee: 300, max: 100000, days: "2"},
        {name: "Unlimited Value", fee: 300, max: null, days: "2", pct: 1}]},
    SGC: {checked: "2026-10-08", source: "https://gosgc.com/card-grading/services-pricing",
      note: "No membership or minimum. Prices went up on September 2, 2026, and SGC says to expect more changes into early 2027. The fee depends on the card's declared value.",
      levels: [
        {name: "Standard (to $1,500)", fee: 50, max: 1500, days: "40+", usual: true},
        {name: "Standard (to $3,500)", fee: 85, max: 3500, days: "40+"},
        {name: "Expedited (to $3,500)", fee: 150, max: 3500, days: "2–3"},
        {name: "Expedited (to $7,500)", fee: 250, max: 7500, days: "2–3"},
        {name: "Expedited (to $20,000)", fee: 500, max: 20000, days: "2–3"},
        {name: "Expedited (to $50,000)", fee: 1000, max: 50000, days: "2–3"},
        {name: "Expedited (to $100,000)", fee: 2000, max: 100000, days: "2–3"},
        {name: "Expedited (over $100,000)", fee: 3750, max: null, days: "2–3", per10k: 375}]},
    TAG: {checked: "2026-10-08", source: "https://taggrading.com/pages/pricing",
      note: "TAG doesn't show a level's price while it's at capacity. Priority and Walkthrough have limited slots.",
      levels: [
        {name: "Basic", fee: null, max: 300, days: "75+", paused: true},
        {name: "Standard", fee: null, max: 500, days: "45", paused: true},
        {name: "Express", fee: null, max: 1500, days: "25", paused: true},
        {name: "Priority", fee: 149, max: 2500, days: "5", usual: true},
        {name: "Walkthrough", fee: 299, max: 5000, days: "2–3"}]}
  };
  // A company's price list as Card Vault uses it: the built-in one, with what the nightly update read from the
  // company's own page on top (newer fees, levels pausing or reopening, new levels). auto: from the nightly read;
  // checked: the day it was last read; error: why last night's read didn't work (the list is then the last good one).
  let feeTables = null;
  const levelKey = name => String(name || "").toLowerCase().replace(/[^a-z0-9$]+/g, " ").trim();
  function feeTable(co) {
    if (!feeTables) feeTables = {};
    if (feeTables[co]) return feeTables[co];
    const base = GRADING_FEE_TABLE[co];
    if (!base) return null;
    const t = {checked: base.checked, source: base.source, note: base.note, levels: base.levels.map(l => Object.assign({}, l)), auto: false, error: ""};
    const lc = live.fees && live.fees.companies ? live.fees.companies[co] : null;
    const lastOk = lc && typeof lc.lastOk === "string" ? lc.lastOk.slice(0, 10) : "";
    if (lc && Array.isArray(lc.levels) && lc.levels.length && lastOk >= base.checked) {
      const byKey = new Map(t.levels.map(l => [levelKey(l.name), l])), seen = new Set();
      for (const f of lc.levels) {
        if (!f || !f.name) continue;
        const k = levelKey(f.name), fee = num(f.fee), max = num(f.max);
        seen.add(k);
        let l = byKey.get(k);
        if (!l) { l = {name: String(f.name).slice(0, 60), fee: null, max: null, days: "", isNew: true}; t.levels.push(l); byKey.set(k, l); }
        if (fee != null) l.fee = fee;            // (a paused level keeps its last price)
        if (max != null) l.max = max; else if (!f.paused && l.isNew) l.max = null;
        if (f.days) l.days = String(f.days).slice(0, 20);
        l.paused = !!f.paused;
        if (num(f.min)) l.min = num(f.min);
        if (num(f.pct)) l.pct = num(f.pct);
        if (f.note && l.isNew) l.note = String(f.note).slice(0, 120);
      }
      // (a list of only what's open, like Beckett's form: what isn't on it is paused)
      if (lc.complete) for (const l of t.levels) if (!seen.has(levelKey(l.name))) l.paused = true;
      t.auto = true;
      t.archived = lc.via === "archive";   // (PSA turns GitHub away: read from the Internet Archive's copy of its page)
      t.checked = lastOk;
      t.error = lc.ok ? "" : String(lc.error || "couldn't read it");
    }
    feeTables[co] = t;
    return t;
  }
  const gradingLevels = co => (feeTable(co) || {levels: []}).levels;
  const gradingLevel = (co, name) => gradingLevels(co).find(l => l.name === name) || gradingLevels(co).find(l => levelKey(l.name) === levelKey(name)) || null;
  // The level assumed until you choose one: the usual one while it's open, else the cheapest open one.
  const gradingUsual = co => {
    const ls = gradingLevels(co), open = ls.filter(l => !l.paused && l.fee != null);
    return open.find(l => l.usual) || open.slice().sort((a, b) => a.fee - b.fee)[0] || ls.find(l => l.usual && l.fee != null) || null;
  };
  const feeCheckedText = co => feeTable(co) ? "checked " + fmtDate(parseDay(feeTable(co).checked)) : "";
  const usdFee = v => v == null ? "" : Number.isInteger(v) ? "$" + v.toLocaleString("en-US") : usd(v);
  // What a level costs for a card declared at this value (CGC's Unlimited Value adds 1%, SGC's top band $375 per $10,000)
  function levelFee(l, value) {
    if (!l || l.fee == null) return null;
    let fee = l.fee;
    const v = num(value) || 0;
    if (l.pct) fee += v * l.pct / 100;
    if (l.per10k && v > 100000) fee += Math.ceil((v - 100000) / 10000) * l.per10k;
    return round2(fee);
  }
  // For the pick-list: "Standard — $59.99, 90–100 business days" (and "(paused)" or "price not posted")
  const levelLabel = l => l.name + " — " + (l.fee != null ? usdFee(l.fee) + (l.pct ? " + " + l.pct + "%" : "") : "price not posted") + (l.days ? ", " + l.days + " business days" : "") + (l.paused ? " (paused)" : "");
  // Under it: "cards up to $1,000 declared value, 90–100 business days, 20 cards or more"
  const levelDetails = l => [l.max != null ? "cards up to " + usdFee(l.max) + " declared value" : "", l.days ? l.days + " business days" : "",
    l.min ? l.min + " cards or more" : "", l.pct ? "plus " + l.pct + "% of the card's value" : "", l.per10k ? "plus " + usdFee(l.per10k) + " for each $10,000 over $100,000" : "",
    l.note || "", l.isNew ? "new since Card Vault's list" : ""].filter(Boolean).join(", ");
  function normGrading(g) {
    if (!g || typeof g !== "object" || !String(g.company || "").trim()) return null;
    const out = {company: String(g.company).trim(), sent: parseDay(g.sent) ? g.sent : localDay(new Date()), order: String(g.order || "").trim(), cost: g.cost === "" || g.cost == null ? null : num(g.cost)};
    // (the service level, and its wait in business days as the company gave it when the card went: "90–100", "40+")
    if (g.level) out.level = String(g.level).trim().slice(0, 60);
    if (g.days) out.days = String(g.days).trim().slice(0, 20);
    if (num(g.raw) != null && num(g.raw) >= 0) out.raw = round2(num(g.raw));   // (its raw market value when it went)
    return out;
  }
  // How a grading went, kept on the card when it's back: who graded it, the level, when it went and came back,
  // what it cost and what the raw card was worth when it went (Insights > Worth grading > Your grading results).
  function normGradeResult(x) {
    if (!x || typeof x !== "object" || !String(x.company || "").trim()) return null;
    const n = v => (v === "" || v == null || num(v) == null) ? null : round2(num(v));
    return {company: String(x.company).trim().slice(0, 40), level: String(x.level || "").slice(0, 60), sent: parseDay(x.sent) ? String(x.sent) : "",
      back: parseDay(x.back) ? String(x.back) : "", cost: n(x.cost), raw: n(x.raw)};
  }
  // The service levels to pick from when you send a card: its open levels (yours or the usual one first chosen)
  function levelOptionsHTML(co) {
    const f = gradingFee(co), chosen = f ? f.level : "";
    const levels = GRADING_COS.some(c => c.id === co) ? gradingLevels(co).filter(l => !l.paused || l.name === chosen) : [];
    return levels.map(l => '<option value="' + esc(l.name) + '"' + (l.name === chosen ? " selected" : "") + ">" + esc(levelLabel(l)) + "</option>").join("") +
      '<option value=""' + (!levels.some(l => l.name === chosen) ? " selected" : "") + ">" + (levels.length ? "Something else / not sure" : "Not sure") + "</option>";
  }
  // What a card costs at this level: your own fee when it's the level you use, else the price list's, plus your shipping
  function costForLevel(co, name) {
    const f = gradingFee(co);
    if (!name || (f && f.level === name)) return f ? f.total : gradingCostEach();
    const l = gradingLevel(co, name), ship = num(((settings.gradingFees || {})[co] || {}).ship) || 0;
    return l && l.fee != null ? round2(l.fee + ship) : gradingCostFor(co);
  }
  // ----- When a card at the grader should be back: the date it went, plus its level's wait in business days (the
  // longer end of "90–100"). Cards sent before Card Vault kept the level use the company's usual one.
  function addBusinessDays(day, n) {
    const d = parseDay(day) || new Date();
    let left = Math.max(0, Math.round(n));
    while (left > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) left--; }
    return d;
  }
  const waitDays = text => { const m = String(text || "").match(/(\d+)\s*(?:[–-]\s*(\d+))?/); return m ? +(m[2] || m[1]) : null; };
  function expectedBack(g) {
    if (!g) return null;
    const co = GRADING_COS.find(c => c.id === g.company || c.name === g.company);
    let days = g.days, guess = false;
    if (!days && co) { const l = (g.level && gradingLevel(co.id, g.level)) || gradingUsual(co.id); days = l ? l.days : ""; guess = !g.level; }
    const n = waitDays(days);
    if (n == null) return null;
    const by = addBusinessDays(g.sent, n), today = parseDay(localDay(new Date()));
    return {by, days, guess, late: today > by, left: Math.round((by - today) / 86400000)};
  }
  // "back around Feb 20" / "due back by Oct 20: 3 days late"
  function backText(g) {
    const e = expectedBack(g);
    if (!e) return "";
    if (e.late) { const over = Math.round((parseDay(localDay(new Date())) - e.by) / 86400000); return "due back by " + fmtDate(e.by) + ": " + plural(over, "day") + " late"; }
    return "back around " + fmtDate(e.by) + (e.guess ? " (if it went " + (g.company === "PSA" || g.company === "TAG" ? "" : "at ") + "their usual level)" : "");
  }
  // The notice at the top when a card is late back from the grader (once per card and due date, until dismissed)
  function lateAtGrader() {
    const seen = new Set(Array.isArray(settings.gradingSeen) ? settings.gradingSeen : []);
    return collection.filter(r => r.grading).map(r => ({r, e: expectedBack(r.grading)})).filter(x => x.e && x.e.late && !seen.has(x.r.id + "@" + localDay(x.e.by)));
  }
  function renderGradingBanner() {
    const b = $("gradingBanner");
    if (!b) return;
    const late = lateAtGrader();
    b.dataset.keys = late.map(x => x.r.id + "@" + localDay(x.e.by)).join(" ");
    b.hidden = !late.length;
    b.innerHTML = late.length ? "<strong>" + (late.length === 1 ? esc(late[0].r.name) + " is late back from " + esc(late[0].r.grading.company) + "."
        : plural(late.length, "card") + " are late back from the grader.") + "</strong> " +
      (late.length === 1 ? "It was due back by " + esc(fmtDate(late[0].e.by)) + " (" + esc(late[0].e.days) + " business days). " : "") +
      "Check the order on the company's site; they post delays there." +
      '<div class="banner-actions"><button class="btn btn-small btn-primary" type="button" data-banner="grading-show">Show ' + (late.length === 1 ? "it" : "them") + "</button>" +
      '<button class="btn btn-small" type="button" data-banner="grading-dismiss">Dismiss</button></div>' : "";
    syncBanners();
  }
  function dismissGradingBanner() {
    const keys = ($("gradingBanner").dataset.keys || "").split(" ").filter(Boolean);
    settings.gradingSeen = Array.from(new Set(keys.concat(Array.isArray(settings.gradingSeen) ? settings.gradingSeen : []))).slice(0, 300);
    saveSettings();
    renderGradingBanner();
  }
  // What the grading forms ask for, ready to paste.
  function gradingDetailsText(r) {
    const p = catalog && r.productId ? catalog.byId.get(r.productId) : null;
    const year = p && p.group.published ? p.group.published.slice(0, 4) : "";
    const mv = marketValue(r).unit;
    return ["Card: " + lookupName(r.name), "Game: Yu-Gi-Oh! (" + (r.language || "English") + ")", "Set: " + (r.setName || "") + (year ? " (" + year + ")" : ""),
      "Card number: " + (r.number || ""), "Rarity: " + (r.rarity || ""), "Printing: " + (r.edition || ""),
      mv != null ? "Value: " + usd(mv) + " (TCGplayer market" + (catalog ? ", " + fmtDate(catalog.generated) : "") + ")" : ""].filter(l => !/: $/.test(l)).join("\n");
  }
  function gradeItHTML(r, mode) {
    if (r.sealed) return "";
    if (r.grade && !r.grading) return '<p class="small">Graded ' + esc(gradeLabel(r.grade)) + (r.grade.cert ? ", certification " + esc(r.grade.cert) : "") + ".</p>";
    if (r.grading && mode !== "back") {
      const g = r.grading;
      return '<div class="grade-status"><b>At ' + esc(g.company) + "</b>" + (g.level ? " (" + esc(g.level) + ")" : "") + " since " + esc(fmtDate(parseDay(g.sent))) + (g.order ? ", order " + esc(g.order) : "") +
        (g.cost != null ? ", " + esc(usd(g.cost)) + " to grade" : "") + "." + (backText(g) ? " " + (expectedBack(g).late ? '<b class="late">' + esc(backText(g).replace(/^d/, "D")) + ".</b>" : esc(backText(g).replace(/^b/, "B")) + ".") : "") + '<div class="btn-row"><button type="button" class="btn btn-small btn-primary" data-gi="back">It\'s back</button>' +
        '<button type="button" class="btn btn-small" data-gi="unsend">I didn\'t send it after all</button></div></div>';
    }
    if (mode === "back") {
      const g = r.grading || {};
      return '<form class="stack" id="giBackForm"><p class="small" style="margin:0">Record the grade it got. It then counts at that grade in the PSA 10 view' + (g.cost != null && r.paid != null ? ", and the grading cost is added to what you paid" : "") + ".</p>" +
        '<div class="grid-2"><label class="field"><span>Graded by</span><select class="input" id="giCo">' + options(GRADERS, g.company || "PSA") + "</select></label>" +
        '<label class="field"><span>Grade</span><input class="input" id="giGrade" placeholder="e.g. 10 or 9.5" required></label></div>' +
        '<div class="grid-2"><label class="field"><span>Certification number</span><input class="input" id="giCert"></label>' +
        '<label class="field"><span>Graded value, if you know it (US$)</span><input class="input" id="giValue" type="number" min="0" step="0.01"></label></div>' +
        '<div class="btn-row"><button class="btn btn-primary" type="submit">Save the grade</button><button class="btn" type="button" data-gi="cancel">Cancel</button></div></form>';
    }
    if (mode === "sent") {
      return '<form class="stack" id="giSentForm"><p class="small" style="margin:0">' + (r.qty > 1 ? "One of your " + r.qty + " copies goes on its own line while it's away; the others stay as they are. " : "") +
        "Card Vault keeps it in your collection, marked as at the grader.</p>" +
        '<div class="grid-2"><label class="field"><span>Sent to</span><select class="input" id="giCo">' + options(GRADING_COS.map(c => c.id).concat(["Other"]), gradingCoNow()) + "</select></label>" +
        '<label class="field"><span>Date sent</span><input class="input" id="giSent" type="date" value="' + localDay(new Date()) + '"></label></div>' +
        '<label class="field"><span>Service level (for when it should be back)</span><select class="input" id="giLevel">' + levelOptionsHTML(gradingCoNow()) + "</select></label>" +
        '<div class="grid-2"><label class="field"><span>Order or submission number</span><input class="input" id="giOrder"></label>' +
        '<label class="field"><span>Cost for this card (US$)</span><input class="input" id="giCost" type="number" min="0" step="0.01" value="' + costForLevel(gradingCoNow(), (gradingFee(gradingCoNow()) || {}).level || "") + '"></label></div>' +
        '<div class="btn-row"><button class="btn btn-primary" type="submit">Mark as sent</button><button class="btn" type="button" data-gi="cancel">Cancel</button></div></form>';
    }
    const co = gradingCoNow(), e = gradingEstimate(r, co);
    const sign = v => (v >= 0 ? "+" : "−") + usd(Math.abs(v));
    const ownFees = GRADING_COS.some(c => { const f = gradingFee(c.id); return f && !f.builtin; });
    return (e ? '<p class="gi-math">Raw <b>' + esc(usd(e.raw)) + "</b>, PSA 10 <b>" + esc(usd(e.ten.unit)) + '</b> <span class="small">(' + tenSource(e.ten) + ")</span>. After " + esc(usd(e.cost)) +
        " to grade at " + esc(gradingCoName(co)) + ": <b>" + esc(sign(e.gain10)) + "</b> if it gets a 10, " + esc(sign(e.gain9)) + " at a 9.</p>" : "") +
      '<ul class="grader-list">' + GRADING_COS.map(c => {
        const f = gradingFee(c.id), ce = f && gradingEstimate(r, c.id);
        return '<li><span class="gl-co"><b>' + esc(c.name) + "</b>" + (f ? '<span class="small">' + esc((f.level ? f.level + ", " : "") + usd(f.total) + " per card") +
          (f.info && f.info.days ? ", " + esc(f.info.days) + " days" : "") + (ce ? ": " + esc(sign(ce.gain10)) + " at a 10" : "") + "</span>" : "") + "</span>" +
          '<a class="btn btn-small" target="_blank" rel="noopener" href="' + esc(c.start) + '">Start a submission</a>' +
          '<a class="small" target="_blank" rel="noopener" href="' + esc(c.prices) + '">Prices</a></li>';
      }).join("") + "</ul>" +
      '<div class="btn-row"><button type="button" class="btn btn-small" data-gi="copy">Copy card details for the form</button><button type="button" class="btn btn-small" data-gi="sent">I sent it…</button>' +
      '<button type="button" class="btn btn-small" data-gi="plan">' + (planIds().includes(r.id) ? "In your grading plan: open it" : "Add to a grading plan") + "</button></div>" +
      '<p class="small" style="margin:8px 0 0">Each link opens that company\'s site, where you sign in, choose a service and pay them. The fees are from their price lists (' +
      esc(feeCheckedText("PSA")) + ') and change often, so check their prices. <button type="button" class="link-btn" data-gi="fees">' + (ownFees ? "Edit your grading fees" : "Choose your service level at each company") + "</button></p>";
  }
  function wireGradeIt(id) {
    const box = $("gradeIt");
    if (!box) return;
    const cur = () => collection.find(x => x.id === id);
    const show = mode => { const r = cur(); if (r && $("gradeIt")) { $("gradeIt").innerHTML = gradeItHTML(r, mode); } };
    box.addEventListener("click", e => {
      const b = e.target.closest("[data-gi]");
      if (!b) return;
      const r = cur();
      if (!r) return;
      const a = b.dataset.gi;
      if (a === "copy") copyText(gradingDetailsText(r), () => toast("Copied the card's details. Paste them into the grading form."));
      else if (a === "fees") openSettings({section: "gradingFees"});
      else if (a === "plan") { if (!planIds().includes(r.id)) togglePlan(r.id, true); openGradePlan(); }
      else if (a === "sent" || a === "back") show(a);
      else if (a === "cancel") show("");
      else if (a === "unsend") { r.grading = null; save(); render(); show(""); toast("It's no longer marked as at the grader."); }
    });
    // (choosing the company fills in its cost, unless you've typed one)
    box.addEventListener("input", e => { if (e.target.id === "giCost") e.target.dataset.typed = "1"; });
    box.addEventListener("change", e => {
      const cost = $("giCost");
      if (e.target.id === "giCo" && $("giSentForm") && $("giLevel")) $("giLevel").innerHTML = levelOptionsHTML(e.target.value);
      if ((e.target.id === "giCo" || e.target.id === "giLevel") && $("giSentForm") && cost && !cost.dataset.typed) {
        const co = $("giCo").value;
        cost.value = GRADING_COS.some(c => c.id === co) ? costForLevel(co, $("giLevel") ? $("giLevel").value : "") : gradingCostEach();
      }
    });
    box.addEventListener("submit", e => {
      e.preventDefault();
      const r = cur();
      if (!r) return;
      if (e.target.id === "giSentForm") {
        const lvl = $("giLevel") && $("giLevel").value ? gradingLevel($("giCo").value, $("giLevel").value) : null;
        const g = normGrading({company: $("giCo").value, sent: $("giSent").value, order: $("giOrder").value, cost: $("giCost").value,
          level: lvl ? lvl.name : "", days: lvl ? lvl.days : "", raw: priceInfo(r).unit});
        let target = r;
        if (r.qty > 1) {   // one copy goes; the rest stay on their own line
          r.qty -= 1;
          target = upgradeRecord(Object.assign({}, r, {id: newId(), qty: 1, mod: 0}));
          collection.push(target);
        }
        target.grading = g;
        save(); render();
        toast("Marked " + r.name + " as sent to " + g.company + ".");
        openDetails(target.id, {grading: ""});
      } else if (e.target.id === "giBackForm") {
        const grade = normalizeGrade({company: $("giCo").value, grade: $("giGrade").value, cert: $("giCert").value, value: $("giValue").value});
        if (!grade || !grade.grade) { toast("Enter the grade it got.", {kind: "error"}); return; }
        const cost = r.grading && r.grading.cost;
        const was = r.grading || {};
        r.gradeResult = normGradeResult({company: grade.company, level: was.level, sent: was.sent, back: localDay(new Date()), cost: was.cost,
          raw: was.raw != null ? was.raw : priceInfo(r).unit});
        r.grade = grade;
        if (cost != null && r.paid != null) r.paid = round2(r.paid + cost);
        r.grading = null;
        save(); render();
        toast("Saved: " + r.name + " is a " + gradeLabel(grade) + ".");
        openDetails(r.id);
      }
    });
  }

  /* ======================= Planning a grading order ======================= */
  // Pick several cards (Insights > Worth grading, or a card's Get it graded) and see what sending them costs at each
  // company, which service level each card needs for its declared value (what it would be worth graded: the companies'
  // insurance and fee bands go by it), the wait, and what you'd gain if they all got a 10. Also the cheapest mix.
  // The cards and the values you type are kept on this device (settings.gradePlan, settings.gradePlanValues).
  const planButtonText = () => { const n = planIds().length; return n ? "Plan a grading order (" + plural(n, "card") + ")" : "Plan a grading order"; };
  const planIds = () => (Array.isArray(settings.gradePlan) ? settings.gradePlan : []).filter(id => collection.some(r => r.id === id && !r.grading && !r.grade && !r.sealed));
  function setPlanIds(ids) { settings.gradePlan = Array.from(new Set(ids)).slice(0, 200); saveSettings(); }
  function togglePlan(id, on) { const ids = planIds().filter(x => x !== id); if (on) ids.push(id); setPlanIds(ids); }
  // A card's declared value: what you typed, else its PSA 10 value, else its raw price
  function planValue(r) {
    const own = num((settings.gradePlanValues || {})[r.id]);
    if (own != null) return Math.max(0, own);
    const ten = psa10Value(r);
    return round2((ten && ten.unit) || marketValue(r).unit || 0);
  }
  // One company: each card at the cheapest open level that takes its declared value, then any level that needs more
  // cards than it got (CGC's Bulk Economy: 25) gives them up to the next cheapest. Your own fee for a company counts as
  // a level of its own (for the cards its level takes).
  function planCompany(co, cards) {
    const ship = num(((settings.gradingFees || {})[co] || {}).ship) || 0;
    const levels = gradingLevels(co).filter(l => !l.paused && l.fee != null).map(l => Object.assign({}, l));
    const own = gradingFee(co);
    if (own && !own.builtin) {
      // (a fee typed without a level takes what the company's usual level takes)
      const lv = own.info || (own.level ? gradingLevel(co, own.level) : null) || gradingUsual(co);
      levels.push({name: own.level || "your fee", fee: own.fee, max: lv ? lv.max : null, days: lv ? lv.days : "", own: true, min: lv && lv.min ? lv.min : null});
    }
    const choices = r => { const v = planValue(r); return levels.filter(l => l.max == null || l.max >= v).map(l => ({l, cost: round2((l.own ? l.fee : levelFee(l, v)) + ship)})).sort((a, b) => a.cost - b.cost || (a.l.own ? -1 : 1)); };
    const rows = cards.map(r => ({r, value: planValue(r), opts: choices(r), pick: 0}));
    for (let round = 0; round < 10; round++) {
      let moved = false;
      for (const l of levels.filter(x => x.min)) {
        const on = rows.filter(x => x.opts[x.pick] && x.opts[x.pick].l === l);
        if (on.length && on.length < l.min) for (const x of on) { x.opts = x.opts.filter(o => o.l !== l); x.pick = 0; moved = true; }
      }
      if (!moved) break;
    }
    const fit = rows.filter(x => x.opts.length), unfit = rows.filter(x => !x.opts.length).map(x => x.r);
    const lines = fit.map(x => {
      const o = x.opts[0], ten = psa10Value(x.r), raw = rawMarket(x.r);
      return {r: x.r, value: x.value, level: o.l, cost: o.cost, gain: ten && raw != null ? round2(ten.unit - raw - o.cost) : null};
    });
    const total = round2(lines.reduce((s, x) => s + x.cost, 0));
    const slowest = lines.reduce((m, x) => Math.max(m, waitDays(x.level.days) || 0), 0);
    return {co, lines, unfit, total, slowest, ship, gain: round2(lines.reduce((s, x) => s + (x.gain || 0), 0)), byLevel: groupBy(lines, x => x.level.name)};
  }
  const groupBy = (list, key) => { const m = new Map(); for (const x of list) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };
  // The cheapest mix: each card where it costs least, then each company's share planned again (minimums may move some)
  function planMix(cards) {
    const each = GRADING_COS.map(c => planCompany(c.id, cards));
    const best = new Map();
    for (const p of each) for (const x of p.lines) { const b = best.get(x.r.id); if (!b || x.cost < b.cost) best.set(x.r.id, {co: p.co, cost: x.cost}); }
    const plans = GRADING_COS.map(c => planCompany(c.id, cards.filter(r => (best.get(r.id) || {}).co === c.id))).filter(p => p.lines.length);
    return {plans, unfit: cards.filter(r => !best.has(r.id)), total: round2(plans.reduce((s, p) => s + p.total, 0)), gain: round2(plans.reduce((s, p) => s + p.gain, 0))};
  }
  function planLevelsText(p) {
    return Array.from(p.byLevel.entries()).map(([name, xs]) => plural(xs.length, "card") + " at " + name + (xs[0].level.own ? "" : " (" + usdFee(xs[0].level.fee) + (xs[0].level.pct ? " + " + xs[0].level.pct + "%" : "") + ")")).join(", ");
  }
  function planBackText(p) {
    if (!p.slowest) return "";
    return "back around " + fmtDate(addBusinessDays(localDay(new Date()), p.slowest)) + " if sent today";
  }
  function gradePlanHTML() {
    const cards = planIds().map(id => collection.find(r => r.id === id)).filter(Boolean);
    const sign = v => (v >= 0 ? "+" : "−") + usd(Math.abs(v));
    if (!cards.length) {
      return '<p>No cards in the plan yet. In Insights &gt; Worth grading, tick the cards you\'re thinking of sending (or tap "Add the top 10"), or use "Add to a grading plan" in a card\'s details.</p>';
    }
    const one = GRADING_COS.map(c => planCompany(c.id, cards)).sort((a, b) => (a.unfit.length - b.unfit.length) || (a.total - b.total));
    const mix = planMix(cards);
    const shipNote = GRADING_COS.some(c => num(((settings.gradingFees || {})[c.id] || {}).ship)) ? "" : " Shipping isn't counted: add yours in Settings &gt; Grading fees.";
    return '<div class="table-wrap"><table class="table stack-table gp-cards"><thead><tr><th>Card</th><th class="num">Raw</th><th class="num">PSA 10</th><th class="num">Declared value</th><th><span class="sr">Remove</span></th></tr></thead><tbody>' +
      cards.map(r => {
        const ten = psa10Value(r), raw = rawMarket(r), own = num((settings.gradePlanValues || {})[r.id]);
        return '<tr><td><button type="button" class="cell-name" data-open="' + esc(r.id) + '">' + esc(r.name) + '</button><span class="cell-sub">' + esc([r.number, r.rarity].filter(Boolean).join(", ")) + "</span></td>" +
          '<td class="num" data-label="Raw">' + esc(raw == null ? "" : usd(raw)) + '</td><td class="num" data-label="PSA 10">' + esc(ten ? usd(ten.unit) : "") + "</td>" +
          '<td class="num" data-label="Declared value"><span class="pct">$<input class="input" type="number" min="0" step="1" data-gp-value="' + esc(r.id) + '" value="' + esc(String(planValue(r))) + '"' + (own != null ? ' data-own="1"' : "") + "></span></td>" +
          '<td><button type="button" class="btn btn-small" data-gp-remove="' + esc(r.id) + '">Remove</button></td></tr>';
      }).join("") + "</tbody></table></div>" +
      '<div id="gpResults">' + gradePlanResultsHTML(one, mix, sign) + "</div>" +
      '<p class="small">Declared value is what the card would be worth graded (its PSA 10 value, unless you change it): each company\'s levels take cards up to a value, and insure them for it. ' +
      "Gains count a 10 from any company like a PSA 10, though PSA 10s usually sell for more. Fees are from each company's price list (" + esc(feeCheckedText("PSA")) + ")." + shipNote + "</p>" +
      '<div class="btn-row"><button type="button" class="btn btn-small" data-gp-copy>Copy the list</button><button type="button" class="btn btn-small" data-gp-clear>Empty the plan</button></div>';
  }
  function gradePlanResultsHTML(one, mix, sign) {
    const co = gradingCoNow();
    const orderHTML = (p, label) => '<div class="gp-order"><div class="gp-head"><b>' + esc(label || gradingCoName(p.co)) + "</b><span>" + esc(usd(p.total)) + "</span></div>" +
      '<p class="small">' + esc(planLevelsText(p)) + (p.ship ? ", " + esc(usd(p.ship)) + " shipping each" : "") + ". " + esc(planBackText(p).replace(/^b/, "B")) +
      (p.gain ? ". If they all get a 10: <b>" + esc(sign(p.gain)) + "</b>" : "") + ".</p>" +
      (p.unfit.length ? '<p class="small">Not taken here (declared value too high for every open level): ' + esc(p.unfit.map(r => r.name).join(", ")) + ".</p>" : "") +
      '<a class="btn btn-small" target="_blank" rel="noopener" href="' + esc((GRADING_COS.find(c => c.id === p.co) || {}).start || "#") + '">Start a submission at ' + esc(gradingCoName(p.co)) + "</a></div>";
    return "<h3>All at one company</h3>" +
      '<div class="table-wrap"><table class="table stack-table gp-compare"><thead><tr><th>Company</th><th class="num">Cost</th><th>Levels</th><th>Back around</th><th class="num">If all get a 10</th></tr></thead><tbody>' +
      one.map(p => "<tr" + (p.co === co ? ' class="gp-yours"' : "") + "><td><b>" + esc(gradingCoName(p.co)) + "</b>" + (p.co === co ? ' <span class="small">(yours)</span>' : "") + "</td>" +
        '<td class="num" data-label="Cost">' + esc(usd(p.total)) + (p.unfit.length ? '<span class="cell-sub">' + plural(p.unfit.length, "card") + " not taken</span>" : "") + "</td>" +
        '<td data-label="Levels">' + esc(planLevelsText(p) || "none open") + '</td><td data-label="Back around">' + esc(p.slowest ? fmtDate(addBusinessDays(localDay(new Date()), p.slowest)) : "") + "</td>" +
        '<td class="num" data-label="If all get a 10">' + esc(p.lines.length ? sign(p.gain) : "") + "</td></tr>").join("") + "</tbody></table></div>" +
      orderHTML(one[0], "Cheapest at one company: " + gradingCoName(one[0].co)) +
      (mix.plans.length > 1 && mix.total < one[0].total - 0.005 ? "<h3>Cheapest mix: " + esc(usd(mix.total)) + "</h3>" +
        '<p class="small">' + esc(usd(round2(one[0].total - mix.total))) + " less than all at " + esc(gradingCoName(one[0].co)) + ", as " + mix.plans.length + " separate orders (each with its own shipping).</p>" +
        mix.plans.map(p => orderHTML(p)).join("") : "");
  }
  function openGradePlan() {
    drawerCtx = {mode: "gradeplan"};
    openDrawer("Grading plan", '<div id="gpWrap">' + gradePlanHTML() + "</div>");
    $("drawer").classList.add("wide");
    const wrap = $("gpWrap");
    const redraw = () => { wrap.innerHTML = gradePlanHTML(); };
    wrap.addEventListener("click", e => {
      const rm = e.target.closest("[data-gp-remove]");
      if (rm) { togglePlan(rm.dataset.gpRemove, false); redraw(); if (settings.tab === "history") renderPanel(); return; }
      const op = e.target.closest("[data-open]");
      if (op) { openDetails(op.dataset.open); return; }
      if (e.target.closest("[data-gp-clear]")) { setPlanIds([]); redraw(); if (settings.tab === "history") renderPanel(); return; }
      if (e.target.closest("[data-gp-copy]")) {
        const cards = planIds().map(id => collection.find(r => r.id === id)).filter(Boolean);
        copyText(cards.map(r => [lookupName(r.name), r.setName, r.number, r.rarity, r.edition, "declared value " + usd(planValue(r))].filter(Boolean).join(" | ")).join("\n"),
          () => toast("Copied " + plural(cards.length, "card") + " with their declared values."));
      }
    });
    wrap.addEventListener("change", e => {
      const inp = e.target.closest("[data-gp-value]");
      if (!inp) return;
      const v = num(inp.value), vals = Object.assign({}, settings.gradePlanValues);
      if (v == null || inp.value === "") delete vals[inp.dataset.gpValue]; else vals[inp.dataset.gpValue] = Math.max(0, round2(v));
      settings.gradePlanValues = vals;
      saveSettings();
      const cards = planIds().map(id => collection.find(r => r.id === id)).filter(Boolean);
      const one = GRADING_COS.map(c => planCompany(c.id, cards)).sort((a, b) => (a.unfit.length - b.unfit.length) || (a.total - b.total));
      $("gpResults").innerHTML = gradePlanResultsHTML(one, planMix(cards), v2 => (v2 >= 0 ? "+" : "−") + usd(Math.abs(v2)));
    });
  }


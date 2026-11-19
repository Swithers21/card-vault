// Words too close in colour to what's behind them: every visible bit of text on the page (or in the open panel), its
// colour against the colours under it (gradients averaged; text over a picture is left out). For the light-theme test
// (test_look.py). Returns [{t: the words, r: contrast, need: 4.5 or 3 for big text, sel}] for the ones under.
(() => {
  const parse = c => { const m = /rgba?\(([^)]+)\)/.exec(c || ""); if (!m) return null; const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] == null ? 1 : p[3]]; };
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const over = (top, under) => { const a = top[3]; return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1]; };
  function behind(el) {
    const layers = [];
    let fade = 1;
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      fade *= +cs.opacity;
      const img = cs.backgroundImage;
      if (img && img !== "none") {
        const cols = (img.match(/rgba?\([^)]+\)/g) || []).map(parse);
        if (/url\(/.test(img) && !/^(BODY|HTML)$/.test(e.tagName)) return null;          // (a picture)
        if (cols.length) layers.push(cols.reduce((t, c) => t.map((v, i) => v + c[i] / cols.length), [0, 0, 0, 0]));
      }
      const bc = parse(cs.backgroundColor);
      if (bc && bc[3] > 0) layers.push(bc);
      if (e.tagName === "IMG") return null;
    }
    let col = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) col = over(layers[i], col);
    return {col, fade};
  }
  const roots = [...document.querySelectorAll("#drawer:not([hidden]) #drawerBody, #drawer:not([hidden]) .drawer-head")];
  const scope = roots.length && !document.body.classList.contains("docked") ? roots : [document.body];
  const out = [], seen = new Set();
  for (const root of scope) for (const el of root.querySelectorAll("*")) {
    if (!/\S/.test([...el.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join(""))) continue;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === "hidden" || r.bottom < 0 || r.top > innerHeight * 3) continue;
    if (cs.webkitBackgroundClip === "text" || cs.backgroundClip === "text") continue;   // (gold lettering: the colour is its own background)
    if (el.closest("[disabled], .card-ph, .sleeve, .mini, svg, #report, .sr-only, .visually-hidden")) continue;
    if (cs.clip === "rect(0px, 0px, 0px, 0px)" || (r.width <= 1 && r.height <= 1)) continue;
    const b = behind(el);
    if (!b || b.fade < .6) continue;
    const fg = over(parse(cs.color), b.col), ratioNow = ratio(fg, b.col);
    const px = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700, need = px >= 24 || (bold && px >= 18.6) ? 3 : 4.5;
    if (ratioNow + .01 >= need) continue;
    const t = el.textContent.trim().replace(/\s+/g, " ").slice(0, 40), sel = el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).join(".") : "");
    const k = sel + "|" + t;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({t, r: Math.round(ratioNow * 100) / 100, need, sel, fg: cs.color});
  }
  return out;
})()

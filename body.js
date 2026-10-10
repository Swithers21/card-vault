(async () => {
  const {w, d, errors} = await loadApp("/tmp/cvtest/app_with_data");
  const CV = w.CardVault;
  const st = () => CV.state();
  await CV.loadOcgCards();
  const cn = (a, b) => console.log("cleanName", JSON.stringify(a), "->", JSON.stringify(CV.cleanName(a, b)));
  cn("Dark Magician (Ultra Rare)", "Ultra Rare");
  cn("Blue-Eyes White Dragon (Secret Rare) (Alternate Art)", "Secret Rare");
  cn("Dark Magician (Arkana)", "Ultra Rare");
  cn("Dark Magician (Arkana) (Starlight Rare)", "Starlight Rare");
  cn("Token (Rare) (Red)", "Common");
  cn("Gate Guardian (Duel Terminal) (Rare)", "Rare");
  // matchScanned
  for (const t of ["LOB-EN001", "RD/KP25-JP001", "KP25-JP001", "rd kp25 - jp001", "RO|KP25-JP002", "SDK-001", "FOR LOB-EN001"]) console.log("scan", t, JSON.stringify(CV.matchScanned(t) && {n: CV.matchScanned(t).number, s: CV.matchScanned(t).sure}));
  // ocgRowFor reverse
  const card = CV.ocgCardAt("LOCH-JP019");
  console.log("rows 019", card && card.rows.map(x => x.rarity + ":" + x.local));
  console.log("rowFor UR(OF) on plain-only", CV.ocgRowFor(card, "Ultra Rare (Overframe)"));
  console.log("errors", errors);
  process.exit(0);
})();

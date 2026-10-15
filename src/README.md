# Card Vault's program, by topic

`app.js` (what the website runs) is made from these files, joined in name order by `build_app.py`.
They aren't separate modules: they are one program cut into pieces, so they share everything they know.

- Change a file here, then run `python build_app.py` to remake `app.js`. Commit both.
- Don't edit `app.js` by hand: the next build would undo it. The tests fail if `app.js` is out of date.
- Numbers keep the order: 00 setup and helpers, 10 storage, 20 prices, 30 page and drawers, 40-50 card info and
  markets, 60 search and want list, 70 backups, 80 settings, 85 how the app feels (slim value bar, the "since you last
  looked" summary, scroll hints, the Back button, swipes), 90-97 insights, grading, sales, decks, adding cards,
  import/export, 98 events and keyboard shortcuts (and the start-up at the very end).

# Cardiac Lab content

Copied from the Cardiac Lab project (github.com/eremedic/Cardiac-Lab). `scripts/build-lab.mjs` turns these into the
free preview (`site/js/cl-free.js`), the subscriber bank (`netlify/data/lab-full.json`), the Code lab runner
(`site/js/cl-codelab.js`, with the case content removed), the monitor (`site/js/cl-defib.js`) and the scoped styles
(`site/css/cardiac-lab.css`). To update, copy the newer files over these and run `npm run build`.

| File | From Cardiac Lab |
| --- | --- |
| `sinus.json` … `paced.json` | `static/areas/<area>.json` |
| `field.json` | `lib/field-data.mjs` (as JSON) |
| `random.json` | `static/trainer.json`: the 102 practice strips, their strips and every rhythm explanation |
| `codelab.js`, `defib.js` | `src/lib/sim/` |
| `twelve-rhythms.json` | `static/twelve-rhythms.json` (the monitor's 12-LEAD key) |
| `cardiac-lab.src.css` | `src/app.css` |

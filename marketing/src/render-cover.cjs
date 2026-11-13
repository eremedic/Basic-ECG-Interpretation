const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1640, height: 624 } });
await p.goto('file://' + __dirname + '/cover-company.html'); await p.waitForTimeout(1500);
await p.locator('#cover').screenshot({ path: __dirname + '/../brand/facebook-cover-1640x624.png' }); await b.close(); })();

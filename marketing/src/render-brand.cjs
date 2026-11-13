const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1700, height: 1200 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + __dirname + '/brand.html'); await p.waitForFunction(() => document.title === 'ready'); await p.waitForTimeout(1500);
  const out = __dirname + '/../brand'; fs.mkdirSync(out + '/instagram-highlights', { recursive: true });
  await p.locator('#cover').screenshot({ path: out + '/facebook-cover-1640x624.png' });
  await p.locator('#profile').screenshot({ path: out + '/profile-picture-1080x1080.png' });
  for (const id of ['start', 'course', 'rhythms', 'tips', 'quiz', 'cert', 'faq'])
    await p.locator('#hl-' + id).screenshot({ path: out + '/instagram-highlights/highlight-' + id + '.png' });
  console.log('errors', errs); await b.close();
})();

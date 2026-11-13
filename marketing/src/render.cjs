const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1300, height: 1200 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + __dirname + '/posts.html' + (process.argv[2] ? '?seed=' + process.argv[2] : ''));
  await p.waitForFunction(() => document.title === 'ready'); await p.waitForTimeout(1500);
  const out = process.argv[3] || __dirname + '/..';
  for (const [id, name] of [['launch', '1-launch-1080x1080'], ['quiz', '2-name-that-rhythm-1080x1080'], ['inside', '3-whats-inside-1080x1080'], ['story', '4-story-1080x1920'], ['banner', '5-facebook-linkedin-1200x630']])
    await p.locator('#' + id).screenshot({ path: out + '/' + name + '.png' });
  console.log('errors', errs); await b.close();
})();

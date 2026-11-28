// Portréty vzorových stromů: otevře sestavenou hru v prohlížeči (Playwright + Chromium), načte každý strom
// ze src/samples.json a uloží jeho portrét do src/sampleThumbs.json. Spouští se přes `npm run samples`.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..');
  const samples = JSON.parse(fs.readFileSync(path.join(root, 'src/samples.json'), 'utf8'));
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
  // přes http (BONSAI_URL, např. http://localhost:8765/index.html) se načtou i fotografické textury; file:// je WebGL nepustí
  await page.goto(process.env.BONSAI_URL || 'file://' + path.join(root, 'dist/index.html'));
  await page.waitForTimeout(1500);
  const out = {};
  for (const s of samples) {
    await page.evaluate((x) => window.bonsai.load(x), s);
    await page.waitForTimeout(1500);
    out[s.id] = await page.evaluate(() => window.bonsai.capture(0.3, 320, 380));
    console.log(s.id, Math.round(out[s.id].length / 1024) + ' kB');
  }
  fs.writeFileSync(path.join(root, 'src/sampleThumbs.json'), JSON.stringify(out));
  await browser.close();
})();

// Render the README images from mock.html with Playwright's Chromium.
//   node docs/screenshots/render.cjs
// Needs the playwright package (npm i -g playwright) and either its Chromium
// (npx playwright install chromium) or CHROME=/path/to/chromium.
const path = require("path");
const { chromium } = require("playwright");

const OUT = path.join(__dirname, "..");
const PAGE = "file://" + path.join(__dirname, "mock.html");

const SHOTS = [
  { file: "mail.png", view: "mail" },
  { file: "calendar.png", view: "calendar" },
  { file: "add-account.png", view: "add", clip: { x: 0, y: 0, width: 760, height: 560 } },
  { file: "overview.png", view: "overview" },
  { file: "themes.png", view: "themes" },
  { file: "social-preview.png", view: "social", scale: 1 },
];

(async () => {
  // CHROME=/usr/bin/chromium uses an installed Chromium instead of Playwright's own.
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  for (const shot of SHOTS) {
    const page = await browser.newPage({ deviceScaleFactor: shot.scale ?? 2, viewport: { width: 1400, height: 900 } });
    await page.goto(`${PAGE}?view=${shot.view}`);
    await page.evaluate(() => document.fonts.ready);
    const el = page.locator("#shot");
    const file = path.join(OUT, shot.file);
    if (shot.clip) {
      const box = await el.boundingBox();
      await page.screenshot({ path: file, clip: { ...shot.clip, x: box.x + shot.clip.x, y: box.y + shot.clip.y } });
    } else {
      await el.screenshot({ path: file });
    }
    console.log("wrote", path.relative(process.cwd(), file));
    await page.close();
  }
  await browser.close();
})();

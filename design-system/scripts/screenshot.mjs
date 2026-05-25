// Tiny screenshot helper for the design system.
// Usage: node screenshot.mjs <url> <outPath> [viewportWxH] [waitMs]
//
// Reads --color-scheme=light by default to avoid dark-mode polluting captures.
import { chromium } from 'playwright';

const [, , url, out, viewport = '1400x900', waitMs = '1500'] = process.argv;
if (!url || !out) {
  console.error('usage: node screenshot.mjs <url> <out.png> [WxH] [waitMs]');
  process.exit(2);
}
const [w, h] = viewport.split('x').map(Number);

const browser = await chromium.launch({
  headless: true,
  args: ['--hide-scrollbars', '--force-color-profile=srgb'],
});
const ctx = await browser.newContext({
  viewport: { width: w, height: h },
  deviceScaleFactor: 2,
  colorScheme: 'light',
});
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
// give animations a beat
await page.waitForTimeout(Number(waitMs));
await page.screenshot({ path: out, fullPage: false, omitBackground: false });
await browser.close();
console.log('wrote', out);

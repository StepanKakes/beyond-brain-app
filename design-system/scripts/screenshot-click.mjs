// Like screenshot-authed.mjs but additionally clicks a selector before capture.
//
// Usage:
//   AUTH_TOKEN=<jwt> node screenshot-click.mjs <url> <out> <selector> [WxH] [waitMs]
import { chromium } from 'playwright';

const token = process.env.AUTH_TOKEN;
const [, , url, out, selector, viewport = '1400x900', waitMs = '2000'] = process.argv;
if (!token || !url || !out || !selector) {
  console.error('usage: AUTH_TOKEN=... node screenshot-click.mjs <url> <out> <selector> [WxH] [waitMs]');
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
await ctx.addInitScript((t) => {
  try { localStorage.setItem('auth-token', t); } catch {}
}, token);

const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
await page.waitForTimeout(1500);
await page.locator(selector).first().click();
await page.waitForTimeout(Number(waitMs));
await page.screenshot({ path: out, fullPage: false });
await browser.close();
console.log('wrote', out);

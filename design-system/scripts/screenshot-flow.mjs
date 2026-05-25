// Screenshot helper that performs a sequence of clicks before capture.
//
// Usage:
//   AUTH_TOKEN=<jwt> node screenshot-flow.mjs <url> <out> <sel1>[,<sel2>,...] [WxH] [waitMs]
import { chromium } from 'playwright';

const token = process.env.AUTH_TOKEN;
const [, , url, out, selectorList, viewport = '1400x900', waitMs = '2000'] = process.argv;
if (!token || !url || !out || !selectorList) {
  console.error('usage: AUTH_TOKEN=... node screenshot-flow.mjs <url> <out> <s1[,s2,...]> [WxH] [waitMs]');
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

for (const sel of selectorList.split('||')) {
  await page.locator(sel).first().click();
  await page.waitForTimeout(700);
}

await page.waitForTimeout(Number(waitMs));
await page.screenshot({ path: out, fullPage: false });
await browser.close();
console.log('wrote', out);

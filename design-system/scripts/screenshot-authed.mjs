// Screenshot helper that injects an auth token into localStorage before
// loading the page, so the app skips login and we can capture authed surfaces.
//
// Usage:
//   AUTH_TOKEN=<jwt> node screenshot-authed.mjs <url> <out.png> [WxH] [waitMs]
import { chromium } from 'playwright';

const token = process.env.AUTH_TOKEN;
const [, , url, out, viewport = '1400x900', waitMs = '2000'] = process.argv;
if (!token) {
  console.error('AUTH_TOKEN env var is required');
  process.exit(2);
}
if (!url || !out) {
  console.error('usage: AUTH_TOKEN=... node screenshot-authed.mjs <url> <out.png> [WxH] [waitMs]');
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
// Inject token before any script runs.
await ctx.addInitScript((t) => {
  try { localStorage.setItem('auth-token', t); } catch {}
}, token);

const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
await page.waitForTimeout(Number(waitMs));
await page.screenshot({ path: out, fullPage: false });
await browser.close();
console.log('wrote', out);

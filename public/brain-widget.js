// Brain: úkoly na dnešek jako widget na ploše iPhonu.
// Návod je v Brainu: Více > Widget na plochu.
// Spusť jednou v Scriptable a vlož klíč, pak přidej widget Scriptable a vyber tenhle skript.

const BRAIN = 'https://brain.growbeyond.cz';
const KEY_NAME = 'brain-widget-key';
const CACHE_FILE = 'brain-widget.json';
const LIMITS = { small: 4, medium: 4, large: 10, extraLarge: 10 };

const colors = {
  bg: Color.dynamic(new Color('#F6F6F4'), new Color('#111113')),
  ink: Color.dynamic(new Color('#14161A'), new Color('#F5F5F7')),
  quiet: Color.dynamic(new Color('#61656E'), new Color('#AEAEB2')),
  hot: Color.dynamic(new Color('#C8321E'), new Color('#FF6B57')),
};

/* ---- key and network ---- */

function savedKey() {
  return Keychain.contains(KEY_NAME) ? Keychain.get(KEY_NAME) : null;
}

async function askForKey(message) {
  const alert = new Alert();
  alert.title = 'Klíč do Brainu';
  alert.message = message;
  alert.addSecureTextField('Vlož klíč');
  alert.addAction('Uložit');
  alert.addCancelAction('Zrušit');
  if ((await alert.presentAlert()) === -1) return null;
  const key = alert.textFieldValue(0).trim();
  if (key) Keychain.set(KEY_NAME, key);
  return key || null;
}

async function call(path, { method = 'GET', body = null } = {}) {
  const key = savedKey();
  if (!key) throw new Error('bez-klice');
  const req = new Request(`${BRAIN}/api/widget${path}`);
  req.method = method;
  req.timeoutInterval = 15;
  req.headers = { 'x-widget-key': key, 'Content-Type': 'application/json' };
  if (body) req.body = JSON.stringify(body);
  const data = await req.loadJSON();
  const status = req.response && req.response.statusCode;
  if (status === 401) throw new Error('spatny-klic');
  if (status >= 400) throw new Error((data && data.error) || `Chyba ${status}`);
  return data;
}

/* ---- last good answer, so a bad signal does not empty the widget ---- */

const files = FileManager.local();
const cachePath = files.joinPath(files.cacheDirectory(), CACHE_FILE);

function readCache() {
  try {
    return files.fileExists(cachePath) ? JSON.parse(files.readString(cachePath)) : null;
  } catch (err) {
    return null;
  }
}

function writeCache(data) {
  files.writeString(cachePath, JSON.stringify(data));
}

async function loadTasks() {
  try {
    const data = await call('/ukoly');
    writeCache(data);
    return { data, problem: null };
  } catch (err) {
    if (err.message === 'bez-klice' || err.message === 'spatny-klic') return { data: null, problem: err.message };
    return { data: readCache(), problem: 'offline' };
  }
}

/* ---- widget ---- */

const selfUrl = (query) => `${URLScheme.forRunningScript()}?${query}`;

function header(widget, count, canAdd) {
  const row = widget.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  const title = row.addText(count ? `Dnes ${count}` : 'Dnes');
  title.font = Font.boldSystemFont(15);
  title.textColor = colors.ink;
  row.addSpacer();
  if (canAdd) {
    const plus = row.addStack();
    plus.url = selfUrl('pridat=1');
    plus.setPadding(2, 8, 2, 0);
    const icon = plus.addImage(SFSymbol.named('plus.circle.fill').image);
    icon.imageSize = new Size(22, 22);
    icon.tintColor = colors.ink;
  }
}

function message(widget, text) {
  const line = widget.addText(text);
  line.font = Font.systemFont(13);
  line.textColor = colors.quiet;
}

function taskRow(widget, task, tappable) {
  const row = widget.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  row.spacing = 8;

  const mark = row.addStack();
  if (tappable) mark.url = selfUrl(`hotovo=${encodeURIComponent(task.id)}`);
  const circle = mark.addImage(SFSymbol.named('circle').image);
  circle.imageSize = new Size(20, 20);
  circle.tintColor = task.priority === 1 || task.late ? colors.hot : colors.quiet;

  const text = row.addStack();
  if (tappable) text.url = `${BRAIN}/m/ukol/${encodeURIComponent(task.id)}`;
  const label = text.addText(task.client ? `${task.client}: ${task.text}` : task.text);
  label.font = Font.systemFont(15);
  label.textColor = colors.ink;
  label.lineLimit = 1;
  row.addSpacer();
}

function build({ data, problem }, family) {
  const widget = new ListWidget();
  widget.backgroundColor = colors.bg;
  widget.setPadding(10, 14, 10, 14);
  widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  // Malý widget umí jen jedno klepnutí na celou plochu.
  const tappable = family !== 'small';
  if (!tappable) widget.url = `${BRAIN}/m`;

  const tasks = (data && data.tasks) || [];
  header(widget, tasks.length, tappable);
  widget.addSpacer(8);

  if (problem === 'bez-klice' || problem === 'spatny-klic') {
    message(widget, problem === 'bez-klice' ? 'Spusť skript a vlož klíč' : 'Klíč neplatí, vlož nový');
    widget.url = selfUrl('klic=1');
  } else if (!data) {
    message(widget, 'Brain se nenačetl');
  } else if (!tasks.length) {
    message(widget, 'Na dnes nic');
  } else {
    const limit = LIMITS[family] || LIMITS.medium;
    // Když se všechny nevejdou, jeden řádek uvolní místo pro počet zbývajících.
    const shown = tasks.length > limit ? limit - 1 : limit;
    tasks.slice(0, shown).forEach((task, i) => {
      if (i) widget.addSpacer(5);
      taskRow(widget, task, tappable);
    });
    if (tasks.length > shown) {
      widget.addSpacer(4);
      message(widget, `a další: ${tasks.length - shown}`);
    }
  }
  widget.addSpacer();
  return widget;
}

/* ---- what a tap does ---- */

async function say(title, text) {
  const alert = new Alert();
  alert.title = title;
  alert.message = text;
  alert.addAction('OK');
  await alert.presentAlert();
}

function backHome() {
  if (typeof App !== 'undefined' && App.close) App.close();
}

async function tick(id) {
  await call(`/ukoly/${encodeURIComponent(id)}/hotovo`, { method: 'POST' });
  const cached = readCache();
  if (cached) {
    cached.tasks = cached.tasks.filter((t) => t.id !== id);
    writeCache(cached);
  }
}

async function add() {
  const alert = new Alert();
  alert.title = 'Nový úkol';
  alert.message = 'Bez termínu půjde na dnes';
  alert.addTextField('p1 zítra zavolat Pavlovi');
  alert.addAction('Přidat');
  alert.addCancelAction('Zrušit');
  if ((await alert.presentAlert()) === -1) return;
  const text = alert.textFieldValue(0).trim();
  if (text) await call('/ukoly', { method: 'POST', body: { text } });
}

async function main() {
  const query = args.queryParameters || {};

  if (config.runsInWidget) {
    Script.setWidget(build(await loadTasks(), config.widgetFamily));
    return;
  }

  if (query.klic || !savedKey()) {
    const key = await askForKey('Najdeš ho v Brainu: Více > Widget na plochu');
    if (!key) return;
  }

  try {
    if (query.hotovo) {
      await tick(query.hotovo);
      backHome();
      return;
    }
    if (query.pridat) {
      await add();
      backHome();
      return;
    }
  } catch (err) {
    await say('Nepovedlo se', err.message === 'spatny-klic' ? 'Klíč neplatí, spusť skript a vlož nový' : err.message);
    return;
  }

  const result = await loadTasks();
  if (result.problem === 'spatny-klic') {
    await askForKey('Tenhle klíč neplatí. Vytvoř nový v Brainu: Více > Widget na plochu');
    return;
  }
  await build(result, 'medium').presentMedium();
}

await main();
Script.complete();

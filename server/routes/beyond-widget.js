/**
 * Beyond Brain — the phone widget's API.
 *
 * A Scriptable widget on the home screen cannot hold a login, so it carries its
 * own key (`x-widget-key`). The key does what the widget does: read the person's
 * tasks for today, add one, tick one. Everything else stays behind a login.
 */
import express from 'express';

import { userDb, widgetKeysDb } from '../modules/database/index.js';
import { getBrainIndex } from '../services/brain-index.js';
import { getPeople, personForUser } from '../services/beyond-people.js';
import { todayIso } from '../services/beyond-time.js';
import { phoneZone } from '../services/beyond-tasks.js';
import * as ukoly from '../services/beyond-ukoly.js';

const router = express.Router();

router.use((req, res, next) => {
  const key = String(req.headers['x-widget-key'] || '');
  const userId = key ? widgetKeysDb.userIdFor(key) : null;
  const user = userId ? userDb.getUserById(userId) : null;
  if (!user) return res.status(401).json({ ok: false, error: 'Klíč widgetu neplatí' });
  req.user = user;
  req.owner = personForUser(user)?.key || process.env.BEYOND_DEFAULT_OWNER || getPeople()[0]?.key || 'tim';
  req.today = todayIso(new Date(), phoneZone(user.username) || undefined);
  next();
});

/** What is on the person's plate: due today or late, worst first. */
router.get('/ukoly', async (req, res) => {
  try {
    const index = await getBrainIndex();
    const nameOf = (slug) => index.clients.find((c) => c.slug === slug)?.name || null;
    const tasks = ukoly
      .listTasks()
      .filter((t) => t.owner === req.owner && t.state !== 'done' && t.due && t.due <= req.today)
      .sort((a, b) => a.priority - b.priority || a.due.localeCompare(b.due))
      .map((t) => ({
        id: t.id,
        text: t.text,
        priority: t.priority,
        due: t.due,
        late: t.due < req.today,
        client: t.client ? nameOf(t.client) : null,
      }));
    res.json({ today: req.today, tasks });
  } catch (err) {
    console.error('[widget] /ukoly failed', err);
    res.status(500).json({ ok: false, error: 'úkoly se nenačetly' });
  }
});

/** Same quick text as the app. With no day in it, it belongs to today. */
router.post('/ukoly', async (req, res) => {
  try {
    const quick = String(req.body?.text || '').trim();
    if (!quick) return res.status(400).json({ ok: false, error: 'text chybí' });
    const index = await getBrainIndex();
    const fields = ukoly.parseQuick(quick, {
      zone: phoneZone(req.user.username) || undefined,
      me: req.owner,
      clients: index.clients.filter((c) => c.isActive !== false).map((c) => ({ slug: c.slug, name: c.name, first: c.name.split(' ')[0] })),
    });
    const task = await ukoly.createTask({ ...fields, due: fields.due || req.today, createdBy: req.owner });
    res.json({ ok: true, id: task.id });
  } catch (err) {
    res.status(400).json({ ok: false, error: err?.message || 'úkol nešel založit' });
  }
});

router.post('/ukoly/:id/hotovo', async (req, res) => {
  try {
    const task = ukoly.getTask(req.params.id);
    if (!task || task.owner !== req.owner) return res.status(404).json({ ok: false, error: 'Úkol nenalezen' });
    await ukoly.updateTask(task.id, { state: 'done' }, { by: `widget ${req.owner}` });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err?.message || 'úkol nešel odškrtnout' });
  }
});

export default router;

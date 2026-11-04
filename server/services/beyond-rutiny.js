/**
 * Beyond Brain — routines.
 *
 * A routine is a custom task (`system/ulohy.json`) that belongs to the person
 * who set it up and tells them through a push. Nothing here runs anything: the
 * scheduler already does that. This is the view the app needs: what is set up,
 * what it said last, and the two templates most people start from.
 */
import { describeSchedule, isDueAt } from './beyond-schedule.js';
import { RUN_LOG_MARK, getJobState, listRuns, markJobRan } from './beyond-runs.js';
import { listTasks } from './beyond-tasks.js';

export const ROUTINE_TEMPLATES = [
  {
    id: 'rano',
    title: 'Ranní souhrn hovorů',
    sub: 'V pracovní dny v 8:00 přehled, co se včera na callech řešilo',
    schedule: { kind: 'cron', expr: '0 8 * * 1-5' },
    prompt: [
      'Projdi clients/aktivni/*/cally.md a najdi hovory s klienty od minulého pracovního dne do dneška.',
      'Každý zápis začíná nadpisem s datem a účastníky.',
      '',
      'Seskup je podle toho, kdo z týmu hovor vedl. U každého hovoru napiš:',
      's kým, co řešili, na čem se shodli, co je na kom a do kdy.',
      'Když klient drhne nebo padlo riziko, dej to na začátek.',
      '',
      'Drž se toho, co je zapsané, nic si nedomýšlej. Když žádný hovor nebyl, odpověz [TICHO].',
    ].join('\n'),
  },
  {
    id: 'hovor',
    title: 'Souhrn po hovoru',
    sub: 'Hned jak je hovor zapsaný, co se na něm řešilo',
    schedule: { kind: 'po_hovoru' },
    prompt: [
      'V kontextu je hovor, který se právě zapsal do brainu. Když kontext chybí,',
      'vezmi nejnovější zapsaný hovor z clients/aktivni/*/cally.md.',
      '',
      'Přečti jeho zápis a závazky v _action-items.md a do šesti řádků napiš:',
      'kdo s kým mluvil, co řešili, na čem se shodli, co je na kom a do kdy.',
      'Když klient drhne nebo padlo riziko, řekni to první.',
      '',
      'Drž se toho, co je zapsané, nic si nedomýšlej.',
    ].join('\n'),
  },
];

/** What the person reads, without the run log the scheduler appends. */
function outputOf(summary) {
  if (!summary) return null;
  const at = summary.indexOf(RUN_LOG_MARK);
  return (at < 0 ? summary : summary.slice(0, at)).trim() || null;
}

function runView(run) {
  return {
    id: run.id,
    status: run.status,
    at: run.startedAt,
    vystup: run.status === 'ok' ? outputOf(run.summary) : null,
    chyba: ['ok', 'skipped', 'running'].includes(run.status) ? null : run.error || 'Běh selhal',
  };
}

export function routineView(task) {
  const [last] = listRuns({ job: task.name, limit: 1 });
  return {
    name: task.name,
    title: task.title,
    prompt: task.prompt,
    schedule: task.schedule,
    kdy: describeSchedule(task.schedule),
    enabled: task.enabled !== false,
    notion: Array.isArray(task.mcp) && task.mcp.includes('notion'),
    posledni: last ? runView(last) : null,
  };
}

export function listRoutines(username) {
  return listTasks()
    .filter((t) => t.createdBy === username)
    .map(routineView);
}

export function routineDetail(task) {
  return {
    rutina: routineView(task),
    behy: listRuns({ job: task.name, limit: 20 }).map(runView),
  };
}

/**
 * A slot already gone today would fire the moment the routine is saved, because
 * the scheduler catches up on missed slots. Set up at six in the evening, a
 * morning routine belongs to tomorrow.
 */
export function skipMissedSlot(task) {
  if (task.enabled === false) return;
  const { lastRunAt } = getJobState(task.name) || {};
  if (isDueAt(task.schedule, { lastRunAt: lastRunAt || null })) markJobRan(task.name);
}

/**
 * Beyond Brain — the tools the agent has over the app itself.
 *
 * Everything the agent could do so far it did through files: read the repo,
 * write the repo. These are the few things that are not files: the schedule,
 * the conversation history, its own notes, and proposals to change its rules.
 * They run in this process (in-process MCP server), so there is nothing to
 * deploy or authenticate, and every run — chat, Telegram, scheduled — gets the
 * same set.
 *
 * Each server is built per run with a context: who is asking, from where, and
 * what they may do. A scheduled run cannot schedule more runs (recursion
 * guard); a proposal from a job is labelled with that job.
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
// zod arrives with the Agent SDK (peer of createSdkMcpServer); not listed in
// package.json on purpose, regenerating the lockfile off the Windows box has
// bitten before.
import { z } from 'zod';

import { createTask, getTask, listTasks, removeTask, updateTask, setScheduleOverride } from './beyond-tasks.js';
import { describeSchedule } from './beyond-schedule.js';
import { search as searchHistory, readSession, recentSessions } from './beyond-history.js';
import * as memory from './beyond-memory.js';
import * as mozek from './beyond-mozek.js';
import * as ukoly from './beyond-ukoly.js';
import { getPeople } from './beyond-people.js';

function text(payload) {
  return { content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }] };
}

function fail(message) {
  return { content: [{ type: 'text', text: `CHYBA: ${message}` }], isError: true };
}

/**
 * @param {object} ctx
 * @param {string} ctx.source      'chat' | 'telegram' | 'job'
 * @param {string} [ctx.actor]     username, job name, or session id for the audit trail
 * @param {object} [ctx.origin]    e.g. { telegramChatId } so `deliver: telegram` goes back there
 * @param {boolean} [ctx.allowSchedule]  false inside scheduled runs
 * @param {object} [ctx.jobsApi]   { listBuiltin(), runNow(name) } injected to avoid a cycle
 */
export function buildBeyondToolsServer(ctx = {}) {
  const actor = ctx.actor || ctx.source || 'agent';
  const allowSchedule = ctx.allowSchedule !== false;

  const schedule = tool(
    'beyond_schedule',
    [
      'Úlohy agenta: co běží samo a kdy. Akce: list, create, update, pause, resume, remove, run.',
      'Rozvrh (schedule): {kind:"every",minutes} | {kind:"daily",time:"HH:MM"} | {kind:"weekly",weekday:0-6,time} |',
      '{kind:"cron",expr:"m h dom mon dow"} | {kind:"at",at:"ISO datum"} (jednou) | {kind:"manual"}.',
      'Vlastní úloha = prompt, který se v ten čas spustí jako samostatný běh agenta nad brainem; volitelně skill a deliver',
      '({kind:"telegram",chatId?} pošle výsledek na Telegram, {kind:"soubor"} uloží do workspace/reporty/, {kind:"nic"}).',
      'continuity=true vloží úloze její minulý výstup. noAgent=true pošle prompt doslova bez modelu (připomínky).',
      'U vestavěných úloh (mají builtin=true) jde měnit jen rozvrh a pauza. Jednorázová úloha se po běhu sama vypne.',
    ].join(' '),
    {
      action: z.enum(['list', 'create', 'update', 'pause', 'resume', 'remove', 'run']),
      name: z.string().optional().describe('název nebo id úlohy (u všeho kromě list a create)'),
      title: z.string().optional(),
      prompt: z.string().optional(),
      skill: z.string().optional().describe('název skillu z .claude/skills, který má úloha použít'),
      schedule: z.record(z.string(), z.any()).optional(),
      deliver: z.record(z.string(), z.any()).optional(),
      repeatTimes: z.number().int().positive().optional().describe('kolikrát celkem proběhnout, pak se vypne'),
      continuity: z.boolean().optional(),
      noAgent: z.boolean().optional(),
    },
    async (args) => {
      try {
        const builtin = ctx.jobsApi?.listBuiltin?.() || [];
        if (args.action === 'list') {
          return text({
            builtin: builtin.map((j) => ({ name: j.name, title: j.title, schedule: describeSchedule(j.schedule), enabled: j.enabled, lastRunAt: j.lastRunAt, builtin: true })),
            custom: listTasks().map((t) => ({
              id: t.id,
              name: t.name,
              title: t.title,
              schedule: describeSchedule(t.schedule),
              deliver: t.deliver,
              enabled: t.enabled,
              repeat: t.repeat,
              createdBy: t.createdBy,
              prompt: t.prompt.slice(0, 200),
            })),
          });
        }
        if (!allowSchedule) return fail('uvnitř naplánovaného běhu nejde plánovat další běhy, řekni to v odpovědi a plánování nech na chat nebo Telegram');

        if (args.action === 'create') {
          const task = await createTask({
            title: args.title,
            prompt: args.prompt,
            skill: args.skill || null,
            schedule: args.schedule,
            deliver: args.deliver || (ctx.origin?.telegramChatId ? { kind: 'telegram' } : { kind: 'soubor' }),
            repeat: args.repeatTimes ? { times: args.repeatTimes } : null,
            continuity: args.continuity,
            noAgent: args.noAgent,
            createdBy: actor,
            origin: ctx.origin || null,
          });
          return text({ ok: true, task: { id: task.id, name: task.name, schedule: describeSchedule(task.schedule), deliver: task.deliver } });
        }

        const name = args.name;
        if (!name) return fail('name chybí');
        const isBuiltin = builtin.find((j) => j.name === name);

        if (args.action === 'run') {
          if (!ctx.jobsApi?.runNow) return fail('ruční spuštění tady není k dispozici');
          const started = await ctx.jobsApi.runNow(name, actor);
          return text({ ok: true, started });
        }
        if (isBuiltin) {
          if (args.action === 'update') {
            if (!args.schedule) return fail('u vestavěné úlohy jde měnit jen schedule');
            const s = await setScheduleOverride(name, args.schedule, { by: actor });
            return text({ ok: true, name, schedule: describeSchedule(s) });
          }
          if (args.action === 'pause' || args.action === 'resume') {
            ctx.jobsApi?.setEnabled?.(name, args.action === 'resume');
            return text({ ok: true, name, enabled: args.action === 'resume' });
          }
          if (args.action === 'remove') return fail('vestavěná úloha se nedá zrušit, jen pozastavit (pause)');
        }
        if (!getTask(name)) return fail(`úloha ${name} neexistuje`);
        if (args.action === 'update') {
          const t = await updateTask(
            name,
            {
              title: args.title,
              prompt: args.prompt,
              skill: args.skill,
              schedule: args.schedule,
              deliver: args.deliver,
              continuity: args.continuity,
              noAgent: args.noAgent,
              repeat: args.repeatTimes ? { times: args.repeatTimes } : undefined,
            },
            { by: actor },
          );
          return text({ ok: true, task: { id: t.id, name: t.name, schedule: describeSchedule(t.schedule) } });
        }
        if (args.action === 'pause' || args.action === 'resume') {
          await updateTask(name, { enabled: args.action === 'resume' }, { by: actor });
          return text({ ok: true, name, enabled: args.action === 'resume' });
        }
        if (args.action === 'remove') {
          await removeTask(name, { by: actor });
          return text({ ok: true, removed: name });
        }
        return fail(`neznámá akce ${args.action}`);
      } catch (err) {
        return fail(err?.message || String(err));
      }
    },
  );

  const history = tool(
    'hledej_historii',
    [
      'Fulltext nad historií všech konverzací s agentem (chat, Telegram, naplánované běhy). Bez modelu, rychlé.',
      'Když Tim odkazuje na něco z minula („jak jsme to řešili", „co jsi říkal o..."), hledej tady dřív, než se ptáš.',
      'query: slova (AND), "fráze", slovo* (prefix), OR, NOT. sessionId + aroundId zobrazí okno kolem zprávy.',
      'Bez query vrátí poslední sessions.',
    ].join(' '),
    {
      query: z.string().optional(),
      sessionId: z.string().optional(),
      aroundId: z.number().int().optional(),
      limit: z.number().int().min(1).max(20).optional(),
      includeTools: z.boolean().optional().describe('hledat i ve volání nástrojů (default ne)'),
    },
    async (args) => {
      try {
        if (args.sessionId) return text(readSession(args.sessionId, { aroundId: args.aroundId ?? null }) || { error: 'session neexistuje' });
        if (!args.query) return text(recentSessions({ limit: args.limit || 15 }));
        return text(
          searchHistory({
            query: args.query,
            limit: args.limit || 8,
            roles: args.includeTools ? null : ['user', 'assistant'],
          }),
        );
      } catch (err) {
        return fail(err?.message || String(err));
      }
    },
  );

  const pamet = tool(
    'pamet',
    [
      'Tvoje trvalá paměť: target "agent" (co ses naučil o práci, 2200 znaků) nebo "tim" (o lidech, 1375 znaků).',
      'Akce add (text), replace (old_text → text), remove (old_text). old_text je krátký unikátní kus položky.',
      'Když je plno, nástroj to odmítne a vrátí seznam; sluč nebo odeber, pak přidej. Jedna položka = jedno pravidlo,',
      'krátce, s důvodem. Sem nepatří fakta o klientech ani nic, co je v souborech brainu.',
    ].join(' '),
    {
      action: z.enum(['add', 'replace', 'remove', 'show']),
      target: z.enum(['agent', 'tim']),
      text: z.string().optional(),
      old_text: z.string().optional(),
    },
    async (args) => {
      try {
        const by = actor;
        if (args.action === 'show') return text(memory.snapshot(args.target));
        if (args.action === 'add') return text(await memory.add(args.target, args.text || '', { by }));
        if (args.action === 'replace') return text(await memory.replace(args.target, args.old_text || '', args.text || '', { by }));
        if (args.action === 'remove') return text(await memory.remove(args.target, args.old_text || '', { by }));
        return fail('neznámá akce');
      } catch (err) {
        return fail(err?.message || String(err));
      }
    },
  );

  const skillManage = tool(
    'skill_manage',
    [
      'Navrhni změnu skillu (.claude/skills/*.md) nebo pravidla v system/*.md. Nic se nezapíše hned:',
      'návrh čeká ve Velíně na schválení, pak se commitne. Akce: list, view (path), patch (path, old_string, new_string, reason),',
      'create (path, content, reason). Kdy: opakující se postup, který stojí za zapsání; pitfall, který jsi našel;',
      'oprava od Tima. Pravidlo: lekce, ne log. Pitfall = pravidlo + jedna věta proč, žádné datum, žádná citace chatu.',
      'Preferuj patch před přepisem celého souboru.',
    ].join(' '),
    {
      action: z.enum(['list', 'view', 'patch', 'create']),
      path: z.string().optional().describe('např. .claude/skills/sync-client.md'),
      old_string: z.string().optional(),
      new_string: z.string().optional(),
      content: z.string().optional(),
      reason: z.string().optional(),
    },
    async (args) => {
      try {
        if (args.action === 'list') return text(mozek.listSkills());
        if (!args.path) return fail('path chybí');
        if (args.action === 'view') {
          const t = mozek.readBrainFile(args.path);
          return t == null ? fail('soubor neexistuje') : text(t);
        }
        if (args.action === 'patch') {
          const r = mozek.propose({
            path: args.path,
            patch: { oldString: args.old_string, newString: args.new_string },
            reason: args.reason,
            source: actor,
          });
          return text({ ok: true, ...r, note: 'návrh čeká na schválení ve Velíně' });
        }
        if (args.action === 'create') {
          const r = mozek.propose({ path: args.path, after: args.content, reason: args.reason, source: actor });
          return text({ ok: true, ...r, note: 'návrh čeká na schválení ve Velíně' });
        }
        return fail('neznámá akce');
      } catch (err) {
        return fail(err?.message || String(err));
      }
    },
  );

  const tasks = tool(
    'ukoly',
    [
      'Úkoly lidí (Velín, workspace/ukoly.json). Akce: list, create, update, done.',
      'create: text, priority 1 až 4 (1 nejvyšší), owner (klíč osoby: tim, stepan), client (slug), due (YYYY-MM-DD), note (proč).',
      'Zakládej úkol, když z dat plyne, že má někdo něco udělat, a řekni v note proč. Ne pro sebe: co máš udělat ty, udělej.',
      'update: id + libovolné z polí, done: id. Vlastník podle toho, kdo klienta vede; když nevíš, nech výchozí.',
    ].join(' '),
    {
      action: z.enum(['list', 'create', 'update', 'done']),
      id: z.string().optional(),
      text: z.string().optional(),
      priority: z.number().int().min(1).max(4).optional(),
      owner: z.string().optional(),
      client: z.string().optional(),
      due: z.string().optional(),
      note: z.string().optional(),
      state: z.enum(['none', 'work', 'done']).optional(),
    },
    async (args) => {
      try {
        if (args.action === 'list') {
          return text(ukoly.listTasks().filter((t) => t.state !== 'done').map((t) => ({ id: t.id, text: t.text, priority: t.priority, state: t.state, owner: t.owner, client: t.client, due: t.due, createdBy: t.createdBy })));
        }
        if (args.action === 'create') {
          const t = await ukoly.createTask({
            text: args.text,
            priority: args.priority ?? 3,
            owner: args.owner || process.env.BEYOND_DEFAULT_OWNER || getPeople()[0]?.key || 'tim',
            client: args.client || null,
            due: args.due || null,
            note: args.note || null,
            createdBy: actor === 'chat' || actor === 'telegram' ? 'agent' : actor,
          });
          return text({ ok: true, id: t.id, text: t.text, owner: t.owner, priority: t.priority });
        }
        if (!args.id) return fail('id chybí');
        if (args.action === 'done') return text({ ok: true, task: await ukoly.updateTask(args.id, { state: 'done' }, { by: actor }) });
        const t = await ukoly.updateTask(args.id, { text: args.text, priority: args.priority, owner: args.owner, client: args.client, due: args.due, note: args.note, state: args.state }, { by: actor });
        return text({ ok: true, task: t });
      } catch (err) {
        return fail(err?.message || String(err));
      }
    },
  );

  return createSdkMcpServer({ name: 'beyond', version: '1.0.0', tools: [schedule, history, pamet, skillManage, tasks] });
}

/** Tool names as the SDK exposes them, for allow lists. */
export const BEYOND_TOOL_NAMES = ['mcp__beyond__beyond_schedule', 'mcp__beyond__hledej_historii', 'mcp__beyond__pamet', 'mcp__beyond__skill_manage', 'mcp__beyond__ukoly'];

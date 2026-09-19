/**
 * Beyond Brain — what the agent does on its own.
 *
 * The work itself was already written: the brain carries eleven skills that
 * know how to sync a client, prepare a call brief, extract action items and
 * check a roadmap. What was missing was a clock and a record. Each job below is
 * a trigger plus a prompt that hands the work to one of those skills, so the
 * instructions stay in the brain where they can be edited without a deploy.
 *
 * Two rules every job obeys:
 *
 *   1. Nothing leaves the brain. These jobs read the repo and write back into
 *      it. Git is the audit trail and the undo. Anything that would reach a
 *      client is a draft in `workspace/drafty/`, never a send.
 *
 *   2. A job that has nothing to do does nothing. Each one decides for itself
 *      whether there is work, and skips loudly rather than burning a model call
 *      to conclude "no changes".
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { runSdkOneShot } from '../claude-sdk.js';
import { getBrainIndex, invalidateBrainIndex } from './brain-index.js';
import { inbox } from './brain-signals.js';
import { getCalls } from './beyond-calls.js';
import { getPeople } from './beyond-people.js';
import { resolveBrainPath } from '../utils/brain-path.js';
import { getJobState, markJobRan, ranToday } from './beyond-runs.js';
import { countPending, createProposal, sentRecently, slugsWithPending } from './beyond-proposals.js';

/** Give a scheduled run room; these prompts read a lot of files. */
const JOB_TIMEOUT_MS = 12 * 60 * 1000;

async function runAgent(command, { timeoutMs = JOB_TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await runSdkOneShot({ command, skipPermissions: true, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* 1. a call happened → put it in the brain                            */
/* ------------------------------------------------------------------ */

/**
 * Transcripts land in `raw/fathom/` after every call. Turning one into the
 * written record is the single most valuable thing to automate: it is the step
 * that always slips, and everything downstream (promises, numbers, the next
 * brief) depends on it having happened.
 */
async function findUnwrittenCalls() {
  const index = await getBrainIndex({ force: true });
  const out = [];
  for (const c of index.clients) {
    if (c.isActive === false) continue;
    const newest = c.fathom?.[0];
    if (!newest) continue;
    const lastWritten = c.calls?.[0]?.dateIso || null;
    if (lastWritten && lastWritten >= newest.dateIso) continue;
    out.push({ slug: c.slug, name: c.name, file: newest.file, dateIso: newest.dateIso });
  }
  return out;
}

const processCall = {
  name: 'zpracuj-call',
  title: 'Zpracovat call do brainu',
  description:
    'Když v raw/fathom přibude přepis novější než poslední zápis v cally.md, ' +
    'přepíše ho do zápisu, vytáhne sliby na obě strany a čísla z check-inu.',
  everyMs: 10 * 60 * 1000,
  async hasWork() {
    const pending = await findUnwrittenCalls();
    return pending.length ? `${pending.length} nezapsaných callů` : null;
  },
  async run({ log }) {
    const pending = await findUnwrittenCalls();
    if (!pending.length) return { skipped: 'nic nezpracovaného' };

    const done = [];
    for (const call of pending) {
      log(`zpracovávám ${call.slug} · ${call.file}`);
      const result = await runAgent(
        [
          `Použij skill sync-client na klienta \`${call.slug}\`.`,
          '',
          `V \`clients/aktivni/${call.slug}/raw/fathom/${call.file}\` je přepis callu`,
          `z ${call.dateIso}, který ještě není zapsaný v \`cally.md\`.`,
          '',
          'Udělej přesně tohle a nic víc:',
          `1. Přečti ten přepis a zapiš call do \`clients/aktivni/${call.slug}/cally.md\``,
          '   jako nový blok nahoru, formátem `## RRRR-MM-DD — účastníci`. Append-only,',
          '   nic staršího nepřepisuj.',
          '2. Vytáhni z callu závazky na obě strany a doplň je do',
          `   \`clients/aktivni/${call.slug}/_action-items.md\` (pokud soubor není, založ ho`,
          '   podle vzoru jiného klienta). Rozlišuj, co dlužíme my a co klient, a kde padl',
          '   termín, zapiš ho.',
          '3. Pokud v callu padla týdenní čísla (lidi v DM, hovory, platby, tržby nebo',
          `   jiná páteř toho klienta), doplň je do \`clients/aktivni/${call.slug}/mereni.md\`.`,
          '   Když číslo nepadlo, nech prázdno. Prázdno znamená nevíme, nula znamená',
          '   dělal a nevyšlo. Nikdy je nezaměňuj.',
          '4. Když z callu plyne nové riziko nebo se staré vyřešilo, uprav `flags.md`.',
          '',
          'Nic neodesílej a nic nepublikuj. Na konci napiš dvě věty o tom, co jsi zapsal.',
        ].join('\n'),
      );
      done.push(`${call.name}: ${String(result.text || '').replace(/\s+/g, ' ').slice(0, 200)}`);
      invalidateBrainIndex();
    }
    return { summary: done.join('\n') };
  },
};

/* ------------------------------------------------------------------ */
/* 2. morning: sync, then say what needs a person                      */
/* ------------------------------------------------------------------ */

const syncClients = {
  name: 'sync-klientu',
  title: 'Ranní sync klientů',
  description:
    'Promítne noční raw vrstvu (Notion, WhatsApp) do kurátorských souborů přes skill sync-client.',
  dailyAt: { hour: 6, minute: 20 },
  async run() {
    const result = await runAgent(
      [
        'Použij skill sync-client s parametrem `all`.',
        '',
        'Projdi všechny aktivní klienty a promítni do jejich kurátorských souborů to,',
        'co přibylo v `raw/`. Drž pravidla skillu: append-only u cally, feedback',
        'a whatsapp, kurátorské sekce a flags nepřepisuj, Notion je zdroj faktů',
        'a brain zdroj interpretace.',
        '',
        'Klienta se stavem jiným než Aktivní přeskoč.',
        '',
        'Na konci napiš jednu větu na klienta, u kterého se něco změnilo, a klienty',
        'beze změny jen vyjmenuj.',
      ].join('\n'),
      { timeoutMs: 20 * 60 * 1000 },
    );
    invalidateBrainIndex();
    return { summary: String(result.text || '').slice(0, 4000) };
  },
};

/**
 * The brief is written from the signals, not from a fresh read of everything.
 * The detector already decided what matters; the agent's job here is to say it
 * in a way a person acts on, and to leave it in the brain so it can be read
 * later without scrolling Telegram.
 */
const morningBrief = {
  name: 'ranni-brief',
  title: 'Ranní brief',
  description:
    'Spočítá signály, napíše krátký brief o tom, co dnes hoří, uloží ho do workspace ' +
    'a pošle na Telegram.',
  dailyAt: { hour: 6, minute: 40 },
  async run({ log }) {
    const index = await getBrainIndex({ force: true });
    const people = getPeople();
    const calls = await getCalls({ clients: index.clients, people, force: true });
    const { needsUs, risks, systemic } = inbox(index.clients, { upcomingCalls: calls.calls });

    const today = new Date().toISOString().slice(0, 10);
    const todaysCalls = calls.calls.filter((c) => c.startIso.slice(0, 10) === today);

    if (!needsUs.length && !risks.length && !todaysCalls.length && !systemic.length && !countPending()) {
      return { skipped: 'nic k hlášení' };
    }
    log(`${needsUs.length} na nás, ${risks.length} rizik, ${todaysCalls.length} hovorů`);

    const waiting = countPending();
    const facts = [
      waiting ? `PŘIPRAVENO K ODESLÁNÍ: ${waiting}` : null,
      todaysCalls.length
        ? `DNES: ${todaysCalls.map((c) => `${c.startIso.slice(11, 16)} ${c.clientName || c.title} (${c.host?.name || '?'})`).join(', ')}`
        : 'DNES: žádný hovor',
      '',
      'VYŽADUJE NÁS:',
      ...(needsUs.length
        ? needsUs.map((s) => `- ${s.clientName}: ${s.title} — ${s.detail}`)
        : ['- nic']),
      '',
      'RIZIKO:',
      ...(risks.length ? risks.map((s) => `- ${s.clientName}: ${s.title} — ${s.detail}`) : ['- nic']),
      '',
      ...(systemic.length
        ? ['NAPŘÍČ PORTFOLIEM:', ...systemic.map((s) => `- ${s.title} (${s.count}/${s.total})`)]
        : []),
    ].filter((l) => l !== null).join('\n');

    const result = await runAgent(
      [
        '[TG] Napiš ranní brief pro Tima a Štěpána.',
        '',
        'Tohle jsou spočítané signály z brainu, neověřuj je znovu a nic si nedomýšlej:',
        '',
        facts,
        '',
        'Napiš z toho krátkou zprávu: co je dnes první věc k řešení, co může počkat',
        'a co se dnes děje. Když něco čeká na odklepnutí, zmiň to jednou větou',
        'a řekni, ať se na to mrkne ve Velíně. Drž Beyond hlas',
        '(`system/beyond-hlas.md`). Bez emoji, bez vaty, maximálně deset řádků.',
        'Když je toho málo, napiš málo. Když není nic, napiš jednu větu.',
        '',
        `Tentýž text ulož i do \`workspace/reporty/brief-${today}.md\`.`,
      ].join('\n'),
    );

    return { summary: String(result.text || '').slice(0, 4000) };
  },
};

/* ------------------------------------------------------------------ */
/* 3. prepare the week's calls before they happen                      */
/* ------------------------------------------------------------------ */

/**
 * A brief written ten minutes before a call is a brief nobody reads. These are
 * written the evening before, so they are waiting in the morning.
 */
const prepareCalls = {
  name: 'pripravit-hovory',
  title: 'Připravit briefy na hovory',
  description:
    'Pro každý hovor v příštích 36 hodinách vygeneruje 1-page brief skillem pre-call ' +
    'do workspace/briefy.',
  dailyAt: { hour: 18, minute: 30 },
  async hasWork() {
    const index = await getBrainIndex();
    const calls = await getCalls({ clients: index.clients, people: getPeople() });
    const soon = upcomingWithin(calls.calls, 36);
    return soon.length ? `${soon.length} hovorů do 36 h` : null;
  },
  async run({ log }) {
    const index = await getBrainIndex();
    const calls = await getCalls({ clients: index.clients, people: getPeople(), force: true });
    const soon = upcomingWithin(calls.calls, 36).filter((c) => c.clientSlug);
    if (!soon.length) return { skipped: 'žádný hovor s napojeným klientem' };

    const done = [];
    for (const call of soon) {
      log(`brief na ${call.clientName}`);
      const when = `${call.startIso.slice(0, 10)} ${call.startIso.slice(11, 16)}`;
      const result = await runAgent(
        [
          `Použij skill pre-call na klienta \`${call.clientSlug}\`.`,
          '',
          `Hovor je ${when}, vede ho ${call.host?.name || 'neznámo kdo'}.`,
          '',
          `Výsledný brief ulož do \`workspace/briefy/${call.startIso.slice(0, 10)}-${call.clientSlug}.md\`.`,
          'Nic neodesílej.',
        ].join('\n'),
      );
      done.push(`${call.clientName}: ${String(result.text || '').replace(/\s+/g, ' ').slice(0, 160)}`);
    }
    return { summary: done.join('\n') };
  },
};

function upcomingWithin(calls, hours) {
  const now = Date.now();
  const until = now + hours * 3600_000;
  return calls.filter((c) => {
    const t = Date.parse(c.startIso);
    return Number.isFinite(t) && t > now && t <= until;
  });
}

/* ------------------------------------------------------------------ */
/* 4. weekly: plan against reality                                     */
/* ------------------------------------------------------------------ */

const roadmapCheck = {
  name: 'roadmap-check',
  title: 'Týdenní roadmap check',
  description: 'Porovná u každého aktivního klienta plán s realitou a zapíše snapshot.',
  weeklyAt: { weekday: 1, hour: 8, minute: 0 }, // pondělí
  async run() {
    const result = await runAgent(
      [
        'Použij skill roadmap-check s parametrem `all`.',
        '',
        'U každého aktivního klienta porovnej, kde reálně je, proti jeho roadmapě.',
        'Zapiš snapshot do brainu. Úpravy roadmapy v Notionu jen navrhni,',
        'nezapisuj je tam.',
        '',
        'Na konci shrň, kdo je napřed, kdo v plánu a kdo pozadu.',
      ].join('\n'),
      { timeoutMs: 20 * 60 * 1000 },
    );
    invalidateBrainIndex();
    return { summary: String(result.text || '').slice(0, 4000) };
  },
};

/* ------------------------------------------------------------------ */
/* 5. keep the brain's own housekeeping honest                         */
/* ------------------------------------------------------------------ */

/**
 * The index flags a stale program week on nearly every profile, because the
 * field is only refreshed by hand. It is a one-line fix per client and exactly
 * the kind of chore a person should never be doing.
 */
const tidyProfiles = {
  name: 'srovnat-profily',
  title: 'Srovnat týdny v profilech',
  description:
    'Kde se zapsaný „Aktuální týden" rozešel s datem startu, opraví ho podle kalendáře.',
  weeklyAt: { weekday: 1, hour: 8, minute: 30 },
  async hasWork() {
    const index = await getBrainIndex();
    const stale = index.clients.filter((c) => c.isActive !== false && c.programWeekStale);
    return stale.length ? `${stale.length} profilů mimo` : null;
  },
  async run() {
    const index = await getBrainIndex({ force: true });
    const stale = index.clients.filter((c) => c.isActive !== false && c.programWeekStale);
    if (!stale.length) return { skipped: 'všechny profily sedí' };

    const list = stale
      .map(
        (c) =>
          `- ${c.slug}: v profilu ${c.programWeekStated}, podle startu ${c.startIso} je to W${String(c.programWeek).padStart(2, '0')}`,
      )
      .join('\n');

    const result = await runAgent(
      [
        'V těchhle profilech se pole `**Aktuální týden:**` rozešlo s kalendářem:',
        '',
        list,
        '',
        'U každého oprav jen tohle jedno pole v `clients/aktivni/<slug>/profil.md`',
        'na hodnotu spočítanou z data startu. Poznámku v závorce za týdnem zachovej,',
        'pokud dává pořád smysl. Nic jiného v profilu neměň.',
      ].join('\n'),
    );
    invalidateBrainIndex();
    return { summary: String(result.text || '').slice(0, 2000) };
  },
};

/* ------------------------------------------------------------------ */
/* 6. write the messages, so approving one is a single click           */
/* ------------------------------------------------------------------ */

/**
 * The assistant part. Looks at what the signals say about each client, decides
 * whether a message is actually warranted, and writes it in the Beyond voice.
 * Nothing is sent: each draft waits on the velín until a person clicks.
 *
 * The bar for proposing is deliberately high. A draft that gets rejected costs
 * more attention than it saves, and an assistant who suggests a message every
 * morning is one you stop reading.
 */
const prepareProposals = {
  name: 'napsat-navrhy',
  title: 'Připravit zprávy klientům',
  description:
    'Kde klient klouže nebo se dlouho neozval, napíše návrh zprávy v Beyond hlasu ' +
    'a nechá ho čekat na jedno kliknutí. Neodesílá nic.',
  dailyAt: { hour: 6, minute: 35 },
  async hasWork() {
    const index = await getBrainIndex();
    const calls = await getCalls({ clients: index.clients, people: getPeople() });
    const candidates = await proposalCandidates(index, calls);
    return candidates.length ? `${candidates.length} kandidátů na zprávu` : null;
  },
  async run({ log }) {
    const index = await getBrainIndex({ force: true });
    const calls = await getCalls({ clients: index.clients, people: getPeople() });
    const candidates = await proposalCandidates(index, calls);
    if (!candidates.length) return { skipped: 'nikomu není co psát' };

    const written = [];
    for (const cand of candidates) {
      log(`píšu ${cand.client.name} · ${cand.kind}`);
      const result = await runAgent(
        [
          `Napiš návrh WhatsApp zprávy pro klienta ${cand.client.name}`,
          `(\`clients/aktivni/${cand.client.slug}/\`).`,
          '',
          `Důvod: ${cand.reason}`,
          '',
          'Postup:',
          `1. Přečti si \`clients/aktivni/${cand.client.slug}/profil.md\`, \`flags.md\``,
          '   a posledních pár bloků z `whatsapp.md` a `cally.md`, ať víš, kde klient je',
          '   a co se naposledy řešilo.',
          '2. Přečti `system/beyond-hlas.md`. To je zdroj pravdy pro tón.',
          '3. Napiš jednu zprávu. Krátkou. Konkrétní k tomu, co je otevřené,',
          '   ne obecné „jak to jde".',
          '',
          'Pravidla: žádné emoji, žádné pomlčky, tykání, bez vaty a bez',
          'marketingového nádechu. Vejdi se do pěti řádků.',
          '',
          'Ber ohled na to, co je ve `flags.md` citlivé.',
          '',
          'Odpověz POUZE textem té zprávy. Žádný úvod, žádné vysvětlení,',
          'žádné uvozovky kolem. Co napíšeš, to se pošle.',
        ].join('\n'),
      );

      const body = String(result.text || '').trim();
      if (!body || body.length < 15) {
        log(`${cand.client.name}: model nevrátil použitelný text, přeskakuji`);
        continue;
      }
      const created = createProposal({
        kind: cand.kind,
        clientSlug: cand.client.slug,
        clientName: cand.client.name,
        channel: 'whatsapp',
        target: cand.client.waGroupId,
        title: cand.title,
        body,
        reason: cand.reason,
      });
      if (created.skipped) {
        log(`${cand.client.name}: ${created.skipped}`);
      } else {
        written.push(`${cand.client.name} — ${cand.title}`);
      }
    }
    if (!written.length) return { skipped: 'nic nového k odklepnutí' };
    return { summary: `Čeká na odklepnutí:\n${written.map((w) => `- ${w}`).join('\n')}` };
  },
};

/**
 * Who is worth writing to today, and why.
 *
 * Only clients we can actually reach (a WhatsApp group in the profile), who do
 * not already have a draft waiting, and who have not heard from us in the last
 * three days. Everything else is left alone.
 */
async function proposalCandidates(index, calls) {
  const pending = slugsWithPending();
  const { rows } = inbox(index.clients, { upcomingCalls: calls.calls });
  const out = [];

  for (const row of rows) {
    const c = row.client;
    if (c.isActive === false) continue;
    if (!c.waGroupId) continue;
    if (pending.has(c.slug)) continue;
    if (sentRecently(c.slug, 72)) continue;

    const quiet = row.signals.find((s) => s.type === 'quiet');
    const overdue = row.signals.find((s) => s.type === 'their-overdue');

    if (overdue) {
      out.push({
        client: c,
        kind: 'pripomenuti',
        title: 'Připomenout otevřený slib',
        reason: `${overdue.detail}. Připomeň konkrétně to, co visí, a zeptej se, co ho brzdí.`,
      });
    } else if (quiet) {
      out.push({
        client: c,
        kind: 'ozvat-se',
        title: 'Ozvat se po tichu',
        reason: `${quiet.detail}. Ozvi se, navaž na poslední téma, nedělej z toho výslech.`,
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */

export const JOBS = [
  processCall,
  syncClients,
  prepareProposals,
  morningBrief,
  prepareCalls,
  roadmapCheck,
  tidyProfiles,
];

export function jobByName(name) {
  return JOBS.find((j) => j.name === name) || null;
}

/** Is this job due right now? Daily and weekly jobs fire once per period. */
export function isDue(job, now = new Date()) {
  if (job.everyMs) {
    const state = getJobState(job.name);
    if (!state.lastRunAt) return true;
    return Date.now() - Date.parse(state.lastRunAt) >= job.everyMs;
  }
  if (job.dailyAt) {
    if (ranToday(job.name)) return false;
    return (
      now.getHours() > job.dailyAt.hour ||
      (now.getHours() === job.dailyAt.hour && now.getMinutes() >= job.dailyAt.minute)
    );
  }
  if (job.weeklyAt) {
    if (now.getDay() !== job.weeklyAt.weekday) return false;
    if (ranToday(job.name)) return false;
    return (
      now.getHours() > job.weeklyAt.hour ||
      (now.getHours() === job.weeklyAt.hour && now.getMinutes() >= job.weeklyAt.minute)
    );
  }
  return false;
}

export { markJobRan, resolveBrainPath, fs, path };

import { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Switch } from '../ui';
import {
  DNY,
  KDY_MOZNOSTI,
  behDatum,
  behMarkdown,
  behPopis,
  kdyZRozvrhu,
  rozvrhZKdy,
  type Kdy,
  type KdyVolba,
  type Rutina,
  type RutinaDetail,
  type RutinaSablona,
} from '../../../rutiny';

import { createRutina, deleteRutina, fetchRutina, fetchRutiny, patchRutina, runRutina } from './api';
import { Empty, usePolled } from './bits';

/**
 * Beyond Brain — routines.
 *
 * Jobs a person set up for themselves: run on a schedule or after every call,
 * tell them through a push, and leave their output here. The Agent screen stays
 * the place for everything else the box runs.
 */

type FormState = { title: string; prompt: string; notion: boolean; kdy: KdyVolba };

const EMPTY: FormState = { title: '', prompt: '', notion: false, kdy: { kdy: 'pracovni', time: '08:00', weekday: 1 } };

function RoutineDialog({
  routine,
  initial,
  onClose,
  onSaved,
}: {
  routine: Rutina | null;
  initial: FormState;
  onClose: () => void;
  onSaved: (name: string | null) => void;
}) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { kdy, time, weekday } = form.kdy;
  const update = (patch: Partial<KdyVolba>) => setForm((current) => ({ ...current, kdy: { ...current.kdy, ...patch } }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const schedule = rozvrhZKdy(form.kdy);
      const body = { title: form.title, prompt: form.prompt, notion: form.notion, ...(schedule ? { schedule } : {}) };
      const saved = routine
        ? await patchRutina(routine.name, body)
        : await createRutina({ ...body, schedule: schedule || { kind: 'manual' } });
      onSaved(saved.rutina.name);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!routine || !window.confirm(`Smazat rutinu ${routine.title}?`)) return;
    setBusy(true);
    try {
      await deleteRutina(routine.name);
      onSaved(null);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="bb-dialog__scrim" onClick={onClose}>
      <div
        className="bb-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={routine ? 'Upravit rutinu' : 'Nová rutina'}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="bb-dialog__head">{routine ? 'Upravit rutinu' : 'Nová rutina'}</div>
        <div className="bb-dialog__body bb-rut__form">
          <label>
            <span className="bb-section__label">Název</span>
            <input
              className="bb-field"
              value={form.title}
              autoFocus={!routine}
              placeholder="Ranní přehled"
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
          </label>
          <label>
            <span className="bb-section__label">Co má brain udělat</span>
            <textarea
              className="bb-field"
              rows={8}
              value={form.prompt}
              placeholder="Napiš to stejně, jako bys to napsal do chatu"
              onChange={(event) => setForm({ ...form, prompt: event.target.value })}
            />
          </label>
          <div className="bb-rut__when">
            <label>
              <span className="bb-section__label">Spouštět</span>
              <select className="bb-field" value={kdy} onChange={(event) => update({ kdy: event.target.value as Kdy })}>
                {kdy === 'jine' ? <option value="jine">Vlastní rozvrh</option> : null}
                {KDY_MOZNOSTI.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {kdy === 'tyden' ? (
              <label>
                <span className="bb-section__label">Den</span>
                <select
                  className="bb-field"
                  value={String(weekday)}
                  onChange={(event) => update({ weekday: Number(event.target.value) })}
                >
                  {DNY.map((day) => (
                    <option key={day.value} value={day.value}>
                      {day.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {kdy === 'denne' || kdy === 'pracovni' || kdy === 'tyden' ? (
              <label>
                <span className="bb-section__label">Čas</span>
                <input
                  className="bb-field"
                  type="time"
                  value={time}
                  onChange={(event) => update({ time: event.target.value || time })}
                />
              </label>
            ) : null}
          </div>
          <div className="bb-rut__switch">
            <span>Smí číst Notion</span>
            <Switch on={form.notion} label="Smí číst Notion" onChange={(notion) => setForm({ ...form, notion })} />
          </div>
          {error ? <p className="bb-rut__error">{error}</p> : null}
          <div className="bb-rut__actions">
            {routine ? (
              <button type="button" className="bb-btn-ghost bb-rut__btn" disabled={busy} onClick={() => void remove()}>
                Smazat
              </button>
            ) : null}
            <span />
            <button type="button" className="bb-btn-soft bb-rut__btn" onClick={onClose}>
              Zrušit
            </button>
            <button
              type="button"
              className="bb-btn-primary bb-rut__btn"
              disabled={busy || !form.title.trim() || !form.prompt.trim()}
              onClick={() => void save()}
            >
              Uložit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function fromTemplate(template: RutinaSablona | null): FormState {
  if (!template) return EMPTY;
  return { title: template.title, prompt: template.prompt, notion: false, kdy: kdyZRozvrhu(template.schedule) };
}

export default function RutinyPage() {
  const load = useCallback(() => fetchRutiny(), []);
  const { data, error, reload } = usePolled(load);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<RutinaDetail | null>(null);
  const [dialog, setDialog] = useState<{ routine: Rutina | null; initial: FormState } | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const routines = data?.rutiny || [];
  const current = selected || routines[0]?.name || null;

  useEffect(() => {
    let alive = true;
    setNote(null);
    if (!current) {
      setDetail(null);
      return undefined;
    }
    fetchRutina(current)
      .then((next) => alive && setDetail(next))
      .catch(() => alive && setDetail(null));
    return () => {
      alive = false;
    };
  }, [current, data]);

  const toggle = async (routine: Rutina, enabled: boolean) => {
    await patchRutina(routine.name, { enabled });
    reload();
  };

  const runNow = async (routine: Rutina) => {
    await runRutina(routine.name);
    setNote('Začne do minuty, výsledek přijde notifikací');
  };

  return (
    <div className="bb-vel bb-rut">
      <div className="bb-vel__in">
        <header className="bb-vel__head">
          <div>
            <h1 className="bb-vel__title">Rutiny</h1>
            <p className="bb-vel__sub">Brain je spustí sám a dá ti vědět notifikací</p>
          </div>
          <button type="button" className="bb-btn-primary bb-rut__btn" onClick={() => setChoosing(true)}>
            Nová rutina
          </button>
        </header>
        {data && !data.notifikace ? (
          <p className="bb-rut__hint">
            Notifikace chodí jen do appky na telefonu. Zapneš je v ní ve Více,{' '}
            <a href="/instalace" target="_blank" rel="noreferrer">
              jak ji nainstalovat
            </a>
          </p>
        ) : null}
        {data?.pasmo ? <p className="bb-rut__hint">Časy se řídí telefonem, teď {data.pasmo}</p> : null}
        {error && !data ? <Empty>Rutiny se nenačetly</Empty> : null}
        {routines.length ? (
          <div className="bb-rut__grid">
            <div className="bb-rut__list">
              {routines.map((routine) => (
                <div key={routine.name} className="bb-rut__item" aria-current={routine.name === current}>
                  <button type="button" onClick={() => setSelected(routine.name)} title={routine.title}>
                    <strong>{routine.title}</strong>
                    <small>{routine.enabled ? routine.kdy : `Vypnutá, ${routine.kdy}`}</small>
                  </button>
                  {routine.system ? null : (
                    <Switch
                      on={routine.enabled}
                      label={routine.enabled ? 'Vypnout rutinu' : 'Zapnout rutinu'}
                      onChange={(next) => void toggle(routine, next)}
                    />
                  )}
                </div>
              ))}
            </div>
            {detail ? (
              <section className="bb-rut__detail">
                <div className="bb-rut__detailhead">
                  <h2 title={detail.rutina.title}>{detail.rutina.title}</h2>
                  {detail.rutina.system ? null : (
                    <>
                      <button type="button" className="bb-btn-soft bb-rut__btn" onClick={() => void runNow(detail.rutina)}>
                        Spustit teď
                      </button>
                      <button
                        type="button"
                        className="bb-btn-soft bb-rut__btn"
                        onClick={() =>
                          setDialog({
                            routine: detail.rutina,
                            initial: {
                              title: detail.rutina.title,
                              prompt: detail.rutina.prompt,
                              notion: detail.rutina.notion,
                              kdy: kdyZRozvrhu(detail.rutina.schedule),
                            },
                          })
                        }
                      >
                        Upravit
                      </button>
                    </>
                  )}
                </div>
                {note ? <p className="bb-rut__hint">{note}</p> : null}
                {detail.behy.length ? (
                  detail.behy.map((run) => (
                    <article key={run.id} className="bb-rut__run">
                      <time>{behDatum(run.at)}</time>
                      {run.vystup ? (
                        <div className="bb-rut__md">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{behMarkdown(run.vystup)}</ReactMarkdown>
                        </div>
                      ) : (
                        <p data-quiet>{behPopis(run)}</p>
                      )}
                    </article>
                  ))
                ) : (
                  <Empty>Zatím neběžela</Empty>
                )}
              </section>
            ) : null}
          </div>
        ) : null}
      </div>
      {choosing && data ? (
        <div className="bb-dialog__scrim" onClick={() => setChoosing(false)}>
          <div className="bb-dialog" role="dialog" aria-modal="true" aria-label="Nová rutina" onClick={(e) => e.stopPropagation()}>
            <div className="bb-dialog__head">Nová rutina</div>
            <div className="bb-dialog__body bb-rut__choices">
              {[...data.sablony, null].map((template) => (
                <button
                  key={template?.id || 'vlastni'}
                  type="button"
                  className="bb-option"
                  onClick={() => {
                    setChoosing(false);
                    setDialog({ routine: null, initial: fromTemplate(template) });
                  }}
                >
                  <span>
                    <strong>{template?.title || 'Vlastní'}</strong>
                    <small>{template?.sub || 'Napíšeš, co má brain udělat a kdy'}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {dialog ? (
        <RoutineDialog
          routine={dialog.routine}
          initial={dialog.initial}
          onClose={() => setDialog(null)}
          onSaved={(name) => {
            setDialog(null);
            setSelected(name);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

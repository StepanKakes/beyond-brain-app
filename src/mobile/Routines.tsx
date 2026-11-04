import { useState } from 'react';
import { Button, Switch } from 'glisse';

import {
  DNY,
  KDY_MOZNOSTI,
  behDatum,
  behPopis,
  kdyPopis,
  kdyZRozvrhu,
  rozvrhZKdy,
  type Kdy,
  type KdyVolba,
  type RutinaDetail,
  type RutinaSablona,
  type RutinyList,
} from '../rutiny';

import { api } from './api';
import { back, navigate } from './router';
import { refresh, useResource } from './store';
import { BarButton, Empty, LinkRow, Picker, PushedBar, Section, Sheet, Skeleton, toast } from './ui';

// Rutina je úloha, která běží sama a dá o sobě vědět notifikací. Klepnutí na
// notifikaci otevře detail s posledním výstupem.

const PATH = '/api/beyond/velin/rutiny';
const LIST_KEY = 'rutiny';
const detailKey = (name: string) => `rutina:${name}`;
const detailPath = (name: string) => `${PATH}/${encodeURIComponent(name)}`;

const reload = (name?: string) => {
  void refresh(LIST_KEY, PATH);
  if (name) void refresh(detailKey(name), detailPath(name));
};

const VLASTNI = 'vlastni';

function NewRoutinePicker({ templates, onClose }: { templates: RutinaSablona[]; onClose: () => void }) {
  return (
    <Picker
      title="Nová rutina"
      options={[
        ...templates.map((t) => ({ value: t.id, label: t.title, sub: t.sub })),
        { value: VLASTNI, label: 'Vlastní', sub: 'Napíšeš, co má brain udělat a kdy' },
      ]}
      onPick={(value) => navigate(value === VLASTNI ? '/m/rutina/nova' : `/m/rutina/nova?s=${value}`)}
      onClose={onClose}
    />
  );
}

export function RoutinesScreen() {
  const { data, error } = useResource<RutinyList>(LIST_KEY, PATH);
  const [picking, setPicking] = useState(false);
  const routines = data?.rutiny || [];

  return (
    <>
      <PushedBar
        title="Rutiny"
        action={<BarButton icon="plus" label="Nová rutina" onClick={() => setPicking(true)} />}
      />
      <div className="m-scroll m-pushed-list">
        {data && !data.notifikace ? (
          <p className="m-hint">Zapni si notifikace ve Více, jinak se o výsledku rutiny nedozvíš</p>
        ) : null}
        {routines.length ? (
          <Section>
            {routines.map((routine) => (
              <LinkRow
                key={routine.name}
                icon="clock"
                title={routine.title}
                sub={routine.kdy}
                value={routine.enabled ? undefined : 'Vypnutá'}
                onClick={() => navigate(`/m/rutina/${encodeURIComponent(routine.name)}`)}
              />
            ))}
          </Section>
        ) : data ? (
          <Empty title="Zatím žádná rutina">
            <p>Brain může každé ráno nebo po každém hovoru sám sepsat přehled a dát ti vědět</p>
            <Button onClick={() => setPicking(true)}>Nastavit první</Button>
          </Empty>
        ) : error ? (
          <Empty title="Rutiny se nenačetly">{error}</Empty>
        ) : (
          <Skeleton />
        )}
      </div>
      {picking && data ? <NewRoutinePicker templates={data.sablony} onClose={() => setPicking(false)} /> : null}
    </>
  );
}

export function RoutineScreen({ name }: { name: string }) {
  const { data, error } = useResource<RutinaDetail>(detailKey(name), detailPath(name));
  const routine = data?.rutina;

  const toggle = async (enabled: boolean) => {
    try {
      await api(detailPath(name), { method: 'PATCH', body: { enabled } });
      reload(name);
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const runNow = async () => {
    try {
      await api(`${detailPath(name)}/spustit`, { method: 'POST', body: {} });
      toast('Začne do minuty, výsledek přijde notifikací');
    } catch (err) {
      toast((err as Error).message);
    }
  };

  return (
    <>
      <PushedBar
        title={routine?.title || 'Rutina'}
        action={
          routine ? (
            <BarButton
              icon="compose"
              label="Upravit"
              onClick={() => navigate(`/m/rutina/${encodeURIComponent(name)}/upravit`)}
            />
          ) : undefined
        }
      />
      <div className="m-scroll m-pushed-list">
        {routine ? (
          <>
            <Section>
              <div className="m-row m-row-setting">
                <span className="m-row-title">
                  Zapnutá
                  <small className="m-rutina-kdy">{routine.kdy}</small>
                </span>
                <Switch
                  aria-label="Zapnutá"
                  checked={routine.enabled}
                  onCheckedChange={(on) => void toggle(on)}
                />
              </div>
              <LinkRow title="Spustit teď" onClick={() => void runNow()} />
            </Section>
            <Section title="Výstupy">
              {data.behy.length ? (
                data.behy.map((run) => (
                  <article key={run.id} className="m-rutina-beh">
                    <time>{behDatum(run.at)}</time>
                    <p className={run.vystup ? undefined : 'is-quiet'}>{behPopis(run)}</p>
                  </article>
                ))
              ) : (
                <p className="m-rutina-prazdno">Zatím neběžela</p>
              )}
            </Section>
          </>
        ) : error ? (
          <Empty title="Rutina se nenačetla">{error}</Empty>
        ) : (
          <Skeleton />
        )}
      </div>
    </>
  );
}

export function RoutineFormScreen({ name, template }: { name: string | null; template: string | null }) {
  const list = useResource<RutinyList>(LIST_KEY, PATH);
  const detail = useResource<RutinaDetail>(name ? detailKey(name) : 'rutina:nova', name ? detailPath(name) : PATH);

  if (name) {
    if (!detail.data?.rutina) {
      return (
        <>
          <PushedBar title="Upravit rutinu" />
          <div className="m-scroll m-pushed-list">
            <Skeleton />
          </div>
        </>
      );
    }
    const { rutina } = detail.data;
    return (
      <RoutineForm
        name={name}
        initial={{ title: rutina.title, prompt: rutina.prompt, notion: rutina.notion, kdy: kdyZRozvrhu(rutina.schedule) }}
      />
    );
  }

  if (template && !list.data) {
    return (
      <>
        <PushedBar title="Nová rutina" />
        <div className="m-scroll m-pushed-list">
          <Skeleton />
        </div>
      </>
    );
  }
  const preset = list.data?.sablony.find((t) => t.id === template);
  return (
    <RoutineForm
      name={null}
      initial={{
        title: preset?.title || '',
        prompt: preset?.prompt || '',
        notion: false,
        kdy: preset ? kdyZRozvrhu(preset.schedule) : { kdy: 'pracovni', time: '08:00', weekday: 1 },
      }}
    />
  );
}

type FormState = { title: string; prompt: string; notion: boolean; kdy: KdyVolba };

function RoutineForm({ name, initial }: { name: string | null; initial: FormState }) {
  const [form, setForm] = useState(initial);
  const [picking, setPicking] = useState<'kdy' | 'den' | null>(null);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const { kdy } = form.kdy;

  const update = (patch: Partial<KdyVolba>) => setForm((current) => ({ ...current, kdy: { ...current.kdy, ...patch } }));

  const save = async () => {
    setBusy(true);
    try {
      const schedule = rozvrhZKdy(form.kdy);
      const body = { title: form.title, prompt: form.prompt, notion: form.notion, ...(schedule ? { schedule } : {}) };
      if (name) await api(detailPath(name), { method: 'PATCH', body });
      else await api(PATH, { method: 'POST', body });
      reload(name || undefined);
      back();
    } catch (err) {
      toast((err as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!name) return;
    setBusy(true);
    try {
      await api(detailPath(name), { method: 'DELETE' });
      void refresh(LIST_KEY, PATH);
      // Formulář a detail, pod nimi seznam rutin.
      back();
      back();
    } catch (err) {
      toast((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <PushedBar title={name ? 'Upravit rutinu' : 'Nová rutina'} />
      <div className="m-scroll m-pushed-list m-rutina-form">
        <label>
          <span>Název</span>
          <input
            className="m-input"
            value={form.title}
            placeholder="Ranní přehled"
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
        </label>
        <label>
          <span>Co má brain udělat</span>
          <textarea
            className="m-textarea"
            value={form.prompt}
            placeholder="Napiš to stejně, jako bys to napsal do chatu"
            onChange={(event) => setForm({ ...form, prompt: event.target.value })}
          />
        </label>
        <Section title="Kdy">
          <LinkRow title="Spouštět" value={kdyPopis(form.kdy)} onClick={() => setPicking('kdy')} />
          {kdy === 'tyden' ? (
            <LinkRow
              title="Den"
              value={DNY.find((d) => d.value === String(form.kdy.weekday))?.label}
              onClick={() => setPicking('den')}
            />
          ) : null}
          {kdy === 'denne' || kdy === 'pracovni' || kdy === 'tyden' ? (
            <label className="m-row m-row-setting">
              <span className="m-row-title">Čas</span>
              <input
                className="m-rutina-cas"
                type="time"
                value={form.kdy.time}
                onChange={(event) => update({ time: event.target.value || form.kdy.time })}
              />
            </label>
          ) : null}
        </Section>
        <Section>
          <div className="m-row m-row-setting">
            <span className="m-row-title">Smí číst Notion</span>
            <Switch
              aria-label="Smí číst Notion"
              checked={form.notion}
              onCheckedChange={(on) => setForm({ ...form, notion: on })}
            />
          </div>
        </Section>
        <div className="m-sheet-actions">
          <Button disabled={busy || !form.title.trim() || !form.prompt.trim()} onClick={() => void save()}>
            Uložit
          </Button>
        </div>
        {name ? (
          <Section>
            <LinkRow title="Smazat rutinu" danger onClick={() => setRemoving(true)} />
          </Section>
        ) : null}
      </div>
      {picking === 'kdy' ? (
        <Picker
          title="Spouštět"
          value={kdy}
          options={KDY_MOZNOSTI}
          onPick={(value) => update({ kdy: value as Kdy })}
          onClose={() => setPicking(null)}
        />
      ) : null}
      {picking === 'den' ? (
        <Picker
          title="Den"
          value={String(form.kdy.weekday)}
          options={DNY}
          onPick={(value) => update({ weekday: Number(value) })}
          onClose={() => setPicking(null)}
        />
      ) : null}
      {removing ? (
        <Sheet title="Smazat rutinu" onClose={() => setRemoving(false)}>
          <p className="m-hint">Přestane běžet a její výstupy tu už neuvidíš</p>
          <div className="m-sheet-actions">
            <Button destructive disabled={busy} onClick={() => void remove()}>
              Smazat
            </Button>
          </div>
        </Sheet>
      ) : null}
    </>
  );
}

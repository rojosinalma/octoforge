import type { Instance, Settings as SettingsT } from '@octoforge/shared';
import { Settings as SettingsSchema } from '@octoforge/shared';
import { type FormEvent, useState } from 'react';
import { type SaveFn, Ui, useConfirm } from 'tailor-react';
import { api } from '../api';
import { Icon, Loading, Page, Section } from '../components/Page';
import { useApp } from '../hooks/useApp';
import { useAsync } from '../hooks/useAsync';
import { useToast } from '../hooks/useToast';

type NumberKey = {
  [K in keyof SettingsT]: SettingsT[K] extends number ? K : never;
}[keyof SettingsT];

/** Stored unit of a duration setting, as seconds per stored step. */
const UNIT_SECONDS = { s: 1, min: 60, ms: 0.001 } as const;
type DurationUnit = keyof typeof UNIT_SECONDS;

type Spec =
  | { kind: 'duration'; unit: DurationUnit }
  | { kind: 'number'; unit: string }
  | { kind: 'text'; placeholder: string };

const SPECS: Partial<Record<keyof SettingsT, Spec>> = {
  siblingsResendMin: { kind: 'duration', unit: 'min' },
  secretTtlMin: { kind: 'duration', unit: 'min' },
  secretStoreMax: { kind: 'number', unit: 'items' },
  patExpiresDays: { kind: 'number', unit: 'days' },
  githubOrg: { kind: 'text', placeholder: 'my-org' },
  pgMemberHost: { kind: 'text', placeholder: 'db.example.com:5432' },
  adoptTimeoutSec: { kind: 'duration', unit: 's' },
  requestTimeoutMs: { kind: 'duration', unit: 'ms' },
  manifestCacheMin: { kind: 'duration', unit: 'min' },
  indexRefreshSec: { kind: 'duration', unit: 's' },
  logKeepDays: { kind: 'number', unit: 'days' },
  logPageSize: { kind: 'number', unit: 'rows' },
};

function range(k: NumberKey): { min: number; max: number } {
  const inner = (
    SettingsSchema.shape[k] as unknown as { removeDefault(): { minValue: number; maxValue: number } }
  ).removeDefault();
  return { min: inner.minValue, max: inner.maxValue };
}

/** `90 s`, `5 min`, `24 h`: a stored duration value in words. */
function humanSeconds(seconds: number): string {
  if (seconds >= 3600 && seconds % 3600 === 0) return `${seconds / 3600} h`;
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}

const toSeconds = (stored: number, unit: DurationUnit) => Math.round(stored * UNIT_SECONDS[unit]);

/** Turns the text a settings row sends into the stored value, or a reason why it cannot be saved. */
function parse(key: keyof SettingsT, raw: string): { value: string | number } | { error: string } {
  const spec = SPECS[key];
  if (!spec) return { error: `Unknown setting ${key}` };
  if (spec.kind === 'text') return { value: raw.trim() };
  const n = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(n)) return { error: 'Enter a number' };
  const { min, max } = range(key as NumberKey);
  if (spec.kind === 'number') {
    if (!Number.isInteger(n) || n < min || n > max) return { error: `Whole number from ${min} to ${max}` };
    return { value: n };
  }
  const stored = n / UNIT_SECONDS[spec.unit];
  const words = `from ${humanSeconds(toSeconds(min, spec.unit))} to ${humanSeconds(toSeconds(max, spec.unit))}`;
  if (!Number.isInteger(stored))
    return { error: `Whole ${spec.unit === 'min' ? 'minutes' : 'seconds'}, ${words}` };
  if (stored < min || stored > max) return { error: `Pick a value ${words}` };
  return { value: stored };
}

/** One auto-saved row: duration (with unit select), number (with unit) or text. */
function Row({ k, label, help }: { k: keyof SettingsT; label: string; help: string }) {
  const { settings } = useApp();
  const spec = SPECS[k];
  if (!spec) return null;
  const id = `s-${k}`;
  const stored = settings[k];
  let control: React.ReactNode;
  if (spec.kind === 'duration') {
    control = (
      <Ui.DurationInput
        id={id}
        label={label}
        size="sm"
        data-setting={k}
        defaultValue={toSeconds(stored as number, spec.unit)}
      />
    );
  } else if (spec.kind === 'number') {
    const { min, max } = range(k as NumberKey);
    control = (
      <Ui.InputGroup data-size="sm">
        <Ui.Input
          id={id}
          type="number"
          size="sm"
          min={min}
          max={max}
          step={1}
          data-setting={k}
          defaultValue={String(stored)}
        />
        <Ui.InputAddon>{spec.unit}</Ui.InputAddon>
      </Ui.InputGroup>
    );
  } else {
    control = (
      <Ui.Input
        id={id}
        size="sm"
        data-setting={k}
        defaultValue={String(stored)}
        placeholder={spec.placeholder}
      />
    );
  }
  return (
    <Ui.SettingsRow
      label={label}
      htmlFor={id}
      help={{ tone: 'info', label: `About ${label.toLowerCase()}`, children: <p>{help}</p> }}
    >
      {control}
    </Ui.SettingsRow>
  );
}

const PUBLIC_URL_HELP = 'Where GitHub and browsers reach this instance, if different from the URL above.';

/** Sets or clears the public URL of an existing instance. */
function PublicUrlDialog({
  inst,
  onSave,
  onClose,
}: {
  inst: Instance;
  onSave: (publicUrl: string | null) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(inst.publicUrl ?? '');
  return (
    <Ui.Dialog
      open
      id="public-url"
      title={`Public URL of ${inst.label || inst.baseUrl}`}
      onClose={onClose}
      footer={
        <>
          <Ui.Button type="button" data-dialog-close="">
            Cancel
          </Ui.Button>
          <Ui.Button type="submit" form="public-url-form" variant="primary">
            Save
          </Ui.Button>
        </>
      }
    >
      <Ui.Form
        id="public-url-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(value.trim() || null);
        }}
      >
        <Ui.Field
          label="Public URL"
          hint={`Where GitHub and browsers reach this instance, if different from ${inst.baseUrl}. Empty = the address the member reports, else the base URL.`}
        >
          <Ui.Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={inst.baseUrl}
            type="url"
            autoFocus
          />
        </Ui.Field>
      </Ui.Form>
    </Ui.Dialog>
  );
}

function Instances() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const members = useAsync(() => api.members(), 'members');
  const instances = useAsync(() => api.instances(), 'instances');
  const names = members.data?.map((m) => m.name) ?? [];
  const [member, setMember] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [publicUrl, setPublicUrl] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Instance | null>(null);
  const chosen = member || names[0] || '';

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!chosen || !baseUrl.trim()) return;
    setBusy(true);
    try {
      const r = await api.addInstance(chosen, baseUrl.trim(), label.trim(), publicUrl.trim() || null);
      instances.setData((all) => [...(all ?? []), r.instance]);
      setBaseUrl('');
      setPublicUrl('');
      setLabel('');
      toast(r.message);
    } catch (err) {
      toast('Instance not added', { description: (err as Error).message, variant: 'critical' });
    } finally {
      setBusy(false);
    }
  };

  const savePublicUrl = async (inst: Instance, next: string | null) => {
    setEditing(null);
    if (next === inst.publicUrl) return;
    const before = instances.data;
    const shown = next?.replace(/\/+$/, '') ?? null;
    instances.setData((all) => (all ?? []).map((i) => (i.id === inst.id ? { ...i, publicUrl: shown } : i)));
    try {
      const r = await api.setPublicUrl(inst.id, next);
      instances.setData((all) => (all ?? []).map((i) => (i.id === inst.id ? r.instance : i)));
      toast(r.message);
    } catch (err) {
      instances.setData(before);
      toast('Public URL not saved', { description: (err as Error).message, variant: 'critical' });
    }
  };

  const remove = async (inst: Instance) => {
    const ok = await confirm(
      'Remove instance?',
      `Octoforge stops watching ${inst.baseUrl}. The instance itself keeps running and keeps its credentials.`,
      { label: 'Remove' },
    );
    if (!ok) return;
    const before = instances.data;
    instances.setData((all) => (all ?? []).filter((i) => i.id !== inst.id));
    try {
      await api.removeInstance(inst.id);
      toast('Instance removed', { description: inst.baseUrl });
    } catch (err) {
      instances.setData(before);
      toast('Instance not removed', { description: (err as Error).message, variant: 'critical' });
    }
  };

  const list = instances.data ?? [];
  return (
    <Section title="Instances" id="instances">
      <p className="t-muted">
        Base URLs of running members. Octoforge reads their manifest and health, and delivers credentials and
        database settings to them. A public URL is where GitHub sends webhooks, when the base URL is only
        reachable on your network.
      </p>
      {list.length > 0 ? (
        <Ui.Table.Wrap>
          <Ui.Table variant="data">
            <thead>
              <tr>
                <th>Member</th>
                <th>Base URL</th>
                <th>Public URL</th>
                <th>Label</th>
                <th className="t-col-actions">
                  <span className="t-visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((i) => (
                <tr key={i.id}>
                  <td className="t-mono">{i.member}</td>
                  <td>
                    <a href={i.baseUrl} target="_blank" rel="noreferrer">
                      {i.baseUrl}
                    </a>
                  </td>
                  <td>
                    {i.publicUrl ? (
                      <a href={i.publicUrl} target="_blank" rel="noreferrer">
                        {i.publicUrl}
                      </a>
                    ) : (
                      <span className="t-muted">not set</span>
                    )}
                  </td>
                  <td>{i.label || <span className="t-muted">none</span>}</td>
                  <td className="t-col-actions">
                    <Ui.Button
                      type="button"
                      iconOnly
                      variant="ghost"
                      size="sm"
                      aria-label={`Edit public URL of ${i.baseUrl}`}
                      tip="Edit public URL"
                      tipAt="left"
                      onClick={() => setEditing(i)}
                    >
                      <Icon name="pencil" />
                    </Ui.Button>
                    <Ui.Button
                      type="button"
                      iconOnly
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${i.baseUrl}`}
                      tip="Remove"
                      tipAt="left"
                      onClick={() => void remove(i)}
                    >
                      <Icon name="trash" />
                    </Ui.Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Ui.Table>
        </Ui.Table.Wrap>
      ) : (
        !instances.loading && (
          <Ui.EmptyState size="sm" icon="bi-box-seam" title="No instance yet">
            <p>Every member shows as not deployed. Add the first one below.</p>
          </Ui.EmptyState>
        )
      )}
      <Ui.Form className="instance-form" onSubmit={(e) => void add(e)}>
        <Ui.Field label="Member">
          <Ui.Select value={chosen} onChange={(e) => setMember(e.target.value)} disabled={!names.length}>
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Ui.Select>
        </Ui.Field>
        <Ui.Field label="Base URL" hint="Where Octoforge calls the member API.">
          <Ui.Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://tool.example.com"
            type="url"
            required
          />
        </Ui.Field>
        <Ui.Field label="Public URL" hint={PUBLIC_URL_HELP}>
          <Ui.Input
            value={publicUrl}
            onChange={(e) => setPublicUrl(e.target.value)}
            placeholder="optional"
            type="url"
          />
        </Ui.Field>
        <Ui.Field label="Label">
          <Ui.Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="optional" />
        </Ui.Field>
        <Ui.Button type="submit" busy={busy} disabled={!chosen || !baseUrl.trim()}>
          <Icon name="plus-lg" /> {busy ? 'Adding…' : 'Add'}
        </Ui.Button>
      </Ui.Form>
      {editing && (
        <PublicUrlDialog
          inst={editing}
          onSave={(next) => void savePublicUrl(editing, next)}
          onClose={() => setEditing(null)}
        />
      )}
    </Section>
  );
}

/** Schedule of the sibling list and a manual push. */
function Switcher() {
  const { capabilities } = useApp();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const missing = !capabilities
    ? null
    : !capabilities.memberToken
      ? 'OCTOFORGE_TOKEN'
      : !capabilities.publicUrl
        ? 'PUBLIC_URL'
        : null;
  const sendNow = async () => {
    setBusy(true);
    try {
      const r = await api.sendSiblings();
      toast('Sibling list sent', {
        description: r.message,
        variant: r.run.failed ? 'warning' : 'success',
      });
    } catch (err) {
      toast('Sibling list not sent', { description: (err as Error).message, variant: 'critical' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p className="t-muted">
        Octoforge sends every instance the list of tools (Octoforge and one address per member), so each tool
        can link to the others. It sends the list when an instance changes, at start-up and on the schedule
        below.
      </p>
      <Row
        k="siblingsResendMin"
        label="Resend sibling list"
        help="Time between two pushes, so a restarted member gets its switcher back (5 min to 24 h)."
      />
      <Ui.SettingsRow
        label="Send now"
        help={{
          tone: 'info',
          label: 'About send now',
          children: (
            <p>
              {missing
                ? `Set ${missing} in .env to send the list.`
                : 'Sends the list to every instance at once. Also retries instances that had no switcher.'}
            </p>
          ),
        }}
      >
        <Ui.Button
          type="button"
          size="sm"
          onClick={() => void sendNow()}
          busy={busy}
          disabled={Boolean(missing)}
        >
          <Icon name="send" /> {busy ? 'Sending…' : 'Send sibling list now'}
        </Ui.Button>
      </Ui.SettingsRow>
    </>
  );
}

const TABS = [
  { id: 'instances', label: 'Instances' },
  { id: 'switcher', label: 'Tool switcher' },
  { id: 'credentials', label: 'Credentials' },
  { id: 'database', label: 'Database' },
  { id: 'network', label: 'Network and display' },
  { id: 'appearance', label: 'Appearance' },
] as const;

export function SettingsPage() {
  const { settingsLoaded, saveSettings } = useApp();
  const save: SaveFn = async (key, raw) => {
    const r = parse(key as keyof SettingsT, raw);
    if ('error' in r) return { ok: false, message: r.error };
    return saveSettings({ [key]: r.value });
  };
  return (
    <Page
      title="Settings"
      lead="Saved at once; every value applies on its next use."
      side={
        <Ui.Sidebar label="Settings sections">
          {TABS.map((t) => (
            <Ui.Sidebar.Item key={t.id} href={`#${t.id}`}>
              {t.label}
            </Ui.Sidebar.Item>
          ))}
        </Ui.Sidebar>
      }
    >
      <Instances />
      {!settingsLoaded ? (
        <Loading>Loading settings…</Loading>
      ) : (
        <Ui.Settings save={save} className="t-stack">
          <Section title="Tool switcher" id="switcher">
            <Switcher />
          </Section>
          <Section title="Credentials" id="credentials">
            <Row
              k="secretTtlMin"
              label="Keep in memory"
              help="How long a created App key, token or role password waits for delivery."
            />
            <Row k="secretStoreMax" label="Waiting at once" help="Upper bound of that memory." />
            <Row
              k="patExpiresDays"
              label="Fine-grained token lifetime"
              help="Pre-filled on GitHub's form; 0 = no expiry."
            />
            <Row
              k="githubOrg"
              label="Organisation"
              help="Offered as owner of new Apps and tokens, next to your personal account."
            />
          </Section>
          <Section title="Database" id="database">
            <Row
              k="pgMemberHost"
              label="Postgres host for members"
              help="Host members connect to. Empty = the host of FORGE_PG_ADMIN_URL."
            />
            <Row
              k="adoptTimeoutSec"
              label="Adoption timeout"
              help="How long the first instance may take to copy its rows."
            />
          </Section>
          <Section title="Network and display" id="network">
            <Row
              k="requestTimeoutMs"
              label="Request timeout"
              help="Every call to an instance or to GitHub (whole seconds)."
            />
            <Row
              k="manifestCacheMin"
              label="Manifest cache"
              help="Reuse of a read manifest; 0 = read it every time."
            />
            <Row k="indexRefreshSec" label="Index refresh" help="Health refresh on the members page." />
            <Row k="logKeepDays" label="Keep log" help="Older delivery and adoption rows are deleted." />
            <Row k="logPageSize" label="Log page" help="Rows per page on the log." />
          </Section>
          <Section title="Appearance" id="appearance">
            <Ui.SettingsRow
              label="Skin"
              help={{
                tone: 'info',
                label: 'About skin',
                children: (
                  <p>
                    The design system the UI wears: Primer, Bootstrap, Pico and more. The sun/moon button in
                    the footer switches dark and light.
                  </p>
                ),
              }}
            >
              <Ui.Pickers parts={['skin']} size="sm" />
            </Ui.SettingsRow>
            <Ui.SettingsRow
              label="Palette"
              help={{
                tone: 'info',
                label: 'About palette',
                children: <p>The colours of the UI. Every palette has a dark and a light mode.</p>,
              }}
            >
              <Ui.Pickers parts={['palette']} size="sm" />
            </Ui.SettingsRow>
          </Section>
        </Ui.Settings>
      )}
    </Page>
  );
}

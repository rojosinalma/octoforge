import type { Instance, Settings as SettingsT, Theme } from '@octoforge/shared';
import { Settings as SettingsSchema } from '@octoforge/shared';
import { PlusIcon, TrashIcon } from '@primer/octicons-react';
import { Button, FormControl, IconButton, Link, Select, TextInput, useConfirm } from '@primer/react';
import { Tooltip } from '@primer/react/next';
import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../api';
import { Page, Section } from '../components/Page';
import { useApp } from '../hooks/useApp';
import { useAsync } from '../hooks/useAsync';
import { useToast } from '../hooks/useToast';
import { THEME_LABELS, THEMES } from '../theme';

type NumberKey = {
  [K in keyof SettingsT]: SettingsT[K] extends number ? K : never;
}[keyof SettingsT];

/** Number with a fixed unit; saves on blur or Enter, clamped to the schema range. */
function NumberSetting({
  k,
  label,
  unit,
  help,
  scale = 1,
}: {
  k: NumberKey;
  label: string;
  unit: string;
  help: string;
  /** Stored value = shown value × scale (seconds shown, milliseconds stored). */
  scale?: number;
}) {
  const { settings, updateSettings } = useApp();
  const stored = settings[k];
  const [value, setValue] = useState(String(stored / scale));
  useEffect(() => setValue(String(stored / scale)), [stored, scale]);
  const shape = SettingsSchema.shape[k] as unknown as {
    removeDefault(): { minValue: number; maxValue: number };
  };
  const inner = shape.removeDefault();
  const commit = () => {
    const n = Number(value);
    if (!Number.isFinite(n)) return setValue(String(stored / scale));
    const next = Math.round(Math.min(inner.maxValue, Math.max(inner.minValue, n * scale)));
    setValue(String(next / scale));
    if (next !== stored) void updateSettings({ [k]: next });
  };
  return (
    <FormControl>
      <FormControl.Label>{label}</FormControl.Label>
      <TextInput
        type="number"
        min={inner.minValue / scale}
        max={inner.maxValue / scale}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        trailingVisual={unit}
        className="number-input"
      />
      <FormControl.Caption>{help}</FormControl.Caption>
    </FormControl>
  );
}

/** Free text for genuinely new values (an organisation name, a host); saves on blur or Enter. */
function TextSetting({
  k,
  label,
  help,
  placeholder,
}: {
  k: 'githubOrg' | 'pgMemberHost';
  label: string;
  help: string;
  placeholder: string;
}) {
  const { settings, updateSettings } = useApp();
  const [value, setValue] = useState(settings[k]);
  useEffect(() => setValue(settings[k]), [settings, k]);
  const commit = () => {
    const v = value.trim();
    if (v !== settings[k]) void updateSettings({ [k]: v });
  };
  return (
    <FormControl>
      <FormControl.Label>{label}</FormControl.Label>
      <TextInput
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        block
      />
      <FormControl.Caption>{help}</FormControl.Caption>
    </FormControl>
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
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const chosen = member || names[0] || '';

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!chosen || !baseUrl.trim()) return;
    setBusy(true);
    try {
      const r = await api.addInstance(chosen, baseUrl.trim(), label.trim());
      instances.setData((all) => [...(all ?? []), r.instance]);
      setBaseUrl('');
      setLabel('');
      toast(r.message);
    } catch (err) {
      toast('Instance not added', { description: (err as Error).message, variant: 'critical' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (inst: Instance) => {
    const ok = await confirm({
      title: 'Remove instance?',
      content: `Octoforge stops watching ${inst.baseUrl}. The instance itself keeps running and keeps its credentials.`,
      confirmButtonContent: 'Remove',
      confirmButtonType: 'danger',
    });
    if (!ok) return;
    const before = instances.data;
    instances.setData((all) => (all ?? []).filter((i) => i.id !== inst.id));
    try {
      await api.removeInstance(inst.id);
    } catch (err) {
      instances.setData(before);
      toast('Instance not removed', { description: (err as Error).message, variant: 'critical' });
    }
  };

  const list = instances.data ?? [];
  return (
    <Section title="Instances">
      <p className="fg-muted section-lead">
        Base URLs of running members. Octoforge reads their manifest and health, and delivers credentials and
        database settings to them.
      </p>
      {list.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Base URL</th>
              <th>Label</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {list.map((i) => (
              <tr key={i.id}>
                <td className="mono">{i.member}</td>
                <td>
                  <Link href={i.baseUrl} target="_blank" rel="noreferrer">
                    {i.baseUrl}
                  </Link>
                </td>
                <td>{i.label || <span className="fg-muted">none</span>}</td>
                <td className="cell-actions">
                  <Tooltip text="Remove" direction="w">
                    <IconButton
                      icon={TrashIcon}
                      aria-label={`Remove ${i.baseUrl}`}
                      variant="invisible"
                      size="small"
                      onClick={() => void remove(i)}
                    />
                  </Tooltip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        !instances.loading && <p className="fg-muted">No instance yet: every member shows as not deployed.</p>
      )}
      <form className="instance-form" onSubmit={(e) => void add(e)}>
        <FormControl>
          <FormControl.Label>Member</FormControl.Label>
          <Select value={chosen} onChange={(e) => setMember(e.target.value)} disabled={!names.length}>
            {names.map((n) => (
              <Select.Option key={n} value={n}>
                {n}
              </Select.Option>
            ))}
          </Select>
        </FormControl>
        <FormControl required>
          <FormControl.Label>Base URL</FormControl.Label>
          <TextInput
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://tool.example.com"
            type="url"
            block
          />
        </FormControl>
        <FormControl>
          <FormControl.Label>Label</FormControl.Label>
          <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="optional" block />
        </FormControl>
        <Button type="submit" leadingVisual={PlusIcon} disabled={busy || !chosen || !baseUrl.trim()}>
          {busy ? 'Adding…' : 'Add'}
        </Button>
      </form>
    </Section>
  );
}

export function SettingsPage() {
  const { settings, updateSettings } = useApp();
  return (
    <Page title="Settings" lead="Saved at once; every value applies on its next use.">
      <Instances />
      <Section title="Credentials">
        <div className="settings-grid">
          <NumberSetting
            k="secretTtlMin"
            label="Keep in memory"
            unit="min"
            help="How long a created App key, token or role password waits for delivery."
          />
          <NumberSetting
            k="secretStoreMax"
            label="Waiting at once"
            unit="items"
            help="Upper bound of that memory."
          />
          <NumberSetting
            k="patExpiresDays"
            label="Fine-grained token lifetime"
            unit="days"
            help="Pre-filled on GitHub's form; 0 = no expiry."
          />
          <TextSetting
            k="githubOrg"
            label="Organisation"
            placeholder="my-org"
            help="Offered as owner of new Apps and tokens, next to your personal account."
          />
        </div>
      </Section>
      <Section title="Database">
        <div className="settings-grid">
          <TextSetting
            k="pgMemberHost"
            label="Postgres host for members"
            placeholder="db.example.com:5432"
            help="Host members connect to. Empty = the host of FORGE_PG_ADMIN_URL."
          />
          <NumberSetting
            k="adoptTimeoutSec"
            label="Adoption timeout"
            unit="s"
            help="How long the first instance may take to copy its rows."
          />
        </div>
      </Section>
      <Section title="Network and display">
        <div className="settings-grid">
          <NumberSetting
            k="requestTimeoutMs"
            label="Request timeout"
            unit="s"
            scale={1000}
            help="Every call to an instance or to GitHub."
          />
          <NumberSetting
            k="manifestCacheMin"
            label="Manifest cache"
            unit="min"
            help="Reuse of a read manifest."
          />
          <NumberSetting
            k="indexRefreshSec"
            label="Index refresh"
            unit="s"
            help="Health refresh on the members page."
          />
          <NumberSetting
            k="logKeepDays"
            label="Keep log"
            unit="days"
            help="Older delivery and adoption rows are deleted."
          />
          <NumberSetting k="logPageSize" label="Log page" unit="rows" help="Rows per page on the log." />
          <FormControl>
            <FormControl.Label>Theme</FormControl.Label>
            <Select
              value={settings.theme}
              onChange={(e) => void updateSettings({ theme: e.target.value as Theme }, { silent: true })}
            >
              {THEMES.map((t) => (
                <Select.Option key={t} value={t}>
                  {THEME_LABELS[t]}
                </Select.Option>
              ))}
            </Select>
          </FormControl>
        </div>
      </Section>
    </Page>
  );
}

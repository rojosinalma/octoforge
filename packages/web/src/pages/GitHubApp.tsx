import type { InstanceStatus, SharedAppView } from '@octoforge/shared';
import {
  AlertIcon,
  CheckIcon,
  KeyIcon,
  LinkExternalIcon,
  PaperAirplaneIcon,
  SyncIcon,
  TrashIcon,
} from '@primer/octicons-react';
import {
  Banner,
  Button,
  Checkbox,
  FormControl,
  Label,
  Link,
  Select,
  Spinner,
  Textarea,
  TextInput,
  useConfirm,
} from '@primer/react';
import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../api';
import { Page, Section, StatusDot } from '../components/Page';
import { useApp } from '../hooks/useApp';
import { useAsync } from '../hooks/useAsync';
import { useToast } from '../hooks/useToast';
import { hostOf, publicUrlSourceLabel, relativeTime, sourceLabel } from '../lib/format';
import { linkClick, navigate, useRoute } from '../router';
import { Owner, postToGitHub } from './Credentials';

type View = SharedAppView;
type AppFacts = NonNullable<View['app']>;
const err = (e: unknown) => (e as Error).message;
const spin = () => <Spinner size="small" srText={null} />;

function Missing({ list, prefix = 'missing' }: { list: string[]; prefix?: string }) {
  if (!list.length) return null;
  return (
    <Label variant="attention">
      {prefix}: {list.join(', ')}
    </Label>
  );
}

function AppFactsBox({ app, view, onView }: { app: AppFacts; view: View; onView: (v: View | null) => void }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const recheck = async () => {
    setBusy(true);
    try {
      const r = await api.recheckSharedApp();
      onView(r.view);
      toast(r.message, { variant: r.view.matrix.appMissing.length ? 'warning' : 'success' });
    } catch (e) {
      toast('Not re-checked', { description: err(e), variant: 'critical' });
    } finally {
      setBusy(false);
    }
  };
  const forgetKey = async () => {
    onView({ ...view, key: null });
    try {
      await api.discardSharedKey();
    } catch (e) {
      onView(view);
      toast('Key not forgotten', { description: err(e), variant: 'critical' });
    }
  };
  const forgetApp = async () => {
    const ok = await confirm({
      title: 'Forget the shared App?',
      content: `Octoforge drops what it knows about ${app.slug}. The App stays on GitHub and in the members that use it.`,
      confirmButtonContent: 'Forget',
      confirmButtonType: 'danger',
    });
    if (!ok) return;
    onView(null);
    try {
      await api.forgetSharedApp();
    } catch (e) {
      onView(view);
      toast('Not forgotten', { description: err(e), variant: 'critical' });
    }
  };
  return (
    <div className="card-box stack">
      <div className="pending-head">
        <KeyIcon />
        <strong>
          {app.name} <span className="mono">{app.slug}</span> (id {app.id})
        </strong>
        <Link href={app.htmlUrl} target="_blank" rel="noreferrer" className="icon-link">
          <LinkExternalIcon size={14} /> On GitHub
        </Link>
      </div>
      <div className="facts">
        <div>
          <span className="fg-muted">Owner</span>
          <div>
            {app.owner ?? '?'} ({app.ownerType === 'Organization' ? 'organisation' : 'personal account'})
          </div>
        </div>
        <div>
          <span className="fg-muted">Installations</span>
          <div>{app.installations.map((i) => i.account).join(', ') || 'none yet'}</div>
        </div>
        <div>
          <span className="fg-muted">Events</span>
          <div className="label-row">
            {app.events.length ? app.events.map((e) => <Label key={e}>{e}</Label>) : <span>none</span>}
          </div>
        </div>
        <div>
          <span className="fg-muted">Read from GitHub</span>
          <div>{relativeTime(app.checkedAt)}</div>
        </div>
        <div>
          <span className="fg-muted">Key</span>
          <div>
            {view.key
              ? `in memory, expires ${relativeTime(view.key.expiresAt)}${view.key.hasWebhookSecret ? '' : ' (no webhook secret)'}`
              : 'not in memory'}
          </div>
        </div>
      </div>
      <div className="button-row">
        <Button
          onClick={() => void recheck()}
          leadingVisual={busy ? spin : SyncIcon}
          disabled={busy || !view.key}
        >
          Re-check
        </Button>
        <Button
          as="a"
          href={app.installUrl}
          target="_blank"
          rel="noreferrer"
          leadingVisual={LinkExternalIcon}
        >
          Install on another account
        </Button>
        <span className="spacer" />
        {view.key && (
          <Button variant="invisible" leadingVisual={TrashIcon} onClick={() => void forgetKey()}>
            Forget the key
          </Button>
        )}
        <Button variant="invisible" leadingVisual={TrashIcon} onClick={() => void forgetApp()}>
          Forget the App
        </Button>
      </div>
      {!view.key && (
        <p className="fg-muted small">
          Re-check and delivery need the key: paste it again under <strong>Use an existing App</strong>.
        </p>
      )}
    </div>
  );
}

function cell(level: string | null, gap: boolean) {
  return <td className={gap ? 'matrix-gap' : level ? '' : 'fg-muted'}>{level ?? '–'}</td>;
}

function Matrix({ view }: { view: View }) {
  const { matrix, members } = view;
  const installs = view.app?.installations ?? [];
  if (!matrix.rows.length) return <p className="fg-muted">No member asks for an App permission.</p>;
  return (
    <div className="table-scroll">
      <table className="table matrix">
        <thead>
          <tr>
            <th>Permission</th>
            <th>App</th>
            {installs.map((i) => (
              <th key={i.id}>
                {i.account}
                <span className="th-note">installation</span>
              </th>
            ))}
            {members.map((m) => (
              <th key={m.name}>
                {m.title}
                <span className="th-note">needs</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((r) => (
            <tr key={r.permission}>
              <td className="mono">{r.permission}</td>
              {view.app ? cell(r.app.level, r.app.gap) : <td className="fg-muted">?</td>}
              {r.installations.map((c, i) => (
                <td key={installs[i]?.id ?? i} className={c.gap ? 'matrix-gap' : c.level ? '' : 'fg-muted'}>
                  {c.level ?? '–'}
                </td>
              ))}
              {r.members.map((c, i) => (
                <td key={members[i]?.name ?? i} className={c.gap ? 'matrix-gap' : c.level ? '' : 'fg-muted'}>
                  {c.level ?? '–'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What to do on GitHub when the App or an installation lacks a permission. */
function UpdatePath({ app, view, onView }: { app: AppFacts; view: View; onView: (v: View) => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const add = view.matrix.appMissing;
  const pendingInstalls = app.installations.filter(
    (i) => (view.matrix.installationMissing[i.id] ?? []).length,
  );
  if (!add.length && !pendingInstalls.length) {
    return (
      <p className="fg-success">
        <CheckIcon /> The App and every installation grant what the members need.
      </p>
    );
  }
  const recheck = async () => {
    setBusy(true);
    try {
      const r = await api.recheckSharedApp();
      onView(r.view);
      toast(r.message, { variant: r.view.matrix.appMissing.length ? 'warning' : 'success' });
    } catch (e) {
      toast('Not re-checked', { description: err(e), variant: 'critical' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card-box stack">
      <strong>Update the App (no new App needed)</strong>
      <ol className="steps">
        {add.length > 0 && (
          <li>
            <div>
              On GitHub, add these permissions to <span className="mono">{app.slug}</span> and save:
            </div>
            <div className="label-row">
              {add.map((p) => (
                <Label key={p} variant="attention">
                  {p}
                </Label>
              ))}
            </div>
            <div>
              <Button
                as="a"
                href={app.permissionsUrl}
                target="_blank"
                rel="noreferrer"
                size="small"
                leadingVisual={LinkExternalIcon}
              >
                Edit permissions on GitHub
              </Button>
            </div>
          </li>
        )}
        <li>
          <div>Each installation accepts the new permissions on its own page:</div>
          <ul className="result-list">
            {app.installations.map((i) => {
              const miss = view.matrix.installationMissing[i.id] ?? [];
              return (
                <li key={i.id} className="cell-inline">
                  <Link href={i.settingsUrl} target="_blank" rel="noreferrer" className="icon-link">
                    <LinkExternalIcon size={14} /> {i.account}
                  </Link>
                  {miss.length ? (
                    <Missing list={miss} prefix="not accepted" />
                  ) : (
                    <span className="fg-success small">up to date</span>
                  )}
                </li>
              );
            })}
          </ul>
        </li>
        <li>
          <div>Then read the App again.</div>
          <div>
            <Button
              size="small"
              onClick={() => void recheck()}
              leadingVisual={busy ? spin : SyncIcon}
              disabled={busy || !view.key}
            >
              Re-check
            </Button>
            {!view.key && <span className="fg-muted small"> Needs the key in memory.</span>}
          </div>
        </li>
      </ol>
    </div>
  );
}

function UseExisting({ onView }: { onView: (v: View) => void }) {
  const { toast } = useToast();
  const [appId, setAppId] = useState('');
  const [key, setKey] = useState('');
  const [hook, setHook] = useState('');
  const [busy, setBusy] = useState(false);
  const id = Number(appId);
  const valid = Number.isInteger(id) && id > 0 && key.trim().length > 0;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      const r = await api.registerSharedApp({ appId: id, privateKey: key, webhookSecret: hook || undefined });
      setKey('');
      setHook('');
      onView(r.view);
      toast(r.message, { variant: 'success' });
    } catch (e2) {
      toast('App not accepted', { description: err(e2), variant: 'critical' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card-box stack" onSubmit={(e) => void submit(e)} autoComplete="off">
      <div className="form-row">
        <FormControl required>
          <FormControl.Label>App id</FormControl.Label>
          <TextInput
            type="number"
            min={1}
            inputMode="numeric"
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            block
          />
          <FormControl.Caption>On the App's settings page on GitHub, under "About".</FormControl.Caption>
        </FormControl>
        <FormControl>
          <FormControl.Label>Webhook secret</FormControl.Label>
          <TextInput
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={hook}
            onChange={(e) => setHook(e.target.value)}
            block
          />
          <FormControl.Caption>
            Optional: only the member that receives the webhooks needs it.
          </FormControl.Caption>
        </FormControl>
      </div>
      <FormControl required>
        <FormControl.Label>Private key</FormControl.Label>
        <Textarea
          value={key}
          onChange={(e) => setKey(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          rows={4}
          block
          resize="vertical"
          className="secret-area"
          placeholder="-----BEGIN RSA PRIVATE KEY-----"
        />
        <FormControl.Caption>
          The .pem file GitHub generated; a one-line value with \n works too. Octoforge checks it against
          GitHub and keeps it in memory only, until it is delivered or expires.
        </FormControl.Caption>
      </FormControl>
      <div>
        <Button
          type="submit"
          variant="primary"
          leadingVisual={busy ? spin : CheckIcon}
          disabled={busy || !valid}
        >
          Check with GitHub
        </Button>
      </div>
    </form>
  );
}

function CreateShared({ view }: { view: View }) {
  const { capabilities } = useApp();
  const { toast } = useToast();
  const [name, setName] = useState('Octoforge');
  const [org, setOrg] = useState('');
  const hookMember = view.union.webhook?.member ?? null;
  const instances = useAsync(() => api.instances(), 'instances');
  const candidates = (instances.data ?? []).filter((i) => i.member === hookMember);
  const hookStatus = useAsync(
    () => (hookMember ? api.status(hookMember) : Promise.resolve([] as InstanceStatus[])),
    `status:${hookMember}`,
  );
  const [instanceId, setInstanceId] = useState<number | null>(null);
  useEffect(() => {
    if (instanceId === null && candidates[0]) setInstanceId(candidates[0].id);
  }, [candidates, instanceId]);
  const [busy, setBusy] = useState(false);
  const target = candidates.find((i) => i.id === instanceId);
  const reported = hookStatus.data?.find((s) => s.instance.id === instanceId)?.status?.public_url;
  const hookBase = target ? (target.publicUrl ?? reported ?? target.baseUrl).replace(/\/+$/, '') : null;
  const hookSource = target ? (target.publicUrl ? 'instance' : reported ? 'member' : 'base') : null;
  const blocked = view.union.error
    ? view.union.error
    : !capabilities?.publicUrl
      ? 'PUBLIC_URL is not set: GitHub needs it to send you back here.'
      : hookMember && !candidates.length
        ? `Add an instance of ${hookMember} first: the App sends its webhooks there.`
        : null;
  const start = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.createSharedApp({ name: name.trim(), org: org || null, instanceId });
      postToGitHub(r.action, r.manifest);
    } catch (e2) {
      setBusy(false);
      toast('Cannot start', { description: err(e2), variant: 'critical' });
    }
  };
  const perms = Object.entries(view.union.permissions);
  return (
    <form className="card-box stack" onSubmit={(e) => void start(e)}>
      <p className="fg-muted small section-lead">
        The App asks for every permission any member needs (the highest level wins) and every event.
      </p>
      <div className="facts">
        <div>
          <span className="fg-muted">Permissions</span>
          <div className="label-row">
            {perms.length ? perms.map(([p, l]) => <Label key={p}>{`${p}: ${l}`}</Label>) : <span>none</span>}
          </div>
        </div>
        <div>
          <span className="fg-muted">Events</span>
          <div className="label-row">
            {view.union.events.length ? (
              view.union.events.map((ev) => <Label key={ev}>{ev}</Label>)
            ) : (
              <span>none</span>
            )}
          </div>
        </div>
      </div>
      <div className="form-row">
        <FormControl required>
          <FormControl.Label>App name</FormControl.Label>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={34} block />
          <FormControl.Caption>Unique across GitHub, at most 34 characters.</FormControl.Caption>
        </FormControl>
        <Owner value={org} onChange={setOrg} />
        {hookMember && (
          <FormControl>
            <FormControl.Label>Webhooks go to ({hookMember})</FormControl.Label>
            <Select
              value={String(instanceId ?? '')}
              onChange={(e) => setInstanceId(Number(e.target.value))}
              disabled={!candidates.length}
            >
              {candidates.map((i) => (
                <Select.Option key={i.id} value={String(i.id)}>
                  {i.label || hostOf(i.baseUrl)}
                </Select.Option>
              ))}
            </Select>
            {hookBase && hookSource && view.union.webhook && (
              <FormControl.Caption>
                <span className="mono">
                  {hookBase}
                  {view.union.webhook.path}
                </span>{' '}
                ({publicUrlSourceLabel(hookSource)})
              </FormControl.Caption>
            )}
          </FormControl>
        )}
      </div>
      {blocked && (
        <Banner variant="warning" title="Not possible yet" description={blocked} layout="compact" />
      )}
      <div>
        <Button
          type="submit"
          variant="primary"
          leadingVisual={busy ? spin : LinkExternalIcon}
          disabled={busy || Boolean(blocked) || !name.trim()}
        >
          Create on GitHub
        </Button>
      </div>
    </form>
  );
}

function Deliver({ view, onDelivered }: { view: View; onDelivered: () => void }) {
  const { toast } = useToast();
  const app = view.app;
  const names = view.members.map((m) => m.name);
  const statuses = useAsync(
    async () => (await Promise.all(names.map((n) => api.status(n)))).flat(),
    `shared-status:${names.join(',')}`,
  );
  const all = statuses.data ?? [];
  const [picked, setPicked] = useState<Record<number, boolean>>({});
  const selected = all.filter((s) => picked[s.instance.id] ?? s.ok).map((s) => s.instance.id);
  const [installId, setInstallId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<
    Record<number, { ok: boolean; message: string; restart: boolean | null }>
  >({});
  if (!app) return null;
  const toggle = (id: number) => setPicked((p) => ({ ...p, [id]: !selected.includes(id) }));
  const deliver = async () => {
    setBusy(true);
    try {
      const r = await api.deliverSharedApp(selected, installId);
      setResults(
        Object.fromEntries(
          r.results.map((x) => [x.instance.id, { ok: x.ok, message: x.message, restart: x.restartRequired }]),
        ),
      );
      toast(r.message, { variant: r.cleared ? 'success' : 'warning' });
      onDelivered();
      void statuses.reload();
    } catch (e) {
      toast('Delivery failed', { description: err(e), variant: 'critical' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card-box stack">
      {!view.key && (
        <Banner
          variant="info"
          title="The key is not in memory"
          description="Paste it under Use an existing App to deliver the App."
          layout="compact"
        />
      )}
      {app.installations.length > 0 && (
        <FormControl>
          <FormControl.Label>Installation</FormControl.Label>
          <Select
            value={String(installId ?? '')}
            onChange={(e) => setInstallId(e.target.value ? Number(e.target.value) : null)}
          >
            <Select.Option value="">Let each member find it</Select.Option>
            {app.installations.map((i) => (
              <Select.Option key={i.id} value={String(i.id)}>
                {i.account} ({i.accountType}, {i.id})
              </Select.Option>
            ))}
          </Select>
        </FormControl>
      )}
      <fieldset className="checks">
        <legend className="fg-muted">Deliver to</legend>
        {statuses.loading && !statuses.data && <Spinner size="small" />}
        {view.members.map((m) => {
          const rows = all.filter((s) => s.instance.member === m.name);
          return (
            <div key={m.name} className="deliver-member">
              <div className="cell-inline">
                <strong>{m.title}</strong>
                <Missing list={m.missing} />
              </div>
              {rows.map((s) => {
                const g = s.status?.github;
                const r = results[s.instance.id];
                const current = !s.ok
                  ? (s.error ?? 'no answer')
                  : g?.mode === 'app'
                    ? `App ${String(g.app_id) === String(app.id) ? app.slug : (g.app_id ?? '?')} (${sourceLabel(g.source)})`
                    : g?.mode
                      ? `token (${sourceLabel(g.source)})`
                      : 'none';
                return (
                  <FormControl key={s.instance.id} layout="horizontal">
                    <Checkbox
                      checked={selected.includes(s.instance.id)}
                      onChange={() => toggle(s.instance.id)}
                    />
                    <FormControl.Label>
                      <span className="cell-inline">
                        <StatusDot up={s.ok} label={s.ok ? 'answers' : 'no answer'} />
                        {s.instance.label || hostOf(s.instance.baseUrl)}
                        <span className={s.ok ? 'fg-muted result-note' : 'fg-danger result-note'}>
                          {current}
                        </span>
                        {g?.missing && <Missing list={g.missing} prefix="reports missing" />}
                      </span>
                      {r && (
                        <span className={r.ok ? 'fg-success result-note' : 'fg-danger result-note'}>
                          {r.ok ? <CheckIcon size={14} /> : <AlertIcon size={14} />} {r.message}
                          {r.restart ? ' (restart required)' : ''}
                        </span>
                      )}
                    </FormControl.Label>
                  </FormControl>
                );
              })}
              {statuses.data && !rows.length && (
                <span className="fg-muted small">
                  No instance.{' '}
                  <Link href="/settings" onClick={linkClick('/settings')}>
                    Add one in Settings
                  </Link>
                </span>
              )}
            </div>
          );
        })}
      </fieldset>
      <div className="button-row">
        <Button
          variant="primary"
          leadingVisual={busy ? spin : PaperAirplaneIcon}
          disabled={busy || !selected.length || !view.key}
          onClick={() => void deliver()}
        >
          Deliver
        </Button>
        <Link href="/log" onClick={linkClick('/log')} className="small">
          Delivery log
        </Link>
      </div>
    </div>
  );
}

export function GitHubAppPage() {
  const { capabilities } = useApp();
  const { toast } = useToast();
  const route = useRoute();
  const state = useAsync(() => api.sharedApp(), 'shared-app');
  const view = state.data;
  const created = route.query.get('created');
  const error = route.query.get('error');
  useEffect(() => {
    if (!created && !error) return;
    if (created) toast('GitHub App created', { description: 'Install it, then deliver it to the members.' });
    if (error) toast('GitHub App not created', { description: error, variant: 'critical', ttlMs: 12_000 });
    navigate('/github-app', { replace: true });
  }, [created, error, toast]);

  const setView = (v: View | null) => (v ? state.setData(v) : void state.reload());
  const app = view?.app ?? null;
  const forms = view && (
    <>
      <Section title="Use an existing App">
        <UseExisting onView={setView} />
      </Section>
      {!app && (
        <Section title="Create the shared App">
          <CreateShared view={view} />
        </Section>
      )}
    </>
  );

  return (
    <Page
      title="GitHub App"
      lead="One GitHub App for every member. Octoforge compares what it grants with what each member needs and hands it over."
    >
      {state.error && <p className="fg-danger">{state.error.message}</p>}
      {capabilities && !capabilities.memberToken && (
        <Banner
          variant="warning"
          title="OCTOFORGE_TOKEN is not set"
          description="Octoforge cannot talk to the member API, so it cannot deliver the App."
        />
      )}
      {!view && state.loading && <Spinner size="small" />}
      {view && (
        <>
          <Section title="The App">
            {app ? (
              <AppFactsBox app={app} view={view} onView={setView} />
            ) : (
              <p className="fg-muted">No shared App yet: use an existing one or create it below.</p>
            )}
          </Section>
          {!app && forms}
          <Section title="Permissions">
            <Matrix view={view} />
            {app && <UpdatePath app={app} view={view} onView={setView} />}
          </Section>
          {app && (
            <Section title="Deliver to members">
              <Deliver view={view} onDelivered={() => void state.reload()} />
            </Section>
          )}
          {app && forms}
          {view.others.length > 0 && (
            <Section title="Members without an App">
              <ul className="result-list">
                {view.others.map((o) => (
                  <li key={o.name}>
                    <Link
                      href={`/members/${o.name}/credentials`}
                      onClick={linkClick(`/members/${o.name}/credentials`)}
                    >
                      {o.title}
                    </Link>{' '}
                    <span className="fg-muted">{o.reason}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </Page>
  );
}

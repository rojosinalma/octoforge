import type { InstanceStatus, SharedAppView } from '@octoforge/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { Ui, useConfirm } from 'tailor-react';
import { api } from '../api';
import { Icon, LinkButton, Loading, Page, Section, StatusDot } from '../components/Page';
import { useApp } from '../hooks/useApp';
import { useAsync } from '../hooks/useAsync';
import { useToast } from '../hooks/useToast';
import { hostOf, publicUrlSourceLabel, relativeTime, sourceLabel } from '../lib/format';
import { linkClick, navigate, useRoute } from '../router';
import { Notice, Owner, postToGitHub } from './Credentials';

type View = SharedAppView;
type AppFacts = NonNullable<View['app']>;
const err = (e: unknown) => (e as Error).message;
const spin = () => <Ui.Spinner size="sm" label={null} />;

function Missing({ list, prefix = 'missing' }: { list: string[]; prefix?: string }) {
  if (!list.length) return null;
  return (
    <Ui.Badge tone="warning">
      {prefix}: {list.join(', ')}
    </Ui.Badge>
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
    const ok = await confirm(
      'Forget the shared App?',
      `Octoforge drops what it knows about ${app.slug}. The App stays on GitHub and in the members that use it.`,
      { label: 'Forget' },
    );
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
    <Ui.Card>
      <Ui.Card.Header>
        <Ui.Card.Title>
          <Icon name="key" />
          <span>
            {app.name} <span className="t-mono">{app.slug}</span> (id {app.id})
          </span>
        </Ui.Card.Title>
        <Ui.Card.Tools>
          <a href={app.htmlUrl} target="_blank" rel="noreferrer" className="icon-link">
            <Icon name="box-arrow-up-right" /> On GitHub
          </a>
        </Ui.Card.Tools>
      </Ui.Card.Header>
      <Ui.Card.Body className="t-stack">
        <Ui.Facts>
          <dt>Owner</dt>
          <dd>
            {app.owner ?? '?'} ({app.ownerType === 'Organization' ? 'organisation' : 'personal account'})
          </dd>
          <dt>Installations</dt>
          <dd>{app.installations.map((i) => i.account).join(', ') || 'none yet'}</dd>
          <dt>Events</dt>
          <dd className="label-row">
            {app.events.length ? app.events.map((e) => <Ui.Badge key={e}>{e}</Ui.Badge>) : <span>none</span>}
          </dd>
          <dt>Read from GitHub</dt>
          <dd>{relativeTime(app.checkedAt)}</dd>
          <dt>Key</dt>
          <dd>
            {view.key
              ? `in memory, expires ${relativeTime(view.key.expiresAt)}${view.key.hasWebhookSecret ? '' : ' (no webhook secret)'}`
              : 'not in memory'}
          </dd>
        </Ui.Facts>
        <Ui.Cluster gap="2">
          <Ui.Button type="button" onClick={() => void recheck()} busy={busy} disabled={!view.key}>
            {busy ? spin() : <Icon name="arrow-repeat" />} Re-check
          </Ui.Button>
          <LinkButton href={app.installUrl} external icon="box-arrow-up-right">
            Install on another account
          </LinkButton>
          <span className="spacer" />
          {view.key && (
            <Ui.Button type="button" variant="ghost" onClick={() => void forgetKey()}>
              <Icon name="trash" /> Forget the key
            </Ui.Button>
          )}
          <Ui.Button type="button" variant="ghost" onClick={() => void forgetApp()}>
            <Icon name="trash" /> Forget the App
          </Ui.Button>
        </Ui.Cluster>
        {!view.key && (
          <p className="t-muted t-small">
            Re-check and delivery need the key: paste it again under <strong>Use an existing App</strong>.
          </p>
        )}
      </Ui.Card.Body>
    </Ui.Card>
  );
}

function cell(level: string | null, gap: boolean) {
  return <td className={gap ? 'matrix-gap' : level ? undefined : 't-muted'}>{level ?? '–'}</td>;
}

function Matrix({ view }: { view: View }) {
  const { matrix, members } = view;
  const installs = view.app?.installations ?? [];
  if (!matrix.rows.length) return <p className="t-muted">No member asks for an App permission.</p>;
  return (
    <Ui.Table.Wrap>
      <Ui.Table variant="data" className="matrix">
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
              <td className="t-mono">{r.permission}</td>
              {view.app ? cell(r.app.level, r.app.gap) : <td className="t-muted">?</td>}
              {r.installations.map((c, i) => (
                <td
                  key={installs[i]?.id ?? i}
                  className={c.gap ? 'matrix-gap' : c.level ? undefined : 't-muted'}
                >
                  {c.level ?? '–'}
                </td>
              ))}
              {r.members.map((c, i) => (
                <td
                  key={members[i]?.name ?? i}
                  className={c.gap ? 'matrix-gap' : c.level ? undefined : 't-muted'}
                >
                  {c.level ?? '–'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Ui.Table>
    </Ui.Table.Wrap>
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
        <Icon name="check-lg" /> The App and every installation grant what the members need.
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
    <Ui.Card>
      <Ui.Card.Header>
        <Ui.Card.Title>Update the App (no new App needed)</Ui.Card.Title>
      </Ui.Card.Header>
      <Ui.Card.Body>
        <ol className="steps">
          {add.length > 0 && (
            <li>
              <div>
                On GitHub, add these permissions to <span className="t-mono">{app.slug}</span> and save:
              </div>
              <div className="label-row">
                {add.map((p) => (
                  <Ui.Badge key={p} tone="warning">
                    {p}
                  </Ui.Badge>
                ))}
              </div>
              <div>
                <LinkButton href={app.permissionsUrl} external size="sm" icon="box-arrow-up-right">
                  Edit permissions on GitHub
                </LinkButton>
              </div>
            </li>
          )}
          <li>
            <div>Each installation accepts the new permissions on its own page:</div>
            <ul className="result-list t-plain-list">
              {app.installations.map((i) => {
                const miss = view.matrix.installationMissing[i.id] ?? [];
                return (
                  <li key={i.id} className="cell-inline">
                    <a href={i.settingsUrl} target="_blank" rel="noreferrer" className="icon-link">
                      <Icon name="box-arrow-up-right" /> {i.account}
                    </a>
                    {miss.length ? (
                      <Missing list={miss} prefix="not accepted" />
                    ) : (
                      <span className="fg-success t-small">up to date</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
          <li>
            <div>Then read the App again.</div>
            <div>
              <Ui.Button
                type="button"
                size="sm"
                onClick={() => void recheck()}
                busy={busy}
                disabled={!view.key}
              >
                {busy ? spin() : <Icon name="arrow-repeat" />} Re-check
              </Ui.Button>
              {!view.key && <span className="t-muted t-small"> Needs the key in memory.</span>}
            </div>
          </li>
        </ol>
      </Ui.Card.Body>
    </Ui.Card>
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
    <Ui.Card>
      <Ui.Form className="t-card-body t-stack" onSubmit={(e) => void submit(e)} autoComplete="off">
        <div className="form-row">
          <Ui.Field label="App id" hint={'On the App\'s settings page on GitHub, under "About".'}>
            <Ui.Input
              type="number"
              min={1}
              inputMode="numeric"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              required
            />
          </Ui.Field>
          <Ui.Field
            label="Webhook secret"
            hint="Optional: only the member that receives the webhooks needs it."
          >
            <Ui.Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={hook}
              onChange={(e) => setHook(e.target.value)}
            />
          </Ui.Field>
        </div>
        <Ui.Field
          label="Private key"
          hint="The .pem file GitHub generated; a one-line value with \n works too. Octoforge checks it against GitHub and keeps it in memory only, until it is delivered or expires."
        >
          <Ui.Textarea
            value={key}
            onChange={(e) => setKey(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            rows={4}
            required
            className="secret-area"
            placeholder="-----BEGIN RSA PRIVATE KEY-----"
          />
        </Ui.Field>
        <div>
          <Ui.Button type="submit" variant="primary" busy={busy} disabled={!valid}>
            {busy ? spin() : <Icon name="check-lg" />} Check with GitHub
          </Ui.Button>
        </div>
      </Ui.Form>
    </Ui.Card>
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
    <Ui.Card>
      <Ui.Form className="t-card-body t-stack" onSubmit={(e) => void start(e)}>
        <p className="t-muted t-small">
          The App asks for every permission any member needs (the highest level wins) and every event.
        </p>
        <Ui.Facts>
          <dt>Permissions</dt>
          <dd className="label-row">
            {perms.length ? (
              perms.map(([p, l]) => <Ui.Badge key={p}>{`${p}: ${l}`}</Ui.Badge>)
            ) : (
              <span>none</span>
            )}
          </dd>
          <dt>Events</dt>
          <dd className="label-row">
            {view.union.events.length ? (
              view.union.events.map((ev) => <Ui.Badge key={ev}>{ev}</Ui.Badge>)
            ) : (
              <span>none</span>
            )}
          </dd>
        </Ui.Facts>
        <div className="form-row">
          <Ui.Field label="App name" hint="Unique across GitHub, at most 34 characters.">
            <Ui.Input value={name} onChange={(e) => setName(e.target.value)} maxLength={34} required />
          </Ui.Field>
          <Owner value={org} onChange={setOrg} />
          {hookMember && (
            <Ui.Field
              label={`Webhooks go to (${hookMember})`}
              hint={
                hookBase && hookSource && view.union.webhook ? (
                  <>
                    <span className="t-mono">
                      {hookBase}
                      {view.union.webhook.path}
                    </span>{' '}
                    ({publicUrlSourceLabel(hookSource)})
                  </>
                ) : undefined
              }
            >
              <Ui.Select
                value={String(instanceId ?? '')}
                onChange={(e) => setInstanceId(Number(e.target.value))}
                disabled={!candidates.length}
              >
                {candidates.map((i) => (
                  <option key={i.id} value={String(i.id)}>
                    {i.label || hostOf(i.baseUrl)}
                  </option>
                ))}
              </Ui.Select>
            </Ui.Field>
          )}
        </div>
        {blocked && <Notice tone="warning" title="Not possible yet" text={blocked} />}
        <div>
          <Ui.Button type="submit" variant="primary" busy={busy} disabled={Boolean(blocked) || !name.trim()}>
            {busy ? spin() : <Icon name="box-arrow-up-right" />} Create on GitHub
          </Ui.Button>
        </div>
      </Ui.Form>
    </Ui.Card>
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
    <Ui.Card>
      <Ui.Card.Body className="t-stack">
        {!view.key && (
          <Notice
            tone="info"
            title="The key is not in memory"
            text="Paste it under Use an existing App to deliver the App."
          />
        )}
        {app.installations.length > 0 && (
          <Ui.Field label="Installation">
            <Ui.Select
              value={String(installId ?? '')}
              onChange={(e) => setInstallId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Let each member find it</option>
              {app.installations.map((i) => (
                <option key={i.id} value={String(i.id)}>
                  {i.account} ({i.accountType}, {i.id})
                </option>
              ))}
            </Ui.Select>
          </Ui.Field>
        )}
        <Ui.Check.Group legend="Deliver to">
          {statuses.loading && !statuses.data && <Loading />}
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
                    <Ui.Check
                      key={s.instance.id}
                      checked={selected.includes(s.instance.id)}
                      onChange={() => toggle(s.instance.id)}
                      label={
                        <>
                          <span className="cell-inline">
                            <StatusDot up={s.ok} label={s.ok ? 'answers' : 'no answer'} />
                            {s.instance.label || hostOf(s.instance.baseUrl)}
                            <span className={s.ok ? 't-muted result-note' : 'fg-danger result-note'}>
                              {current}
                            </span>
                            {g?.missing && <Missing list={g.missing} prefix="reports missing" />}
                          </span>
                          {r && (
                            <span className={r.ok ? 'fg-success result-note' : 'fg-danger result-note'}>
                              <Icon name={r.ok ? 'check-lg' : 'exclamation-triangle'} /> {r.message}
                              {r.restart ? ' (restart required)' : ''}
                            </span>
                          )}
                        </>
                      }
                    />
                  );
                })}
                {statuses.data && !rows.length && (
                  <span className="t-muted t-small">
                    No instance.{' '}
                    <a href="/settings" onClick={linkClick('/settings')}>
                      Add one in Settings
                    </a>
                  </span>
                )}
              </div>
            );
          })}
        </Ui.Check.Group>
        <Ui.Cluster gap="2">
          <Ui.Button
            type="button"
            variant="primary"
            busy={busy}
            disabled={!selected.length || !view.key}
            onClick={() => void deliver()}
          >
            {busy ? spin() : <Icon name="send" />} Deliver
          </Ui.Button>
          <a href="/log" onClick={linkClick('/log')} className="t-small">
            Delivery log
          </a>
        </Ui.Cluster>
      </Ui.Card.Body>
    </Ui.Card>
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
        <Notice
          tone="warning"
          title="OCTOFORGE_TOKEN is not set"
          text="Octoforge cannot talk to the member API, so it cannot deliver the App."
        />
      )}
      {!view && state.loading && <Loading />}
      {view && (
        <>
          <Section title="The App">
            {app ? (
              <AppFactsBox app={app} view={view} onView={setView} />
            ) : (
              <p className="t-muted">No shared App yet: use an existing one or create it below.</p>
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
              <ul className="result-list t-plain-list">
                {view.others.map((o) => (
                  <li key={o.name}>
                    <a
                      href={`/members/${o.name}/credentials`}
                      onClick={linkClick(`/members/${o.name}/credentials`)}
                    >
                      {o.title}
                    </a>{' '}
                    <span className="t-muted">{o.reason}</span>
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

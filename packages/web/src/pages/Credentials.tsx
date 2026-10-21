import {
  classicTokenUrl,
  fineGrainedTokenUrl,
  type Installation,
  type Instance,
  type InstanceStatus,
  type Manifest,
  type MemberCard,
  type PendingCredential,
  resolvePublicUrl,
} from '@octoforge/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { Ui, useConfirm } from 'tailor-react';
import { api } from '../api';
import { Icon, LinkButton, Loading, Page, Section, StatusDot } from '../components/Page';
import { useApp } from '../hooks/useApp';
import { useAsync, useInterval } from '../hooks/useAsync';
import { useToast } from '../hooks/useToast';
import { hostOf, publicUrlSourceLabel, relativeTime, sourceLabel } from '../lib/format';
import { linkClick, navigate, useRoute } from '../router';

const err = (e: unknown) => (e as Error).message;

const NOTICE_ICON = {
  info: 'bi-info-circle',
  warning: 'bi-exclamation-triangle',
  danger: 'bi-x-circle',
} as const;

/** A flash with a bold title and one line of reason (`.t-alert`). */
export function Notice({
  tone,
  title,
  text,
}: {
  tone: keyof typeof NOTICE_ICON;
  title: string;
  text: string;
}) {
  return (
    <Ui.Alert tone={tone} icon={NOTICE_ICON[tone]} role={tone === 'info' ? 'status' : 'alert'}>
      <strong>{title}.</strong> {text}
    </Ui.Alert>
  );
}

function InstanceStatusTable({
  member,
  statuses,
  onRevoked,
}: {
  member: string;
  statuses: InstanceStatus[];
  onRevoked: () => void;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const revoke = async (inst: Instance) => {
    const ok = await confirm(
      'Drop the delivered credential?',
      `${hostOf(inst.baseUrl)} goes back to the credential in its own .env.`,
      { label: 'Drop' },
    );
    if (!ok) return;
    try {
      const r = await api.revoke(member, inst.id);
      toast(r.message, { description: r.restartRequired ? 'Restart the instance to apply it.' : undefined });
      onRevoked();
    } catch (e) {
      toast('Not dropped', { description: err(e), variant: 'critical' });
    }
  };
  return (
    <Ui.Table.Wrap>
      <Ui.Table variant="data">
        <thead>
          <tr>
            <th>Instance</th>
            <th>GitHub</th>
            <th>Source</th>
            <th>Version</th>
            <th className="t-col-actions">
              <span className="t-visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {statuses.map((s) => {
            const g = s.status?.github;
            return (
              <tr key={s.instance.id}>
                <td>
                  <span className="cell-inline">
                    <StatusDot up={s.ok} label={s.ok ? 'answers' : 'no answer'} />
                    {s.instance.label || hostOf(s.instance.baseUrl)}
                  </span>
                </td>
                {s.ok ? (
                  <>
                    <td>
                      {g?.mode ? (
                        <Ui.Badge>{g.mode === 'app' ? 'GitHub App' : 'Token'}</Ui.Badge>
                      ) : (
                        <span className="t-muted">none</span>
                      )}{' '}
                      {g?.login && <span className="t-mono">{g.login}</span>}
                      {g?.app_id ? <span className="t-mono"> App {g.app_id}</span> : null}
                      {g?.missing && g.missing.length > 0 && (
                        <div>
                          <Ui.Badge tone="warning">reports missing: {g.missing.join(', ')}</Ui.Badge>{' '}
                          {g.permissions_url && (
                            <a href={g.permissions_url} target="_blank" rel="noreferrer" className="t-small">
                              edit permissions
                            </a>
                          )}
                        </div>
                      )}
                    </td>
                    <td>{sourceLabel(g?.source)}</td>
                    <td className="t-mono">{s.status?.version || '?'}</td>
                  </>
                ) : (
                  <td colSpan={3} className="fg-danger">
                    {s.error}
                  </td>
                )}
                <td className="t-col-actions">
                  {g?.source === 'octoforge' && (
                    <Ui.Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      tip="Drop the delivered credential"
                      tipAt="left"
                      onClick={() => void revoke(s.instance)}
                    >
                      <Icon name="trash" /> Drop
                    </Ui.Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Ui.Table>
    </Ui.Table.Wrap>
  );
}

/** Posts the manifest to GitHub as a regular form submit: GitHub answers with its own pages. */
export function postToGitHub(action: string, manifest: object) {
  const form = document.createElement('form');
  form.method = 'post';
  form.action = action;
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = 'manifest';
  input.value = JSON.stringify(manifest);
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
}

export function Owner({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { settings } = useApp();
  return (
    <Ui.Field
      label="Owner"
      hint={
        settings.githubOrg ? undefined : (
          <>
            Add an organisation in{' '}
            <a href="/settings" onClick={linkClick('/settings')}>
              Settings
            </a>{' '}
            to offer it here.
          </>
        )
      }
    >
      <Ui.Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Personal account</option>
        {settings.githubOrg && (
          <option value={settings.githubOrg}>{settings.githubOrg} (organisation)</option>
        )}
      </Ui.Select>
    </Ui.Field>
  );
}

function CreateApp({
  card,
  manifest,
  instances,
  statuses,
}: {
  card: MemberCard;
  manifest: Manifest;
  instances: Instance[];
  /** Status answers of the instances: a member may report its own public URL there. */
  statuses: InstanceStatus[] | null;
}) {
  const { capabilities } = useApp();
  const { toast } = useToast();
  const app = manifest.github?.app;
  const [name, setName] = useState(card.title);
  const [org, setOrg] = useState('');
  const [instanceId, setInstanceId] = useState<number | null>(instances[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (instanceId === null && instances[0]) setInstanceId(instances[0].id);
  }, [instances, instanceId]);
  if (!app) return null;

  const start = async (e: FormEvent) => {
    e.preventDefault();
    if (!instanceId || !name.trim()) return;
    setBusy(true);
    try {
      const r = await api.startApp(card.name, { instanceId, name: name.trim(), org: org || null });
      postToGitHub(r.action, r.manifest);
    } catch (e2) {
      setBusy(false);
      toast('Cannot start', { description: err(e2), variant: 'critical' });
    }
  };
  const target = instances.find((i) => i.id === instanceId);
  const resolved = target
    ? resolvePublicUrl(target, statuses?.find((s) => s.instance.id === target.id)?.status?.public_url)
    : null;
  const perms = Object.entries(app.permissions);
  const blocked = !capabilities?.publicUrl
    ? 'PUBLIC_URL is not set: GitHub needs it to send you back here.'
    : !instances.length
      ? 'Add an instance first: the App sends its webhooks there.'
      : null;
  return (
    <Ui.Card>
      <Ui.Form className="t-card-body t-stack" onSubmit={(e) => void start(e)}>
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
            {app.events.length ? (
              app.events.map((ev) => <Ui.Badge key={ev}>{ev}</Ui.Badge>)
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
          <Ui.Field
            label="Webhooks go to"
            hint={
              app.webhook_path && resolved ? (
                <>
                  <span className="t-mono">
                    {resolved.url}
                    {app.webhook_path}
                  </span>{' '}
                  ({publicUrlSourceLabel(resolved.source)})
                </>
              ) : undefined
            }
          >
            <Ui.Select
              value={String(instanceId ?? '')}
              onChange={(e) => setInstanceId(Number(e.target.value))}
              disabled={!instances.length}
            >
              {instances.map((i) => (
                <option key={i.id} value={String(i.id)}>
                  {i.label || hostOf(i.baseUrl)}
                </option>
              ))}
            </Ui.Select>
          </Ui.Field>
        </div>
        {blocked && <Notice tone="warning" title="Not possible yet" text={blocked} />}
        <div>
          <Ui.Button type="submit" variant="primary" busy={busy} disabled={Boolean(blocked) || !name.trim()}>
            {busy ? <Ui.Spinner size="sm" label={null} /> : <Icon name="box-arrow-up-right" />} Create on
            GitHub
          </Ui.Button>
        </div>
      </Ui.Form>
    </Ui.Card>
  );
}

function CreateToken({
  card,
  manifest,
  onAdded,
}: {
  card: MemberCard;
  manifest: Manifest;
  onAdded: (p: PendingCredential) => void;
}) {
  const { settings } = useApp();
  const { toast } = useToast();
  const pat = manifest.github?.pat;
  const [token, setToken] = useState('');
  const [org, setOrg] = useState('');
  const [busy, setBusy] = useState(false);
  if (!pat) return null;
  const description = `${card.title} via Octoforge`;
  const fineUrl = fineGrainedTokenUrl({
    pat,
    name: card.title,
    description,
    expiresInDays: settings.patExpiresDays,
    targetName: org || null,
  });
  const classicUrl = classicTokenUrl(pat, description);
  const check = async (e: FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;
    setBusy(true);
    try {
      const r = await api.addToken(card.name, token.trim());
      setToken('');
      onAdded(r.pending);
      toast(r.message, { variant: r.pending.pat?.missing.length ? 'warning' : 'success' });
    } catch (e2) {
      toast('Token not accepted', { description: err(e2), variant: 'critical' });
    } finally {
      setBusy(false);
    }
  };
  const fine = Object.entries(pat.fine_grained);
  return (
    <Ui.Card>
      <Ui.Form className="t-card-body t-stack" onSubmit={(e) => void check(e)}>
        {pat.user_identity && (
          <Notice
            tone="info"
            title="Acts as you"
            text={`${card.title} needs a token of the person it works for; a GitHub App cannot replace it.`}
          />
        )}
        <Ui.Facts>
          {fine.length > 0 && (
            <>
              <dt>Fine-grained permissions</dt>
              <dd className="label-row">
                {fine.map(([p, l]) => (
                  <Ui.Badge key={p}>{`${p}: ${l}`}</Ui.Badge>
                ))}
              </dd>
            </>
          )}
          {pat.classic_scopes.length > 0 && (
            <>
              <dt>Classic scopes</dt>
              <dd className="label-row">
                {pat.classic_scopes.map((s) => (
                  <Ui.Badge key={s}>{s}</Ui.Badge>
                ))}
              </dd>
            </>
          )}
        </Ui.Facts>
        <div className="form-row">
          <Owner value={org} onChange={setOrg} />
          <Ui.Cluster gap="2" className="form-row-buttons">
            {fine.length > 0 && (
              <LinkButton href={fineUrl} external icon="box-arrow-up-right">
                Fine-grained token
              </LinkButton>
            )}
            {pat.classic_scopes.length > 0 && (
              <LinkButton href={classicUrl} external icon="box-arrow-up-right">
                Classic token
              </LinkButton>
            )}
          </Ui.Cluster>
        </div>
        <div className="input-with-button">
          <Ui.Field
            label="Paste the token"
            hint="Checked against GitHub, then held in memory until you deliver it."
          >
            <Ui.Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="github_pat_… or ghp_…"
            />
          </Ui.Field>
          <Ui.Button type="submit" busy={busy} disabled={!token.trim()}>
            {busy ? <Ui.Spinner size="sm" label={null} /> : <Icon name="check-lg" />} Check
          </Ui.Button>
        </div>
      </Ui.Form>
    </Ui.Card>
  );
}

function EnvDialog({ text, onClose }: { text: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      toast('Not copied', {
        description: 'The browser gives no clipboard here: select the text.',
        variant: 'warning',
      });
    }
  };
  return (
    <Ui.Dialog
      open
      id="env-block"
      title=".env block"
      size="xl"
      onClose={onClose}
      footer={
        <>
          <Ui.Button type="button" onClick={() => void copy()}>
            <Icon name={copied ? 'check-lg' : 'copy'} /> {copied ? 'Copied' : 'Copy'}
          </Ui.Button>
          <Ui.Button type="button" variant="primary" data-dialog-close="">
            Done
          </Ui.Button>
        </>
      }
    >
      <p className="t-muted">Shown once: Octoforge no longer holds this credential.</p>
      <pre className="env-block">{text}</pre>
    </Ui.Dialog>
  );
}

function PendingCard({
  p,
  instances,
  reachable,
  highlight,
  onGone,
}: {
  p: PendingCredential;
  instances: Instance[];
  /** Instances whose member API answered: ticked by default. */
  reachable: Set<number>;
  highlight: boolean;
  onGone: (id: string, reload: boolean) => void;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  // Explicit ticks win; otherwise an instance is ticked when its member API answers.
  const [picked, setPicked] = useState<Record<number, boolean>>({});
  const selected = instances.filter((i) => picked[i.id] ?? reachable.has(i.id)).map((i) => i.id);
  const [installs, setInstalls] = useState<Installation[] | null>(null);
  const [installId, setInstallId] = useState<number | null>(null);
  const [loadingInstalls, setLoadingInstalls] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<
    { id: number; ok: boolean; message: string; restart: boolean | null }[]
  >([]);
  const [env, setEnv] = useState<string | null>(null);

  const findInstalls = async () => {
    setLoadingInstalls(true);
    try {
      const list = await api.installations(p.id);
      setInstalls(list);
      setInstallId(list[0]?.id ?? null);
      if (!list.length)
        toast('Not installed yet', { description: 'Install the App, then look again.', variant: 'warning' });
    } catch (e) {
      toast('Cannot list installations', { description: err(e), variant: 'critical' });
    } finally {
      setLoadingInstalls(false);
    }
  };

  const deliver = async () => {
    setBusy(true);
    try {
      const r = await api.deliver(p.id, selected, installId);
      setResults(
        r.results.map((x) => ({
          id: x.instance.id,
          ok: x.ok,
          message: x.message,
          restart: x.restartRequired,
        })),
      );
      toast(r.message, { variant: r.cleared ? 'success' : 'warning' });
      if (r.cleared) onGone(p.id, true);
    } catch (e) {
      toast('Delivery failed', { description: err(e), variant: 'critical' });
    } finally {
      setBusy(false);
    }
  };

  const showEnv = async () => {
    const ok = await confirm(
      'Show as .env block?',
      'The block is shown once. Octoforge then forgets the credential, so copy it before you close the dialog.',
      { label: 'Show', danger: false },
    );
    if (!ok) return;
    try {
      const r = await api.envBlock(p.id, installId);
      setEnv(r.env);
    } catch (e) {
      toast('Cannot build the block', { description: err(e), variant: 'critical' });
    }
  };

  const discard = async () => {
    onGone(p.id, false);
    try {
      await api.discard(p.id);
    } catch (e) {
      toast('Not discarded', { description: err(e), variant: 'critical' });
      onGone(p.id, true);
    }
  };

  const toggle = (id: number) => setPicked((p2) => ({ ...p2, [id]: !selected.includes(id) }));

  return (
    <Ui.Card className={highlight ? 'card-highlight' : undefined} aria-selected={highlight || undefined}>
      <Ui.Card.Header>
        <Ui.Card.Title>
          <Icon name="key" />
          {p.app ? (
            <span>
              GitHub App <span className="t-mono">{p.app.slug}</span> (id {p.app.id})
            </span>
          ) : (
            <span>
              Token of <span className="t-mono">{p.pat?.login}</span>
            </span>
          )}
        </Ui.Card.Title>
        <Ui.Card.Tools>
          <span className="t-muted t-small">expires {relativeTime(p.expiresAt)}</span>
          <Ui.Button
            type="button"
            size="sm"
            variant="ghost"
            tip="Forget it without delivering"
            tipAt="left"
            onClick={() => void discard()}
          >
            <Icon name="trash" /> Discard
          </Ui.Button>
        </Ui.Card.Tools>
      </Ui.Card.Header>
      <Ui.Card.Body className="t-stack">
        {p.pat && (
          <Ui.Facts>
            <dt>Type</dt>
            <dd>
              {p.pat.tokenType === 'fine_grained'
                ? 'Fine-grained'
                : p.pat.tokenType === 'classic'
                  ? 'Classic'
                  : 'Other'}
            </dd>
            {p.pat.scopes && (
              <>
                <dt>Scopes</dt>
                <dd className="label-row">
                  {p.pat.scopes.length ? (
                    p.pat.scopes.map((s) => <Ui.Badge key={s}>{s}</Ui.Badge>)
                  ) : (
                    <span>none</span>
                  )}
                </dd>
              </>
            )}
          </Ui.Facts>
        )}
        {p.pat && p.pat.missing.length > 0 && (
          <Notice
            tone="warning"
            title="Missing scopes"
            text={`${p.pat.missing.join(', ')}. Create a new token with them, or deliver anyway and expect failures.`}
          />
        )}
        {p.pat?.tokenType === 'fine_grained' && (
          <p className="t-muted t-small">
            GitHub does not list a fine-grained token's permissions; the member checks them on delivery.
          </p>
        )}
        {p.app && (
          <div className="form-row">
            <Ui.Cluster gap="2" className="form-row-buttons">
              <LinkButton href={p.app.installUrl} external icon="box-arrow-up-right">
                Install the App
              </LinkButton>
              <Ui.Button type="button" onClick={() => void findInstalls()} busy={loadingInstalls}>
                {loadingInstalls ? <Ui.Spinner size="sm" label={null} /> : <Icon name="arrow-repeat" />} Find
                installations
              </Ui.Button>
            </Ui.Cluster>
            {installs && installs.length > 0 && (
              <Ui.Field label="Installation">
                <Ui.Select
                  value={String(installId ?? '')}
                  onChange={(e) => setInstallId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Let the member find it</option>
                  {installs.map((i) => (
                    <option key={i.id} value={String(i.id)}>
                      {i.account} ({i.accountType}, {i.id})
                    </option>
                  ))}
                </Ui.Select>
              </Ui.Field>
            )}
          </div>
        )}
        <Ui.Check.Group legend="Deliver to">
          {instances.map((i) => {
            const r = results.find((x) => x.id === i.id);
            return (
              <Ui.Check
                key={i.id}
                checked={selected.includes(i.id)}
                onChange={() => toggle(i.id)}
                label={
                  <>
                    {i.label || hostOf(i.baseUrl)}
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
          {!instances.length && <span className="t-muted">No instance configured.</span>}
        </Ui.Check.Group>
        <Ui.Cluster gap="2">
          <Ui.Button
            type="button"
            variant="primary"
            busy={busy}
            disabled={!selected.length}
            onClick={() => void deliver()}
          >
            {busy ? <Ui.Spinner size="sm" label={null} /> : <Icon name="send" />} Deliver
          </Ui.Button>
          <Ui.Button type="button" onClick={() => void showEnv()}>
            Show as .env block
          </Ui.Button>
        </Ui.Cluster>
      </Ui.Card.Body>
      {env !== null && (
        <EnvDialog
          text={env}
          onClose={() => {
            setEnv(null);
            onGone(p.id, true);
          }}
        />
      )}
    </Ui.Card>
  );
}

/** The shared App, Octoforge's comparison with this member's needs, and the way to the GitHub App page. */
function SharedAppNote({ member }: { member: string }) {
  const shared = useAsync(() => api.sharedApp(), 'shared-app');
  const v = shared.data;
  if (!v) return null;
  const mine = v.members.find((m) => m.name === member);
  const go = linkClick('/github-app');
  if (!v.app) {
    return (
      <Ui.Alert
        tone="info"
        role="status"
        icon="bi-info-circle"
        actions={
          <LinkButton href="/github-app" onClick={go} size="sm">
            Open GitHub App
          </LinkButton>
        }
      >
        <strong>Use the shared GitHub App.</strong> One App serves every member. Set it up on the GitHub App
        page; an App for this member only is the alternative below.
      </Ui.Alert>
    );
  }
  const missing = mine?.missing ?? [];
  return (
    <Ui.Card>
      <Ui.Card.Header>
        <Ui.Card.Title>
          <Icon name="key" />
          <span>
            Shared App <span className="t-mono">{v.app.slug}</span>
          </span>
        </Ui.Card.Title>
        <Ui.Card.Tools>
          {missing.length ? (
            <Ui.Badge tone="warning">missing: {missing.join(', ')}</Ui.Badge>
          ) : (
            <span className="fg-success t-small">
              <Icon name="check-lg" /> grants what this member needs
            </span>
          )}
          <LinkButton href="/github-app" onClick={go} size="sm">
            {missing.length ? 'Update and deliver' : 'Deliver'}
          </LinkButton>
        </Ui.Card.Tools>
      </Ui.Card.Header>
    </Ui.Card>
  );
}

export function CredentialsPage({ member }: { member: string }) {
  const { capabilities } = useApp();
  const { toast } = useToast();
  const route = useRoute();
  const highlight = route.query.get('pending');
  const card = useAsync(() => api.member(member), `card:${member}`);
  const statuses = useAsync(() => api.status(member), `status:${member}`);
  const pending = useAsync(() => api.pending(member), `pending:${member}`);
  useInterval(() => void pending.reload(), 30_000);

  useEffect(() => {
    if (!highlight) return;
    toast('GitHub App created', { description: 'Install it, then deliver it to your instances.' });
    navigate(`/members/${member}/credentials`, { replace: true });
  }, [highlight, member, toast]);
  const [focus] = useState(highlight);

  const c = card.data;
  const m = c?.manifest ?? null;
  const instances = statuses.data?.map((s) => s.instance) ?? c?.instances.map((h) => h.instance) ?? [];
  const reachable = new Set((statuses.data ?? []).filter((s) => s.ok).map((s) => s.instance.id));
  const onGone = (id: string, reload: boolean) => {
    pending.setData((all) => (all ?? []).filter((p) => p.id !== id));
    if (reload) {
      void pending.reload();
      void statuses.reload();
    }
  };

  return (
    <Page
      title={c ? `${c.title} credentials` : member}
      lead="Create a GitHub credential, check it and hand it to the running instances."
    >
      {card.error && <p className="fg-danger">{card.error.message}</p>}
      {capabilities && !capabilities.memberToken && (
        <Notice
          tone="warning"
          title="OCTOFORGE_TOKEN is not set"
          text="Octoforge cannot talk to the member API. You can still create credentials and copy them as an .env block."
        />
      )}
      {c && !m && (
        <Notice
          tone="warning"
          title="No manifest"
          text={c.manifestError ?? 'This member publishes no octoforge.json yet.'}
        />
      )}
      <Section title="Instances">
        {statuses.loading && !statuses.data ? (
          <Loading />
        ) : statuses.data && statuses.data.length > 0 ? (
          <InstanceStatusTable
            member={member}
            statuses={statuses.data}
            onRevoked={() => void statuses.reload()}
          />
        ) : (
          <Ui.EmptyState
            size="sm"
            actions={
              <LinkButton href="/settings" onClick={linkClick('/settings')} size="sm" icon="gear">
                Add one in Settings
              </LinkButton>
            }
          >
            <p>No instance configured.</p>
          </Ui.EmptyState>
        )}
      </Section>
      {m?.github?.auth.includes('app') && (
        <Section title="Shared GitHub App">
          <SharedAppNote member={member} />
        </Section>
      )}
      {(pending.data?.length ?? 0) > 0 && (
        <Section title="Waiting for delivery">
          <Ui.Stack gap="3">
            {pending.data?.map((p) => (
              <PendingCard
                key={p.id}
                p={p}
                instances={instances}
                reachable={reachable}
                highlight={p.id === focus}
                onGone={onGone}
              />
            ))}
          </Ui.Stack>
        </Section>
      )}
      {c && m?.github?.auth.includes('app') && (
        <Section title="Create an App for this member only">
          <CreateApp card={c} manifest={m} instances={instances} statuses={statuses.data} />
        </Section>
      )}
      {c && m?.github?.auth.includes('pat') && (
        <Section title="Use a personal access token">
          <CreateToken card={c} manifest={m} onAdded={(p) => pending.setData((all) => [p, ...(all ?? [])])} />
        </Section>
      )}
      {c && m && !m.github && <p className="t-muted">{c.title} needs no GitHub credentials.</p>}
    </Page>
  );
}

import {
  classicTokenUrl,
  fineGrainedTokenUrl,
  type Installation,
  type Instance,
  type InstanceStatus,
  type Manifest,
  type MemberCard,
  type PendingCredential,
} from '@octoforge/shared';
import {
  AlertIcon,
  CheckIcon,
  CopyIcon,
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
  Dialog,
  FormControl,
  Label,
  Link,
  Select,
  Spinner,
  TextInput,
  useConfirm,
} from '@primer/react';
import { Tooltip } from '@primer/react/next';
import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../api';
import { Page, Section, StatusDot } from '../components/Page';
import { useApp } from '../hooks/useApp';
import { useAsync, useInterval } from '../hooks/useAsync';
import { useToast } from '../hooks/useToast';
import { hostOf, relativeTime, sourceLabel } from '../lib/format';
import { linkClick, navigate, useRoute } from '../router';

const err = (e: unknown) => (e as Error).message;

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
    const ok = await confirm({
      title: 'Drop the delivered credential?',
      content: `${hostOf(inst.baseUrl)} goes back to the credential in its own .env.`,
      confirmButtonContent: 'Drop',
      confirmButtonType: 'danger',
    });
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
    <table className="table">
      <thead>
        <tr>
          <th>Instance</th>
          <th>GitHub</th>
          <th>Source</th>
          <th>Version</th>
          <th aria-label="Actions" />
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
                      <Label>{g.mode === 'app' ? 'GitHub App' : 'Token'}</Label>
                    ) : (
                      <span className="fg-muted">none</span>
                    )}{' '}
                    {g?.login && <span className="mono">{g.login}</span>}
                    {g?.app_id ? <span className="mono"> App {g.app_id}</span> : null}
                  </td>
                  <td>{sourceLabel(g?.source)}</td>
                  <td className="mono">{s.status?.version || '?'}</td>
                </>
              ) : (
                <td colSpan={3} className="fg-danger">
                  {s.error}
                </td>
              )}
              <td className="cell-actions">
                {g?.source === 'octoforge' && (
                  <Tooltip text="Drop the delivered credential" direction="w">
                    <Button
                      size="small"
                      variant="invisible"
                      leadingVisual={TrashIcon}
                      onClick={() => void revoke(s.instance)}
                    >
                      Drop
                    </Button>
                  </Tooltip>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Posts the manifest to GitHub as a regular form submit: GitHub answers with its own pages. */
function postToGitHub(action: string, manifest: object) {
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

function Owner({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { settings } = useApp();
  return (
    <FormControl>
      <FormControl.Label>Owner</FormControl.Label>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <Select.Option value="">Personal account</Select.Option>
        {settings.githubOrg && (
          <Select.Option value={settings.githubOrg}>{settings.githubOrg} (organisation)</Select.Option>
        )}
      </Select>
      {!settings.githubOrg && (
        <FormControl.Caption>
          Add an organisation in{' '}
          <Link href="/settings" onClick={linkClick('/settings')}>
            Settings
          </Link>{' '}
          to offer it here.
        </FormControl.Caption>
      )}
    </FormControl>
  );
}

function CreateApp({
  card,
  manifest,
  instances,
}: {
  card: MemberCard;
  manifest: Manifest;
  instances: Instance[];
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
  const perms = Object.entries(app.permissions);
  const blocked = !capabilities?.publicUrl
    ? 'PUBLIC_URL is not set: GitHub needs it to send you back here.'
    : !instances.length
      ? 'Add an instance first: the App sends its webhooks there.'
      : null;
  return (
    <form className="card-box stack" onSubmit={(e) => void start(e)}>
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
            {app.events.length ? app.events.map((ev) => <Label key={ev}>{ev}</Label>) : <span>none</span>}
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
        <FormControl>
          <FormControl.Label>Webhooks go to</FormControl.Label>
          <Select
            value={String(instanceId ?? '')}
            onChange={(e) => setInstanceId(Number(e.target.value))}
            disabled={!instances.length}
          >
            {instances.map((i) => (
              <Select.Option key={i.id} value={String(i.id)}>
                {i.label || hostOf(i.baseUrl)}
              </Select.Option>
            ))}
          </Select>
          {app.webhook_path && instanceId && (
            <FormControl.Caption>
              {instances.find((i) => i.id === instanceId)?.baseUrl}
              {app.webhook_path}
            </FormControl.Caption>
          )}
        </FormControl>
      </div>
      {blocked && (
        <Banner variant="warning" title="Not possible yet" description={blocked} layout="compact" />
      )}
      <div>
        <Button
          type="submit"
          variant="primary"
          leadingVisual={busy ? () => <Spinner size="small" srText={null} /> : LinkExternalIcon}
          disabled={busy || Boolean(blocked) || !name.trim()}
        >
          Create on GitHub
        </Button>
      </div>
    </form>
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
    <form className="card-box stack" onSubmit={(e) => void check(e)}>
      {pat.user_identity && (
        <Banner
          variant="info"
          title="Acts as you"
          description={`${card.title} needs a token of the person it works for; a GitHub App cannot replace it.`}
          layout="compact"
        />
      )}
      <div className="facts">
        {fine.length > 0 && (
          <div>
            <span className="fg-muted">Fine-grained permissions</span>
            <div className="label-row">
              {fine.map(([p, l]) => (
                <Label key={p}>{`${p}: ${l}`}</Label>
              ))}
            </div>
          </div>
        )}
        {pat.classic_scopes.length > 0 && (
          <div>
            <span className="fg-muted">Classic scopes</span>
            <div className="label-row">
              {pat.classic_scopes.map((s) => (
                <Label key={s}>{s}</Label>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="form-row">
        <Owner value={org} onChange={setOrg} />
        <div className="button-row">
          {fine.length > 0 && (
            <Button as="a" href={fineUrl} target="_blank" rel="noreferrer" leadingVisual={LinkExternalIcon}>
              Fine-grained token
            </Button>
          )}
          {pat.classic_scopes.length > 0 && (
            <Button
              as="a"
              href={classicUrl}
              target="_blank"
              rel="noreferrer"
              leadingVisual={LinkExternalIcon}
            >
              Classic token
            </Button>
          )}
        </div>
      </div>
      <div className="input-with-button">
        <FormControl>
          <FormControl.Label>Paste the token</FormControl.Label>
          <TextInput
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="github_pat_… or ghp_…"
            block
          />
          <FormControl.Caption>
            Checked against GitHub, then held in memory until you deliver it.
          </FormControl.Caption>
        </FormControl>
        <Button
          type="submit"
          disabled={busy || !token.trim()}
          leadingVisual={busy ? () => <Spinner size="small" srText={null} /> : CheckIcon}
        >
          Check
        </Button>
      </div>
    </form>
  );
}

function EnvDialog({ text, onClose }: { text: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
  };
  return (
    <Dialog
      title=".env block"
      subtitle="Shown once: Octoforge no longer holds this credential."
      onClose={onClose}
      width="xlarge"
      footerButtons={[
        {
          content: copied ? 'Copied' : 'Copy',
          leadingVisual: copied ? CheckIcon : CopyIcon,
          onClick: () => void copy(),
        },
        { content: 'Done', buttonType: 'primary', onClick: onClose },
      ]}
    >
      <pre className="env-block">{text}</pre>
    </Dialog>
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
    const ok = await confirm({
      title: 'Show as .env block?',
      content:
        'The block is shown once. Octoforge then forgets the credential, so copy it before you close the dialog.',
      confirmButtonContent: 'Show',
    });
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
    <div className={`card-box stack${highlight ? ' card-box-highlight' : ''}`}>
      <div className="pending-head">
        <KeyIcon />
        {p.app ? (
          <strong>
            GitHub App <span className="mono">{p.app.slug}</span> (id {p.app.id})
          </strong>
        ) : (
          <strong>
            Token of <span className="mono">{p.pat?.login}</span>
          </strong>
        )}
        <span className="fg-muted">expires {relativeTime(p.expiresAt)}</span>
        <span className="spacer" />
        <Tooltip text="Forget it without delivering" direction="w">
          <Button size="small" variant="invisible" leadingVisual={TrashIcon} onClick={() => void discard()}>
            Discard
          </Button>
        </Tooltip>
      </div>
      {p.pat && (
        <div className="facts">
          <div>
            <span className="fg-muted">Type</span>
            <div>
              {p.pat.tokenType === 'fine_grained'
                ? 'Fine-grained'
                : p.pat.tokenType === 'classic'
                  ? 'Classic'
                  : 'Other'}
            </div>
          </div>
          {p.pat.scopes && (
            <div>
              <span className="fg-muted">Scopes</span>
              <div className="label-row">
                {p.pat.scopes.length ? (
                  p.pat.scopes.map((s) => <Label key={s}>{s}</Label>)
                ) : (
                  <span>none</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {p.pat && p.pat.missing.length > 0 && (
        <Banner
          variant="warning"
          title="Missing scopes"
          description={`${p.pat.missing.join(', ')}. Create a new token with them, or deliver anyway and expect failures.`}
          layout="compact"
        />
      )}
      {p.pat?.tokenType === 'fine_grained' && (
        <p className="fg-muted small">
          GitHub does not list a fine-grained token's permissions; the member checks them on delivery.
        </p>
      )}
      {p.app && (
        <div className="form-row">
          <div className="button-row">
            <Button
              as="a"
              href={p.app.installUrl}
              target="_blank"
              rel="noreferrer"
              leadingVisual={LinkExternalIcon}
            >
              Install the App
            </Button>
            <Button
              onClick={() => void findInstalls()}
              leadingVisual={loadingInstalls ? () => <Spinner size="small" srText={null} /> : SyncIcon}
              disabled={loadingInstalls}
            >
              Find installations
            </Button>
          </div>
          {installs && installs.length > 0 && (
            <FormControl>
              <FormControl.Label>Installation</FormControl.Label>
              <Select
                value={String(installId ?? '')}
                onChange={(e) => setInstallId(e.target.value ? Number(e.target.value) : null)}
              >
                <Select.Option value="">Let the member find it</Select.Option>
                {installs.map((i) => (
                  <Select.Option key={i.id} value={String(i.id)}>
                    {i.account} ({i.accountType}, {i.id})
                  </Select.Option>
                ))}
              </Select>
            </FormControl>
          )}
        </div>
      )}
      <fieldset className="checks">
        <legend className="fg-muted">Deliver to</legend>
        {instances.map((i) => {
          const r = results.find((x) => x.id === i.id);
          return (
            <FormControl key={i.id} layout="horizontal">
              <Checkbox checked={selected.includes(i.id)} onChange={() => toggle(i.id)} />
              <FormControl.Label>
                {i.label || hostOf(i.baseUrl)}
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
        {!instances.length && <span className="fg-muted">No instance configured.</span>}
      </fieldset>
      <div className="button-row">
        <Button
          variant="primary"
          leadingVisual={busy ? () => <Spinner size="small" srText={null} /> : PaperAirplaneIcon}
          disabled={busy || !selected.length}
          onClick={() => void deliver()}
        >
          Deliver
        </Button>
        <Button onClick={() => void showEnv()}>Show as .env block</Button>
      </div>
      {env !== null && (
        <EnvDialog
          text={env}
          onClose={() => {
            setEnv(null);
            onGone(p.id, true);
          }}
        />
      )}
    </div>
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
        <Banner
          variant="warning"
          title="OCTOFORGE_TOKEN is not set"
          description="Octoforge cannot talk to the member API. You can still create credentials and copy them as an .env block."
        />
      )}
      {c && !m && (
        <Banner
          variant="warning"
          title="No manifest"
          description={c.manifestError ?? 'This member publishes no octoforge.json yet.'}
        />
      )}
      <Section title="Instances">
        {statuses.loading && !statuses.data ? (
          <Spinner size="small" />
        ) : statuses.data && statuses.data.length > 0 ? (
          <InstanceStatusTable
            member={member}
            statuses={statuses.data}
            onRevoked={() => void statuses.reload()}
          />
        ) : (
          <p className="fg-muted">
            No instance configured.{' '}
            <Link href="/settings" onClick={linkClick('/settings')}>
              Add one in Settings
            </Link>
            .
          </p>
        )}
      </Section>
      {(pending.data?.length ?? 0) > 0 && (
        <Section title="Waiting for delivery">
          <div className="stack">
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
          </div>
        </Section>
      )}
      {c && m?.github?.auth.includes('app') && (
        <Section title="Create a GitHub App">
          <CreateApp card={c} manifest={m} instances={instances} />
        </Section>
      )}
      {c && m?.github?.auth.includes('pat') && (
        <Section title="Use a personal access token">
          <CreateToken card={c} manifest={m} onAdded={(p) => pending.setData((all) => [p, ...(all ?? [])])} />
        </Section>
      )}
      {c && m && !m.github && <p className="fg-muted">{c.title} needs no GitHub credentials.</p>}
    </Page>
  );
}

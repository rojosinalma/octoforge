import type { AdoptResult, Engine, InstanceStatus, MemberCard } from '@octoforge/shared';
import { useEffect, useState } from 'react';
import { Ui, useConfirm } from 'tailor-react';
import { api } from '../api';
import { Icon, Loading, Page, Section, StatusDot } from '../components/Page';
import { useApp } from '../hooks/useApp';
import { useAsync } from '../hooks/useAsync';
import { useToast } from '../hooks/useToast';
import { hostOf, sourceLabel } from '../lib/format';

const ENGINE_LABEL: Record<Engine, string> = { postgres: 'Postgres', sqlite: 'SQLite' };

function Results({ results }: { results: AdoptResult[] }) {
  const restart = results.some((r) => r.ok && r.restartRequired !== false);
  return (
    <Ui.Stack gap="3">
      {restart && (
        <Ui.Alert tone="warning" icon="bi-exclamation-triangle">
          <strong>Restart required.</strong> Restart every instance that took the new database: it keeps using
          the old one until then.
        </Ui.Alert>
      )}
      <ul className="result-list t-plain-list">
        {results.map((r) => (
          <li key={r.instance.id} className={r.ok ? 'fg-success' : 'fg-danger'}>
            <Icon name={r.ok ? 'check-lg' : 'exclamation-triangle'} />{' '}
            {r.instance.label || hostOf(r.instance.baseUrl)}
            {r.copy ? ' (copied rows)' : ''}: {r.message}
            {r.tables && (
              <span className="t-muted t-mono t-small">
                {' '}
                {Object.entries(r.tables)
                  .map(([t, n]) => `${t} ${n}`)
                  .join(', ')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Ui.Stack>
  );
}

/** Confirms a Postgres adoption; the current password is for a member role that already exists. */
function PostgresAdoptDialog({
  card,
  onAdopt,
  onClose,
}: {
  card: MemberCard;
  onAdopt: (existingPassword: string) => void;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const formId = `adopt-${card.name}`;
  return (
    <Ui.Dialog
      open
      id={`${formId}-dlg`}
      title={`Move ${card.title} to Postgres?`}
      onClose={onClose}
      footer={
        <>
          <Ui.Button type="button" onClick={onClose}>
            Cancel
          </Ui.Button>
          <Ui.Button type="submit" form={formId} variant="primary">
            Adopt
          </Ui.Button>
        </>
      }
    >
      <Ui.Form
        id={formId}
        className="t-stack"
        onSubmit={(e) => {
          e.preventDefault();
          onAdopt(password);
        }}
      >
        <p>
          The first instance copies every row to schema "{card.name}" in the shared Postgres database and
          compares the counts; the others switch without a copy. The old database stays untouched for a
          rollback.
        </p>
        <Ui.Field
          label="Current password (only when the member's role already exists)"
          hint={`Leave empty when Octoforge creates the role "${card.name}" or created it before. If the role already exists for the member's own database, enter its current password: it stays unchanged, so the member's own DATABASE_URL keeps working. Octoforge passes it to the member once and does not store it.`}
        >
          <Ui.Input
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </Ui.Field>
      </Ui.Form>
    </Ui.Dialog>
  );
}

function MemberDatabase({ card }: { card: MemberCard }) {
  const { capabilities } = useApp();
  const { toast } = useToast();
  const confirm = useConfirm();
  const status = useAsync<InstanceStatus[]>(
    () => (card.instances.length ? api.status(card.name) : Promise.resolve([])),
    `db:${card.name}`,
  );
  const [busy, setBusy] = useState<Engine | null>(null);
  const [results, setResults] = useState<AdoptResult[] | null>(null);
  const db = card.manifest?.database;

  const available: Engine[] = [];
  if (capabilities?.postgres && db?.engines.includes('postgres') && db.schema) available.push('postgres');
  if (capabilities?.sharedData && db?.engines.includes('sqlite')) available.push('sqlite');

  const [asking, setAsking] = useState(false);

  const run = async (engine: Engine, existingPassword?: string) => {
    setBusy(engine);
    try {
      const r = await api.adopt(card.name, engine, existingPassword);
      setResults(r.results);
      toast(r.message, { variant: r.results.every((x) => x.ok) ? 'success' : 'warning' });
      void status.reload();
    } catch (e) {
      toast('Adoption failed', { description: (e as Error).message, variant: 'critical' });
    } finally {
      setBusy(null);
    }
  };

  const adopt = async (engine: Engine) => {
    if (engine === 'postgres') {
      setAsking(true);
      return;
    }
    const ok = await confirm(
      `Move ${card.title} to ${ENGINE_LABEL[engine]}?`,
      `The first instance copies every row to ${capabilities?.sharedData}/${card.name}.db and compares the counts; the others switch without a copy. The old database stays untouched for a rollback.`,
      { label: 'Adopt', danger: false },
    );
    if (ok) await run(engine);
  };

  const release = async (s: InstanceStatus) => {
    const ok = await confirm(
      'Go back to the own database?',
      `${hostOf(s.instance.baseUrl)} drops the adopted database setting and uses its DATABASE_URL after the next restart. Rows written since the adoption stay in the shared database only.`,
      { label: 'Release' },
    );
    if (!ok) return;
    try {
      const r = await api.release(card.name, s.instance.id);
      toast(r.message, { description: 'Restart the instance to apply it.', variant: 'warning' });
      void status.reload();
    } catch (e) {
      toast('Not released', { description: (e as Error).message, variant: 'critical' });
    }
  };

  return (
    <Section
      title={
        <span className="cell-inline">
          <Icon name="database" /> {card.title}
        </span>
      }
    >
      <Ui.Card>
        <Ui.Card.Body className="t-stack">
          <Ui.Facts>
            <dt>Engines</dt>
            <dd className="label-row">
              {db ? (
                db.engines.map((e) => <Ui.Badge key={e}>{ENGINE_LABEL[e]}</Ui.Badge>)
              ) : (
                <span>unknown</span>
              )}
              {db?.schema && <Ui.Badge tone="accent">named schema</Ui.Badge>}
            </dd>
          </Ui.Facts>
          {card.instances.length === 0 ? (
            <p className="t-muted">Not deployed: add an instance in Settings.</p>
          ) : status.loading && !status.data ? (
            <Loading />
          ) : (
            <Ui.Table.Wrap>
              <Ui.Table variant="data">
                <thead>
                  <tr>
                    <th>Instance</th>
                    <th>Engine</th>
                    <th>Schema</th>
                    <th>Source</th>
                    <th className="t-col-actions">
                      <span className="t-visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {status.data?.map((s) => (
                    <tr key={s.instance.id}>
                      <td>
                        <span className="cell-inline">
                          <StatusDot up={s.ok} label={s.ok ? 'answers' : 'no answer'} />
                          {s.instance.label || hostOf(s.instance.baseUrl)}
                        </span>
                      </td>
                      {s.ok ? (
                        <>
                          <td>{s.status?.database?.engine ?? <span className="t-muted">unknown</span>}</td>
                          <td className="t-mono">{s.status?.database?.schema ?? '—'}</td>
                          <td>{s.status?.database ? sourceLabel(s.status.database.source) : '—'}</td>
                        </>
                      ) : (
                        <td colSpan={3} className="fg-danger">
                          {s.error}
                        </td>
                      )}
                      <td className="t-col-actions">
                        {s.status?.database?.source === 'octoforge' && (
                          <Ui.Button type="button" size="sm" variant="ghost" onClick={() => void release(s)}>
                            <Icon name="arrow-counterclockwise" /> Release
                          </Ui.Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Ui.Table>
            </Ui.Table.Wrap>
          )}
          {card.instances.length > 0 && db && (
            <Ui.Cluster gap="2">
              {available.map((e) => (
                <Ui.Button
                  key={e}
                  type="button"
                  onClick={() => void adopt(e)}
                  busy={busy === e}
                  disabled={busy !== null}
                >
                  {busy === e ? <Ui.Spinner size="sm" label={null} /> : <Icon name="database" />} Adopt into{' '}
                  {ENGINE_LABEL[e]}
                </Ui.Button>
              ))}
              {!available.length && (
                <span className="t-muted t-small">
                  No shared engine fits: set FORGE_PG_ADMIN_URL or OCTOFORGE_SHARED_DATA for an engine this
                  member supports.
                </span>
              )}
            </Ui.Cluster>
          )}
          {results && <Results results={results} />}
        </Ui.Card.Body>
      </Ui.Card>
      {asking && (
        <PostgresAdoptDialog
          card={card}
          onClose={() => setAsking(false)}
          onAdopt={(pw) => {
            setAsking(false);
            void run('postgres', pw || undefined);
          }}
        />
      )}
    </Section>
  );
}

export function DatabasePage() {
  const { capabilities } = useApp();
  const members = useAsync(() => api.members(), 'members');
  const [cards, setCards] = useState<MemberCard[]>([]);
  useEffect(() => setCards((members.data ?? []).filter((c) => c.manifest?.database)), [members.data]);
  const without = (members.data ?? []).filter((c) => !c.manifest?.database);
  return (
    <Page
      title="Database"
      lead="Move members into one shared database: one schema per member on Postgres, or one file per member in a shared directory."
    >
      {capabilities && (
        <Ui.Card>
          <Ui.Card.Body>
            <Ui.Facts>
              <dt>Postgres</dt>
              <dd>{capabilities.postgres ? 'FORGE_PG_ADMIN_URL set' : 'not configured'}</dd>
              <dt>SQLite directory</dt>
              <dd className="t-mono">{capabilities.sharedData ?? 'not configured'}</dd>
            </Ui.Facts>
          </Ui.Card.Body>
        </Ui.Card>
      )}
      {members.loading && !members.data && <Loading />}
      {cards.map((c) => (
        <MemberDatabase key={c.name} card={c} />
      ))}
      {without.length > 0 && (
        <p className="t-muted">
          Without a database section in their manifest: {without.map((c) => c.name).join(', ')}.
        </p>
      )}
    </Page>
  );
}

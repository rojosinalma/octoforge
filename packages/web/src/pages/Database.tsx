import type { AdoptResult, Engine, InstanceStatus, MemberCard } from '@octoforge/shared';
import { AlertIcon, CheckIcon, DatabaseIcon, UndoIcon } from '@primer/octicons-react';
import { Banner, Button, Dialog, FormControl, Label, Spinner, TextInput, useConfirm } from '@primer/react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Page, Section, StatusDot } from '../components/Page';
import { useApp } from '../hooks/useApp';
import { useAsync } from '../hooks/useAsync';
import { useToast } from '../hooks/useToast';
import { hostOf, sourceLabel } from '../lib/format';

const ENGINE_LABEL: Record<Engine, string> = { postgres: 'Postgres', sqlite: 'SQLite' };

function Results({ results }: { results: AdoptResult[] }) {
  const restart = results.some((r) => r.ok && r.restartRequired !== false);
  return (
    <div className="stack">
      {restart && (
        <Banner
          variant="warning"
          title="Restart required"
          description="Restart every instance that took the new database: it keeps using the old one until then."
        />
      )}
      <ul className="result-list">
        {results.map((r) => (
          <li key={r.instance.id} className={r.ok ? 'fg-success' : 'fg-danger'}>
            {r.ok ? <CheckIcon size={14} /> : <AlertIcon size={14} />}{' '}
            {r.instance.label || hostOf(r.instance.baseUrl)}
            {r.copy ? ' (copied rows)' : ''}: {r.message}
            {r.tables && (
              <span className="fg-muted mono">
                {' '}
                {Object.entries(r.tables)
                  .map(([t, n]) => `${t} ${n}`)
                  .join(', ')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
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
  const submit = () => onAdopt(password);
  return (
    <Dialog
      title={`Move ${card.title} to Postgres?`}
      onClose={onClose}
      footerButtons={[
        { content: 'Cancel', onClick: onClose },
        { content: 'Adopt', buttonType: 'primary', onClick: submit },
      ]}
    >
      <div className="stack">
        <p>
          The first instance copies every row to schema "{card.name}" in the shared Postgres database and
          compares the counts; the others switch without a copy. The old database stays untouched for a
          rollback.
        </p>
        <FormControl>
          <FormControl.Label>Current password (only when the member's role already exists)</FormControl.Label>
          <TextInput
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
            block
          />
          <FormControl.Caption>
            Leave empty when Octoforge creates the role "{card.name}" or created it before. If the role
            already exists for the member's own database, enter its current password: it stays unchanged, so
            the member's own DATABASE_URL keeps working. Octoforge passes it to the member once and does not
            store it.
          </FormControl.Caption>
        </FormControl>
      </div>
    </Dialog>
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
    const ok = await confirm({
      title: `Move ${card.title} to ${ENGINE_LABEL[engine]}?`,
      content: `The first instance copies every row to ${capabilities?.sharedData}/${card.name}.db and compares the counts; the others switch without a copy. The old database stays untouched for a rollback.`,
      confirmButtonContent: 'Adopt',
    });
    if (ok) await run(engine);
  };

  const release = async (s: InstanceStatus) => {
    const ok = await confirm({
      title: 'Go back to the own database?',
      content: `${hostOf(s.instance.baseUrl)} drops the adopted database setting and uses its DATABASE_URL after the next restart. Rows written since the adoption stay in the shared database only.`,
      confirmButtonContent: 'Release',
      confirmButtonType: 'danger',
    });
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
          <DatabaseIcon /> {card.title}
        </span>
      }
    >
      <div className="card-box stack">
        <div className="facts">
          <div>
            <span className="fg-muted">Engines</span>
            <div className="label-row">
              {db ? db.engines.map((e) => <Label key={e}>{ENGINE_LABEL[e]}</Label>) : <span>unknown</span>}
              {db?.schema && <Label variant="accent">named schema</Label>}
            </div>
          </div>
        </div>
        {card.instances.length === 0 ? (
          <p className="fg-muted">Not deployed: add an instance in Settings.</p>
        ) : status.loading && !status.data ? (
          <Spinner size="small" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Instance</th>
                <th>Engine</th>
                <th>Schema</th>
                <th>Source</th>
                <th aria-label="Actions" />
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
                      <td>{s.status?.database?.engine ?? <span className="fg-muted">unknown</span>}</td>
                      <td className="mono">{s.status?.database?.schema ?? '—'}</td>
                      <td>{s.status?.database ? sourceLabel(s.status.database.source) : '—'}</td>
                    </>
                  ) : (
                    <td colSpan={3} className="fg-danger">
                      {s.error}
                    </td>
                  )}
                  <td className="cell-actions">
                    {s.status?.database?.source === 'octoforge' && (
                      <Button
                        size="small"
                        variant="invisible"
                        leadingVisual={UndoIcon}
                        onClick={() => void release(s)}
                      >
                        Release
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {card.instances.length > 0 && db && (
          <div className="button-row">
            {available.map((e) => (
              <Button
                key={e}
                onClick={() => void adopt(e)}
                disabled={busy !== null}
                leadingVisual={busy === e ? () => <Spinner size="small" srText={null} /> : DatabaseIcon}
              >
                Adopt into {ENGINE_LABEL[e]}
              </Button>
            ))}
            {!available.length && (
              <span className="fg-muted small">
                No shared engine fits: set FORGE_PG_ADMIN_URL or OCTOFORGE_SHARED_DATA for an engine this
                member supports.
              </span>
            )}
          </div>
        )}
        {results && <Results results={results} />}
      </div>
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
        <div className="facts card-box">
          <div>
            <span className="fg-muted">Postgres</span>
            <div>{capabilities.postgres ? 'FORGE_PG_ADMIN_URL set' : 'not configured'}</div>
          </div>
          <div>
            <span className="fg-muted">SQLite directory</span>
            <div className="mono">{capabilities.sharedData ?? 'not configured'}</div>
          </div>
        </div>
      )}
      {members.loading && !members.data && <Spinner />}
      {cards.map((c) => (
        <MemberDatabase key={c.name} card={c} />
      ))}
      {without.length > 0 && (
        <p className="fg-muted">
          Without a database section in their manifest: {without.map((c) => c.name).join(', ')}.
        </p>
      )}
    </Page>
  );
}

import type { LogEntry, LogKind } from '@octoforge/shared';
import { useState } from 'react';
import { Ui } from 'tailor-react';
import { api } from '../api';
import { Icon, Loading, Page } from '../components/Page';
import { useAsync } from '../hooks/useAsync';
import { useToast } from '../hooks/useToast';
import { absoluteTime, relativeTime } from '../lib/format';

const KINDS: { value: LogKind | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'delivery', label: 'Deliveries' },
  { value: 'adoption', label: 'Adoptions' },
];

const ACTION_LABEL: Record<string, string> = {
  app: 'GitHub App',
  pat: 'Token',
  postgres: 'Postgres',
  sqlite: 'SQLite',
  release: 'Release',
};

function detailText(d: Record<string, unknown>): string {
  return Object.entries(d)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}

export function LogPage() {
  const { toast } = useToast();
  const [kind, setKind] = useState<LogKind | ''>('');
  const [member, setMember] = useState('');
  const members = useAsync(() => api.members(), 'members');
  const log = useAsync(
    () => api.log({ kind: kind || undefined, member: member || undefined }),
    `log:${kind}:${member}`,
  );
  const [older, setOlder] = useState<LogEntry[]>([]);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const rows = [...(log.data?.entries ?? []), ...older];
  const canMore = more || (log.data ? log.data.entries.length >= log.data.limit : false);
  const loadMore = async () => {
    const last = rows[rows.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const r = await api.log({ kind: kind || undefined, member: member || undefined, before: last.at });
      setOlder((o) => [...o, ...r.entries]);
      setMore(r.entries.length >= r.limit);
    } catch (e) {
      toast('Could not load more', { description: (e as Error).message, variant: 'critical' });
    } finally {
      setLoadingMore(false);
    }
  };
  const reset = () => {
    setOlder([]);
    setMore(false);
  };

  return (
    <Page title="Log" lead="What went where, when, and whether it worked. Never a secret.">
      <Ui.Toolbar label="Filter">
        <Ui.ButtonGroup
          filter
          label="Kind"
          options={KINDS}
          value={kind}
          onChange={(v) => {
            reset();
            setKind(v as LogKind | '');
          }}
        />
        <label htmlFor="log-member" className="t-muted">
          Member
        </label>
        <Ui.Select
          id="log-member"
          size="sm"
          data-width="auto"
          value={member}
          onChange={(e) => {
            reset();
            setMember(e.target.value);
          }}
        >
          <option value="">All</option>
          {(members.data ?? []).map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}
            </option>
          ))}
        </Ui.Select>
      </Ui.Toolbar>
      {log.loading && !log.data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Ui.EmptyState size="sm" icon="bi-send" title="Nothing logged yet">
          <p>Deliveries and adoptions show up here.</p>
        </Ui.EmptyState>
      ) : (
        <Ui.Table.Wrap>
          <Ui.Table variant="data">
            <thead>
              <tr>
                <th>When</th>
                <th>Member</th>
                <th>What</th>
                <th>Target</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={`${e.kind}-${e.id}`}>
                  <td>
                    <time dateTime={e.at} className="t-nowrap">
                      {relativeTime(e.at)}
                    </time>
                    <div className="t-muted t-small t-nowrap">{absoluteTime(e.at)}</div>
                  </td>
                  <td className="t-mono">{e.member}</td>
                  <td>
                    <Ui.Badge tone={e.kind === 'delivery' ? 'accent' : 'purple'}>
                      {e.kind === 'delivery' ? 'Delivery' : 'Adoption'}
                    </Ui.Badge>{' '}
                    {ACTION_LABEL[e.action] ?? e.action}
                  </td>
                  <td className="t-mono break">{e.target}</td>
                  <td>
                    <span className={e.ok ? 'fg-success' : 'fg-danger'}>
                      <Icon name={e.ok ? 'check-lg' : 'exclamation-triangle'} /> {e.message}
                    </span>
                    {Object.keys(e.detail).length > 0 && (
                      <div className="t-muted t-small t-mono">{detailText(e.detail)}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Ui.Table>
        </Ui.Table.Wrap>
      )}
      {canMore && rows.length > 0 && (
        <div>
          <Ui.Button type="button" onClick={() => void loadMore()} busy={loadingMore}>
            {loadingMore ? 'Loading…' : 'Older entries'}
          </Ui.Button>
        </div>
      )}
    </Page>
  );
}

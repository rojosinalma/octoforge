import type { LogEntry, LogKind } from '@octoforge/shared';
import { AlertIcon, CheckIcon } from '@primer/octicons-react';
import { Button, Label, SegmentedControl, Select, Spinner } from '@primer/react';
import { useState } from 'react';
import { api } from '../api';
import { Page } from '../components/Page';
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
      <div className="filter-row">
        <SegmentedControl aria-label="Kind">
          {KINDS.map((k) => (
            <SegmentedControl.Button
              key={k.value}
              selected={kind === k.value}
              onClick={() => {
                reset();
                setKind(k.value);
              }}
            >
              {k.label}
            </SegmentedControl.Button>
          ))}
        </SegmentedControl>
        <div className="inline-field">
          <label htmlFor="log-member" className="fg-muted">
            Member
          </label>
          <Select
            id="log-member"
            value={member}
            onChange={(e) => {
              reset();
              setMember(e.target.value);
            }}
          >
            <Select.Option value="">All</Select.Option>
            {(members.data ?? []).map((m) => (
              <Select.Option key={m.name} value={m.name}>
                {m.name}
              </Select.Option>
            ))}
          </Select>
        </div>
      </div>
      {log.loading && !log.data ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className="fg-muted">Nothing logged yet.</p>
      ) : (
        <table className="table">
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
                  <time dateTime={e.at} className="nowrap">
                    {relativeTime(e.at)}
                  </time>
                  <div className="fg-muted small nowrap">{absoluteTime(e.at)}</div>
                </td>
                <td className="mono">{e.member}</td>
                <td>
                  <Label variant={e.kind === 'delivery' ? 'accent' : 'done'}>
                    {e.kind === 'delivery' ? 'Delivery' : 'Adoption'}
                  </Label>{' '}
                  {ACTION_LABEL[e.action] ?? e.action}
                </td>
                <td className="mono break">{e.target}</td>
                <td>
                  <span className={e.ok ? 'fg-success' : 'fg-danger'}>
                    {e.ok ? <CheckIcon size={14} /> : <AlertIcon size={14} />} {e.message}
                  </span>
                  {Object.keys(e.detail).length > 0 && (
                    <div className="fg-muted small mono">{detailText(e.detail)}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canMore && rows.length > 0 && (
        <div>
          <Button onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Older entries'}
          </Button>
        </div>
      )}
    </Page>
  );
}

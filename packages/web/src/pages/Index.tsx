import type { InstanceHealth, MemberCard } from '@octoforge/shared';
import {
  GearIcon,
  KeyIcon,
  LinkExternalIcon,
  MarkGithubIcon,
  PackageIcon,
  SyncIcon,
} from '@primer/octicons-react';
import { Button, IconButton, Label, Link, SkeletonBox, Spinner } from '@primer/react';
import { Tooltip } from '@primer/react/next';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Page, StatusDot } from '../components/Page';
import { useApp } from '../hooks/useApp';
import { useAsync, useInterval } from '../hooks/useAsync';
import { useToast } from '../hooks/useToast';
import { githubSummary, hostOf } from '../lib/format';
import { linkClick, navigate, useRoute } from '../router';

function MemberIcon({ card }: { card: MemberCard }) {
  const [broken, setBroken] = useState(false);
  if (card.icon && !broken) {
    return (
      <img
        src={card.icon}
        alt=""
        width={40}
        height={40}
        className="member-icon"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className="member-icon member-icon-placeholder" aria-hidden>
      <PackageIcon size={24} />
    </span>
  );
}

function InstanceLine({ h, github }: { h: InstanceHealth; github: boolean }) {
  const state = h.up ? `up, ${h.latencyMs} ms` : `down: ${h.error ?? 'no answer'}`;
  const g = h.github;
  return (
    <li className="instance-line card-github">
      <StatusDot up={h.up} label={h.up ? 'up' : 'down'} />
      <Link href={h.instance.baseUrl} target="_blank" rel="noreferrer" className="instance-link">
        {h.instance.label || hostOf(h.instance.baseUrl)}
      </Link>
      <span className={h.up ? 'fg-muted' : 'fg-danger'}>{state}</span>
      {github && g && (
        <span className="fg-muted cell-inline">
          <KeyIcon size={12} /> {githubSummary(g)}
        </span>
      )}
      {github && g && g.missing.length > 0 && (
        <Label variant="attention" size="small">
          missing: {g.missing.join(', ')}
        </Label>
      )}
    </li>
  );
}

function Card({ card }: { card: MemberCard }) {
  const m = card.manifest;
  const credentialsPath = `/members/${card.name}/credentials`;
  return (
    <article className="member-card">
      <div className="member-card-head">
        <MemberIcon card={card} />
        <div className="member-card-title">
          <h2>{card.title}</h2>
          <span className="fg-muted mono">{card.name}</span>
        </div>
        {card.instances.length === 0 && <Label variant="secondary">Not deployed</Label>}
      </div>
      {card.description ? (
        <p className="member-card-desc">{card.description}</p>
      ) : (
        <p className="member-card-desc fg-muted">
          No manifest yet{card.manifestError ? ` (${card.manifestError})` : ''}.
        </p>
      )}
      {card.instances.length > 0 && (
        <ul className="instance-lines">
          {card.instances.map((h) => (
            <InstanceLine key={h.instance.id} h={h} github={Boolean(m?.github)} />
          ))}
        </ul>
      )}
      <div className="member-card-foot">
        {card.repoUrl && (
          <Link href={card.repoUrl} target="_blank" rel="noreferrer" muted className="icon-link">
            <MarkGithubIcon size={14} /> Repository
          </Link>
        )}
        {card.homepage && card.homepage !== card.repoUrl && (
          <Link href={card.homepage} target="_blank" rel="noreferrer" muted className="icon-link">
            <LinkExternalIcon size={14} /> Homepage
          </Link>
        )}
        <span className="spacer" />
        {m?.github && (
          <Button
            size="small"
            leadingVisual={KeyIcon}
            as="a"
            href={credentialsPath}
            onClick={linkClick(credentialsPath)}
          >
            Credentials
          </Button>
        )}
        {card.instances.length === 0 && (
          <Button
            size="small"
            leadingVisual={GearIcon}
            as="a"
            href="/settings"
            onClick={linkClick('/settings')}
          >
            Add instance
          </Button>
        )}
      </div>
    </article>
  );
}

export function IndexPage() {
  const { settings } = useApp();
  const { toast } = useToast();
  const route = useRoute();
  const state = useAsync(() => api.members(), 'members');
  const [refreshing, setRefreshing] = useState(false);
  useInterval(() => void state.reload(), settings.indexRefreshSec * 1000);

  // Errors handed over by a redirect (the App callback) arrive as ?error=.
  const error = route.query.get('error');
  useEffect(() => {
    if (!error) return;
    toast('GitHub App not created', { description: error, variant: 'critical', ttlMs: 12_000 });
    navigate('/', { replace: true });
  }, [error, toast]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      state.setData(await api.members(true));
    } catch (e) {
      toast('Refresh failed', { description: (e as Error).message, variant: 'critical' });
    } finally {
      setRefreshing(false);
    }
  };

  const cards = state.data;
  return (
    <Page
      title="Members"
      lead="Every tool of the family, its instances and their health."
      actions={
        <Tooltip text="Read manifests and health again" direction="w">
          <IconButton
            icon={refreshing ? () => <Spinner size="small" srText={null} /> : SyncIcon}
            aria-label="Refresh"
            onClick={() => void refresh()}
            disabled={refreshing}
          />
        </Tooltip>
      }
    >
      {state.error && !cards && <p className="fg-danger">Could not load members: {state.error.message}</p>}
      <div className="member-grid">
        {cards
          ? cards.map((c) => <Card key={c.name} card={c} />)
          : [0, 1].map((i) => <SkeletonBox key={i} height="180px" className="member-card-skeleton" />)}
      </div>
      {cards && cards.length === 0 && <p className="fg-muted">No members: .gitmodules lists no submodule.</p>}
    </Page>
  );
}

import type { InstanceHealth, MemberCard, SwitcherState } from '@octoforge/shared';
import { useEffect, useState } from 'react';
import { Ui } from 'tailor-react';
import { api } from '../api';
import { Icon, LinkButton, Page, StatusDot } from '../components/Page';
import { useApp } from '../hooks/useApp';
import { useAsync, useInterval } from '../hooks/useAsync';
import { useToast } from '../hooks/useToast';
import { githubSummary, hostOf, relativeTime } from '../lib/format';
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
      <Ui.Icon name="bi-box-seam" size="lg" />
    </span>
  );
}

/** `switcher: sent 3 minutes ago`, `switcher: not supported`, `switcher: failed: <reason>`. */
function switcherText(s: SwitcherState): string {
  if (s.state === 'sent') return `switcher: sent ${relativeTime(s.at)}`;
  if (s.state === 'unsupported') return 'switcher: not supported';
  return `switcher: failed: ${s.reason ?? 'no reason given'}`;
}

function InstanceLine({ h, github }: { h: InstanceHealth; github: boolean }) {
  const state = h.up ? `up, ${h.latencyMs} ms` : `down: ${h.error ?? 'no answer'}`;
  const g = h.github;
  return (
    <li className="instance-line">
      <StatusDot up={h.up} label={h.up ? 'up' : 'down'} />
      <a href={h.openUrl} target="_blank" rel="noreferrer" className="instance-link">
        {h.instance.label || hostOf(h.openUrl)}
      </a>
      <span className={h.up ? 't-muted' : 'fg-danger'}>{state}</span>
      {github && g && (
        <span className="t-muted cell-inline">
          <Icon name="key" /> {githubSummary(g)}
        </span>
      )}
      {github && g && g.missing.length > 0 && (
        <Ui.Badge tone="warning" size="sm">
          missing: {g.missing.join(', ')}
        </Ui.Badge>
      )}
      {h.switcher && (
        <small className={h.switcher.state === 'failed' ? 'fg-danger' : 't-muted'}>
          {switcherText(h.switcher)}
        </small>
      )}
    </li>
  );
}

function Card({ card }: { card: MemberCard }) {
  const m = card.manifest;
  const credentialsPath = `/members/${card.name}/credentials`;
  return (
    <Ui.Card className="member-card">
      <Ui.Card.Header>
        <MemberIcon card={card} />
        <div className="member-card-title">
          <h2 className="t-card-title">
            {card.openUrl ? (
              <a href={card.openUrl} target="_blank" rel="noreferrer" className="member-card-link">
                {card.title}
              </a>
            ) : (
              card.title
            )}
          </h2>
          <span className="t-muted t-mono t-small">{card.name}</span>
        </div>
        {card.instances.length === 0 && (
          <Ui.Card.Tools>
            <Ui.Badge tone="neutral">Not deployed</Ui.Badge>
          </Ui.Card.Tools>
        )}
      </Ui.Card.Header>
      <Ui.Card.Body className="t-stack">
        {card.description ? (
          <p className="member-card-desc">{card.description}</p>
        ) : (
          <p className="member-card-desc t-muted">
            No manifest yet{card.manifestError ? ` (${card.manifestError})` : ''}.
          </p>
        )}
        {card.instances.length > 0 && (
          <ul className="instance-lines t-plain-list">
            {card.instances.map((h) => (
              <InstanceLine key={h.instance.id} h={h} github={Boolean(m?.github)} />
            ))}
          </ul>
        )}
      </Ui.Card.Body>
      <Ui.Card.Footer className="member-card-foot">
        {card.repoUrl && (
          <a href={card.repoUrl} target="_blank" rel="noreferrer" className="t-muted icon-link">
            <Icon name="github" /> Repository
          </a>
        )}
        {card.homepage && card.homepage !== card.repoUrl && (
          <a href={card.homepage} target="_blank" rel="noreferrer" className="t-muted icon-link">
            <Icon name="box-arrow-up-right" /> Homepage
          </a>
        )}
        <span className="spacer" />
        {card.openUrl && (
          <LinkButton href={card.openUrl} external size="sm" variant="primary" icon="box-arrow-up-right">
            Open
          </LinkButton>
        )}
        {m?.github && (
          <LinkButton href={credentialsPath} onClick={linkClick(credentialsPath)} size="sm" icon="key">
            Credentials
          </LinkButton>
        )}
        {card.instances.length === 0 && (
          <LinkButton href="/settings" onClick={linkClick('/settings')} size="sm" icon="gear">
            Add instance
          </LinkButton>
        )}
      </Ui.Card.Footer>
    </Ui.Card>
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
        <Ui.Button
          iconOnly
          type="button"
          aria-label="Refresh"
          tip="Read manifests and health again"
          tipAt="left"
          busy={refreshing}
          onClick={() => void refresh()}
        >
          {refreshing ? <Ui.Spinner size="sm" label={null} /> : <Icon name="arrow-repeat" />}
        </Ui.Button>
      }
    >
      {state.error && !cards && <p className="fg-danger">Could not load members: {state.error.message}</p>}
      <div className="member-grid">
        {cards
          ? cards.map((c) => <Card key={c.name} card={c} />)
          : [0, 1].map((i) => (
              <Ui.Card key={i} className="member-card member-card-loading" aria-busy="true">
                <Ui.Card.Body>
                  <Ui.Spinner />
                </Ui.Card.Body>
              </Ui.Card>
            ))}
      </div>
      {cards && cards.length === 0 && (
        <Ui.EmptyState icon="bi-box-seam" title="No members">
          <p>.gitmodules lists no submodule.</p>
        </Ui.EmptyState>
      )}
    </Page>
  );
}

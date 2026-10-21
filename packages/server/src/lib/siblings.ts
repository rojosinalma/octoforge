import {
  type Instance,
  type MemberCard,
  resolvePublicUrl,
  type SiblingList,
  type SiblingRun,
  type SwitcherState,
} from '@octoforge/shared';
import { errMessage, log } from '../log';
import type { MemberRegistry } from './members';

const logger = log('siblings');

export interface SiblingsDeps {
  members: MemberRegistry;
  /** Every configured instance, ordered by member and id. */
  instances: () => Promise<Instance[]>;
  /** Minutes between two scheduled runs (setting `siblingsResendMin`), read before each wait. */
  resendMin: () => Promise<number>;
  token?: string;
  publicUrl?: string;
  /** Wait after `start()` before the first run, so the members of a joint restart are up. */
  startDelayMs?: number;
  /** Calls in flight at once within one run. */
  concurrency?: number;
}

/**
 * Builds the sibling list of docs/members.md and pushes it to every instance of every member: at
 * start-up, after each instance change and on a schedule. One run at a time; a trigger during a run
 * queues exactly one more. Outcomes per instance stay in memory, bounded by the instance list.
 */
export class Siblings {
  private readonly states = new Map<number, SwitcherState>();
  private current: Promise<SiblingRun> | null = null;
  private queued: Promise<SiblingRun> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private skipLogged = false;

  constructor(private readonly deps: SiblingsDeps) {}

  /** Why the list cannot be sent, or null. */
  get disabledReason(): string | null {
    if (!this.deps.token) return 'OCTOFORGE_TOKEN is not set';
    if (!this.deps.publicUrl) return 'PUBLIC_URL is not set';
    return null;
  }

  /** Begins the schedule: a first run after the start delay, then one every `siblingsResendMin`. */
  start(): void {
    if (this.active) return;
    this.active = true;
    this.arm(this.deps.startDelayMs ?? 10_000, 'start-up');
  }

  stop(): void {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private arm(ms: number, reason: string): void {
    if (!this.active) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.send(reason)
        .catch(() => undefined)
        .then(async () => {
          let min = 60;
          try {
            min = await this.deps.resendMin();
          } catch (err) {
            logger.warn('cannot read siblingsResendMin; using 60 min', { reason: errMessage(err) });
          }
          this.arm(min * 60_000, 'schedule');
        });
    }, ms);
    (this.timer as { unref?: () => void }).unref?.();
  }

  /** The last push to an instance, for the members page. */
  stateOf(instanceId: number): SwitcherState | null {
    return this.states.get(instanceId) ?? null;
  }

  /** Copies of the cards with each instance's switcher state filled in. */
  decorate(cards: MemberCard[]): MemberCard[] {
    return cards.map((c) => ({
      ...c,
      instances: c.instances.map((h) => ({ ...h, switcher: this.stateOf(h.instance.id) })),
    }));
  }

  /**
   * An instance was added or changed: forget every "not supported" mark (a member may have been
   * upgraded) and send the list again. No-op before `start()`.
   */
  changed(): void {
    this.clearUnsupported();
    if (this.active) void this.send('instance change').catch(() => undefined);
  }

  /** Manual push from the UI: retries "not supported" instances too. */
  sendNow(): Promise<SiblingRun> {
    this.clearUnsupported();
    return this.send('manual');
  }

  /**
   * An instance is about to be removed: clear its switcher (best effort, outcome logged only) and
   * forget its state. The caller drops the row and then calls `changed()` for the rest.
   */
  async retract(inst: Instance): Promise<void> {
    const known = this.states.get(inst.id);
    this.states.delete(inst.id);
    if (!this.deps.token || known?.state === 'unsupported') return;
    try {
      const r = await (await this.deps.members.client(inst.baseUrl, { quiet: true })).deleteSiblings();
      logger.debug(`DELETE ${inst.baseUrl}/api/octoforge/siblings`, {
        outcome: r.ok ? 'ok' : r.status === 404 ? 'not supported' : r.message,
      });
      if (!r.ok && r.status !== 404) {
        logger.warn('sibling list not cleared on the removed instance', {
          instance: inst.baseUrl,
          reason: r.message,
        });
      }
    } catch (err) {
      logger.warn('sibling list not cleared on the removed instance', {
        instance: inst.baseUrl,
        reason: errMessage(err),
      });
    }
  }

  /** Runs now, or after the run in progress (at most one queued run; later triggers join it). */
  send(reason: string): Promise<SiblingRun> {
    if (!this.current) {
      this.current = this.run(reason).finally(() => {
        this.current = null;
      });
      return this.current;
    }
    if (!this.queued) {
      this.queued = this.current
        .catch(() => undefined)
        .then(() => {
          this.queued = null;
          return this.send(reason);
        });
    }
    return this.queued;
  }

  /** Resolves when no run is in progress or queued (tests and shutdown). */
  async idle(): Promise<void> {
    while (this.current || this.queued) await (this.queued ?? this.current)?.catch(() => undefined);
  }

  /** The list every instance receives (the receiving member is in it too). */
  async build(instances?: Instance[]): Promise<SiblingList> {
    const forgeUrl = this.deps.publicUrl?.replace(/\/+$/, '') ?? '';
    const all = instances ?? (await this.deps.instances());
    const entries = await Promise.all(
      this.deps.members.list().map(async (entry): Promise<SiblingList['members'][number] | null> => {
        // First instance in Octoforge's list = the oldest one.
        const inst = all.filter((i) => i.member === entry.name).sort((a, b) => a.id - b.id)[0];
        if (!inst) return null;
        const [lookup, url] = await Promise.all([this.deps.members.manifest(entry), this.urlOf(inst)]);
        const m = lookup.manifest;
        return {
          name: entry.name,
          title: m?.title ?? entry.name,
          url,
          ...(m?.icon ? { icon: `${url}${m.icon}` } : {}),
        };
      }),
    );
    const members = entries.filter((e): e is SiblingList['members'][number] => e !== null);
    return {
      forge: { title: 'Octoforge', url: forgeUrl, icon: `${forgeUrl}/favicon.svg` },
      members,
      updated_at: new Date().toISOString(),
    };
  }

  /** Instance public URL, else the member's reported `public_url`, else the base URL. */
  private async urlOf(inst: Instance): Promise<string> {
    if (inst.publicUrl) return resolvePublicUrl(inst).url;
    const r = await (await this.deps.members.client(inst.baseUrl, { quiet: true })).status();
    return resolvePublicUrl(inst, r.ok ? r.data.public_url : null).url;
  }

  private clearUnsupported(): void {
    for (const [id, s] of this.states) if (s.state === 'unsupported') this.states.delete(id);
  }

  private async run(reason: string): Promise<SiblingRun> {
    const skipped = this.disabledReason;
    if (skipped) {
      if (!this.skipLogged) logger.info(`sibling list not sent: ${skipped}`);
      this.skipLogged = true;
      return { skipped, total: 0, sent: 0, unsupported: 0, failed: 0 };
    }
    const known = new Set(this.deps.members.list().map((s) => s.name));
    const instances = (await this.deps.instances()).filter((i) => known.has(i.member));
    // Bounded by the instance list: states of removed instances go.
    const ids = new Set(instances.map((i) => i.id));
    for (const id of this.states.keys()) if (!ids.has(id)) this.states.delete(id);

    const list = await this.build(instances);
    const targets = instances.filter((i) => this.states.get(i.id)?.state !== 'unsupported');
    const out: SiblingRun = { skipped: null, total: targets.length, sent: 0, unsupported: 0, failed: 0 };
    const queue = [...targets];
    const worker = async () => {
      for (let inst = queue.shift(); inst; inst = queue.shift()) {
        const state = await this.push(inst, list);
        out[state.state === 'sent' ? 'sent' : state.state === 'unsupported' ? 'unsupported' : 'failed']++;
      }
    };
    const width = Math.max(1, Math.min(this.deps.concurrency ?? 4, queue.length));
    await Promise.all(Array.from({ length: width }, worker));
    logger.info('sibling list sent', {
      reason,
      members: list.members.length,
      instances: out.total,
      sent: out.sent,
      unsupported: out.unsupported,
      failed: out.failed,
      suppressed: instances.length - targets.length,
    });
    return out;
  }

  private async push(inst: Instance, list: SiblingList): Promise<SwitcherState> {
    const at = new Date().toISOString();
    let state: SwitcherState;
    try {
      const r = await (await this.deps.members.client(inst.baseUrl, { quiet: true })).putSiblings(list);
      if (r.ok) state = { state: 'sent', at, reason: null };
      else if (r.status === 404) state = { state: 'unsupported', at, reason: null };
      else state = { state: 'failed', at, reason: r.message };
    } catch (err) {
      state = { state: 'failed', at, reason: errMessage(err) };
    }
    logger.debug(`PUT ${inst.baseUrl}/api/octoforge/siblings`, {
      outcome: state.state === 'failed' ? state.reason : state.state,
    });
    if (state.state === 'failed') {
      logger.warn('sibling list not delivered', { instance: inst.baseUrl, reason: state.reason });
    } else if (state.state === 'unsupported' && this.states.get(inst.id)?.state !== 'unsupported') {
      logger.info('instance has no switcher (404); not sent again until an instance changes', {
        instance: inst.baseUrl,
      });
    }
    this.states.set(inst.id, state);
    return state;
  }
}

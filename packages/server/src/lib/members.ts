import fs from 'node:fs';
import type {
  Instance,
  InstanceGithub,
  InstanceHealth,
  Manifest,
  ManifestSource,
  MemberCard,
} from '@octoforge/shared';
import { parseManifest, parseMembersFile, resolvePublicUrl } from '@octoforge/shared';
import { errMessage, log } from '../log';
import { type FetchLike, readJson, timedFetch } from './http';
import { MemberClient } from './member-client';

/** The shared App's id and slug, to name it on the cards. */
export interface SharedAppRef {
  id: number;
  slug: string;
}

/** One entry of `members.json`: a member of the family. */
export interface Member {
  name: string;
  /** `owner/name` on GitHub. */
  repo: string;
  homepage: string | null;
}

export class MembersFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MembersFileError';
  }
}

function readMembersFile(file: string): Member[] {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new MembersFileError(`cannot read ${file}: ${errMessage(err)}`);
  }
  const r = parseMembersFile(text);
  if (!r.ok) throw new MembersFileError(`${file}: ${r.error}`);
  return r.members.map((m) => ({ name: m.name, repo: m.repo, homepage: m.homepage ?? null }));
}

/**
 * The member list from `members.json`. Read once now (a bad file throws, so start-up fails with
 * the reason), then again whenever its mtime changes; a bad edit later keeps the last good list.
 */
export function membersFromFile(file: string): () => Member[] {
  let list = readMembersFile(file);
  let mtime = fs.statSync(file).mtimeMs;
  return () => {
    let now: number;
    try {
      now = fs.statSync(file).mtimeMs;
    } catch (err) {
      log('members').warn('cannot stat the member list; keeping the last one', {
        file,
        reason: errMessage(err),
      });
      return list;
    }
    if (now === mtime) return list;
    mtime = now;
    try {
      list = readMembersFile(file);
      log('members').info('member list reloaded', { file, members: list.length });
    } catch (err) {
      log('members').warn('member list is invalid; keeping the last one', { reason: errMessage(err) });
    }
    return list;
  };
}

export interface ManifestLookup {
  manifest: Manifest | null;
  source: ManifestSource;
  error: string | null;
}

interface CacheEntry {
  at: number;
  value: ManifestLookup;
}

export interface MemberRegistryDeps {
  members: () => Member[];
  instances: (member?: string) => Promise<Instance[]>;
  timeoutMs: () => Promise<number>;
  cacheMs: () => Promise<number>;
  token?: string;
  fetchImpl?: FetchLike;
}

/** Members from `members.json`, their manifests (instance first, then GitHub) and live instance health. */
export class MemberRegistry {
  private readonly cache = new Map<string, CacheEntry>();
  constructor(private readonly deps: MemberRegistryDeps) {}

  list(): Member[] {
    return this.deps.members();
  }

  find(name: string): Member | null {
    return this.list().find((s) => s.name === name) ?? null;
  }

  async client(baseUrl: string, opts: { quiet?: boolean } = {}): Promise<MemberClient> {
    return new MemberClient({
      baseUrl,
      token: this.deps.token,
      timeoutMs: await this.deps.timeoutMs(),
      fetchImpl: this.deps.fetchImpl,
      quiet: opts.quiet,
    });
  }

  /** The member's manifest: from the first instance that serves one, else its default branch on GitHub. */
  async manifest(member: Member, opts: { fresh?: boolean } = {}): Promise<ManifestLookup> {
    const ttl = await this.deps.cacheMs();
    const hit = this.cache.get(member.name);
    if (!opts.fresh && hit && Date.now() - hit.at < ttl) return hit.value;
    const value = await this.lookup(member);
    // Bounded by the member list: one entry per member, stale names dropped.
    const names = new Set(this.list().map((s) => s.name));
    for (const k of this.cache.keys()) if (!names.has(k)) this.cache.delete(k);
    if (value.manifest || value.source === 'none') this.cache.set(member.name, { at: Date.now(), value });
    return value;
  }

  private async lookup(member: Member): Promise<ManifestLookup> {
    const errors: string[] = [];
    for (const inst of await this.deps.instances(member.name)) {
      const r = await (await this.client(inst.baseUrl)).manifest();
      if (r.ok) {
        if (r.data.name !== member.name) {
          errors.push(`${inst.baseUrl} serves the manifest of ${r.data.name}`);
          continue;
        }
        return { manifest: r.data, source: 'instance', error: null };
      }
      errors.push(`${inst.baseUrl}: ${r.message}`);
    }
    const url = `https://raw.githubusercontent.com/${member.repo}/HEAD/octoforge.json`;
    const out = await timedFetch('members', url, {
      timeoutMs: await this.deps.timeoutMs(),
      fetchImpl: this.deps.fetchImpl,
    });
    if (out.ok && out.res.ok) {
      const parsed = parseManifest(await readJson(out.res));
      if (parsed.ok && parsed.manifest.name === member.name)
        return { manifest: parsed.manifest, source: 'github', error: null };
      errors.push(
        parsed.ok ? `octoforge.json names ${parsed.manifest.name}` : `octoforge.json: ${parsed.error}`,
      );
    } else if (out.ok && out.res.status === 404) {
      await out.res.body?.cancel().catch(() => {});
      errors.push('no octoforge.json on the default branch yet');
    } else {
      errors.push(out.ok ? `GitHub answered HTTP ${out.res.status}` : out.message);
    }
    return { manifest: null, source: 'none', error: errors.join('; ') || null };
  }

  async health(inst: Instance, path: string): Promise<InstanceHealth> {
    const h = await (await this.client(inst.baseUrl)).health(path);
    return {
      instance: inst,
      openUrl: resolvePublicUrl(inst).url,
      up: h.up,
      httpStatus: h.httpStatus,
      latencyMs: h.ms,
      error: h.error,
      github: null,
      switcher: null,
    };
  }

  /**
   * The instance's status in short: its GitHub credential (null when the member needs none) and the
   * public URL it reports. Both null without the member token or when it does not answer.
   */
  async status(
    inst: Instance,
    sharedApp: SharedAppRef | null,
    wantsGithub: boolean,
  ): Promise<{ github: InstanceGithub | null; publicUrl: string | null }> {
    if (!this.deps.token) return { github: null, publicUrl: null };
    const r = await (await this.client(inst.baseUrl)).status();
    if (!r.ok) return { github: null, publicUrl: null };
    const publicUrl = r.data.public_url ?? null;
    const g = wantsGithub ? r.data.github : null;
    if (!g) return { github: null, publicUrl };
    const appId = g.app_id ?? null;
    return {
      publicUrl,
      github: {
        mode: g.mode,
        source: g.source,
        appId,
        appSlug:
          sharedApp && appId !== null && String(appId) === String(sharedApp.id) ? sharedApp.slug : null,
        login: g.login ?? null,
        missing: g.missing ?? [],
      },
    };
  }

  /** One card: manifest facts, a health probe per instance (and its GitHub credential), links. */
  async card(
    member: Member,
    opts: { fresh?: boolean; sharedApp?: SharedAppRef | null } = {},
  ): Promise<MemberCard> {
    const [lookup, instances] = await Promise.all([
      this.manifest(member, opts),
      this.deps.instances(member.name),
    ]);
    const m = lookup.manifest;
    const healthPath = m?.health ?? '/health';
    const healths = await Promise.all(
      instances.map(async (i) => {
        const [h, st] = await Promise.all([
          this.health(i, healthPath),
          this.status(i, opts.sharedApp ?? null, Boolean(m?.github)),
        ]);
        const openUrl = resolvePublicUrl(i, h.up ? st.publicUrl : null).url;
        return { ...h, openUrl, github: h.up ? st.github : null };
      }),
    );
    const up = healths.find((h) => h.up);
    const repoUrl = `https://github.com/${member.repo}`;
    return {
      name: member.name,
      title: m?.title ?? member.name.charAt(0).toUpperCase() + member.name.slice(1),
      description: m?.description ?? '',
      icon: m?.icon && up ? `${up.instance.baseUrl}${m.icon}` : null,
      homepage: member.homepage ?? repoUrl,
      repoUrl,
      openUrl: (up ?? healths[0])?.openUrl ?? null,
      manifest: m,
      manifestSource: lookup.source,
      manifestError: lookup.error,
      instances: healths,
    };
  }
}

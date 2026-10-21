import fs from 'node:fs';
import type { Instance, InstanceHealth, Manifest, ManifestSource, MemberCard } from '@octoforge/shared';
import { parseManifest } from '@octoforge/shared';
import { errMessage, log } from '../log';
import { type FetchLike, readJson, timedFetch } from './http';
import { MemberClient } from './member-client';

/** One entry of `.gitmodules`: a member of the family. */
export interface Submodule {
  name: string;
  path: string;
  url: string;
  homepage: string | null;
  /** `owner/repo` on GitHub, when the URL points there. */
  repo: string | null;
}

/** Parses `.gitmodules` (git-config syntax). Unknown keys are ignored. */
export function parseGitmodules(text: string): Submodule[] {
  const out: Submodule[] = [];
  let cur: Record<string, string> | null = null;
  let curName = '';
  const flush = () => {
    if (!cur?.path || !cur.url) return;
    const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(cur.url);
    out.push({
      name: curName,
      path: cur.path,
      url: cur.url,
      homepage: cur.homepage ?? null,
      repo: m ? `${m[1]}/${m[2]}` : null,
    });
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[#;].*$/, '').trim();
    if (!line) continue;
    const section = /^\[submodule\s+"([^"]+)"\]$/.exec(line);
    if (section) {
      flush();
      cur = {};
      curName = section[1] ?? '';
      continue;
    }
    if (line.startsWith('[')) {
      flush();
      cur = null;
      continue;
    }
    const kv = /^([A-Za-z][A-Za-z0-9-]*)\s*=\s*(.*)$/.exec(line);
    if (kv && cur) cur[(kv[1] ?? '').toLowerCase()] = (kv[2] ?? '').replace(/^"(.*)"$/, '$1');
  }
  flush();
  return out;
}

export function readSubmodules(file: string): Submodule[] {
  try {
    return parseGitmodules(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    log('members').warn('cannot read .gitmodules; the index is empty', { file, reason: errMessage(err) });
    return [];
  }
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
  submodules: () => Submodule[];
  instances: (member?: string) => Promise<Instance[]>;
  timeoutMs: () => Promise<number>;
  cacheMs: () => Promise<number>;
  token?: string;
  fetchImpl?: FetchLike;
}

/** Members from `.gitmodules`, their manifests (instance first, then GitHub) and live instance health. */
export class MemberRegistry {
  private readonly cache = new Map<string, CacheEntry>();
  constructor(private readonly deps: MemberRegistryDeps) {}

  list(): Submodule[] {
    return this.deps.submodules();
  }

  find(name: string): Submodule | null {
    return this.list().find((s) => s.name === name) ?? null;
  }

  async client(baseUrl: string): Promise<MemberClient> {
    return new MemberClient({
      baseUrl,
      token: this.deps.token,
      timeoutMs: await this.deps.timeoutMs(),
      fetchImpl: this.deps.fetchImpl,
    });
  }

  /** The member's manifest: from the first instance that serves one, else its default branch on GitHub. */
  async manifest(sub: Submodule, opts: { fresh?: boolean } = {}): Promise<ManifestLookup> {
    const ttl = await this.deps.cacheMs();
    const hit = this.cache.get(sub.name);
    if (!opts.fresh && hit && Date.now() - hit.at < ttl) return hit.value;
    const value = await this.lookup(sub);
    // Bounded by the member list: one entry per submodule, stale names dropped.
    const names = new Set(this.list().map((s) => s.name));
    for (const k of this.cache.keys()) if (!names.has(k)) this.cache.delete(k);
    if (value.manifest || value.source === 'none') this.cache.set(sub.name, { at: Date.now(), value });
    return value;
  }

  private async lookup(sub: Submodule): Promise<ManifestLookup> {
    const errors: string[] = [];
    for (const inst of await this.deps.instances(sub.name)) {
      const r = await (await this.client(inst.baseUrl)).manifest();
      if (r.ok) {
        if (r.data.name !== sub.name) {
          errors.push(`${inst.baseUrl} serves the manifest of ${r.data.name}`);
          continue;
        }
        return { manifest: r.data, source: 'instance', error: null };
      }
      errors.push(`${inst.baseUrl}: ${r.message}`);
    }
    if (sub.repo) {
      const url = `https://raw.githubusercontent.com/${sub.repo}/HEAD/octoforge.json`;
      const out = await timedFetch('members', url, {
        timeoutMs: await this.deps.timeoutMs(),
        fetchImpl: this.deps.fetchImpl,
      });
      if (out.ok && out.res.ok) {
        const parsed = parseManifest(await readJson(out.res));
        if (parsed.ok && parsed.manifest.name === sub.name)
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
    }
    return { manifest: null, source: 'none', error: errors.join('; ') || null };
  }

  async health(inst: Instance, path: string): Promise<InstanceHealth> {
    const h = await (await this.client(inst.baseUrl)).health(path);
    return { instance: inst, up: h.up, httpStatus: h.httpStatus, latencyMs: h.ms, error: h.error };
  }

  /** One card: manifest facts, a health probe per instance, links. */
  async card(sub: Submodule, opts: { fresh?: boolean } = {}): Promise<MemberCard> {
    const [lookup, instances] = await Promise.all([this.manifest(sub, opts), this.deps.instances(sub.name)]);
    const m = lookup.manifest;
    const healthPath = m?.health ?? '/health';
    const healths = await Promise.all(instances.map((i) => this.health(i, healthPath)));
    const up = healths.find((h) => h.up);
    const repoUrl = sub.repo ? `https://github.com/${sub.repo}` : null;
    return {
      name: sub.name,
      title: m?.title ?? sub.name.charAt(0).toUpperCase() + sub.name.slice(1),
      description: m?.description ?? '',
      icon: m?.icon && up ? `${up.instance.baseUrl}${m.icon}` : null,
      homepage: sub.homepage ?? repoUrl,
      repoUrl,
      manifest: m,
      manifestSource: lookup.source,
      manifestError: lookup.error,
      instances: healths,
    };
  }
}

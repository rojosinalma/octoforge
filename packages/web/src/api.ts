import type {
  AdoptResult,
  ApiErrKind,
  ApiResult,
  Capabilities,
  DeliveryResult,
  Engine,
  GitHubAppManifest,
  Installation,
  Instance,
  InstanceStatus,
  LogEntry,
  LogKind,
  MemberCard,
  PendingCredential,
  Settings,
  SettingsPatch,
} from '@octoforge/shared';
import { API } from '@octoforge/shared';

export class ApiError extends Error {
  readonly kind: ApiErrKind;
  readonly status: number;
  constructor(message: string, kind: ApiErrKind, status: number) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }
}

type Listener = (err: ApiError) => void;
const authListeners = new Set<Listener>();
/** Fires on every `auth` error so the shell can drop to the login page. */
export function onAuthError(listener: Listener): () => void {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

async function request<T extends object>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('content-type'))
    headers.set('content-type', 'application/json');
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  } catch (e) {
    throw new ApiError(`Network error: ${(e as Error).message}`, 'system', 0);
  }
  let body: ApiResult<T> | null = null;
  try {
    body = (await res.json()) as ApiResult<T>;
  } catch {
    body = null;
  }
  if (!body) {
    throw new ApiError(
      res.ok ? 'Empty response' : `HTTP ${res.status}`,
      res.status === 401 ? 'auth' : 'system',
      res.status,
    );
  }
  if (body.ok === false) {
    const kind: ApiErrKind = body.kind ?? (res.status === 401 ? 'auth' : 'system');
    const err = new ApiError(body.message || `HTTP ${res.status}`, kind, res.status);
    if (kind === 'auth') for (const l of authListeners) l(err);
    throw err;
  }
  return body as T;
}

const send = <T extends object>(method: string, path: string, data?: unknown) =>
  request<T>(path, { method, body: data === undefined ? undefined : JSON.stringify(data) });

export interface Message {
  message: string;
}

export const api = {
  authStatus: () => request<{ authenticated: boolean; required: boolean }>('/auth/status'),
  login: (password: string) => send<Message>('POST', '/auth/login', { password }),
  logout: () => send<Message>('POST', '/auth/logout'),
  capabilities: () => request<{ capabilities: Capabilities }>(API.capabilities).then((r) => r.capabilities),
  settings: () => request<{ settings: Settings }>(API.settings).then((r) => r.settings),
  patchSettings: (patch: SettingsPatch) => send<{ settings: Settings }>('PUT', API.settings, patch),
  members: (fresh = false) =>
    request<{ members: MemberCard[] }>(`${API.members}${fresh ? '?fresh=1' : ''}`).then((r) => r.members),
  member: (m: string, fresh = false) =>
    request<{ member: MemberCard }>(`${API.member(m)}${fresh ? '?fresh=1' : ''}`).then((r) => r.member),
  status: (m: string) => request<{ statuses: InstanceStatus[] }>(API.status(m)).then((r) => r.statuses),
  instances: () => request<{ instances: Instance[] }>(API.instances).then((r) => r.instances),
  addInstance: (member: string, baseUrl: string, label: string, publicUrl: string | null) =>
    send<{ instance: Instance } & Message>('POST', API.instances, { member, baseUrl, publicUrl, label }),
  setPublicUrl: (id: number, publicUrl: string | null) =>
    send<{ instance: Instance } & Message>('PATCH', API.instance(id), { publicUrl }),
  removeInstance: (id: number) => send<Message>('DELETE', API.instance(id)),
  startApp: (m: string, input: { instanceId: number; name: string; org: string | null }) =>
    send<{ action: string; manifest: GitHubAppManifest; state: string }>('POST', API.appStart(m), input),
  addToken: (m: string, token: string) =>
    send<{ pending: PendingCredential } & Message>('POST', API.pat(m), { token }),
  pending: (m: string) =>
    request<{ pending: PendingCredential[] }>(`${API.pending}?member=${encodeURIComponent(m)}`).then(
      (r) => r.pending,
    ),
  discard: (id: string) => send<Message>('DELETE', API.pendingOne(id)),
  installations: (id: string) =>
    request<{ installations: Installation[] }>(API.installations(id)).then((r) => r.installations),
  deliver: (id: string, instanceIds: number[], installationId: number | null) =>
    send<{ results: DeliveryResult[]; cleared: boolean } & Message>('POST', API.deliver(id), {
      instanceIds,
      installationId,
    }),
  envBlock: (id: string, installationId: number | null) =>
    send<{ env: string } & Message>('POST', API.envBlock(id), { installationId }),
  revoke: (m: string, id: number) =>
    send<Message & { restartRequired: boolean | null }>('DELETE', API.revoke(m, id)),
  adopt: (m: string, engine: Engine) =>
    send<{ results: AdoptResult[]; schema: string; url: string } & Message>('POST', API.adopt(m), { engine }),
  release: (m: string, id: number) => send<{ result: AdoptResult } & Message>('DELETE', API.release(m, id)),
  log: (q: { kind?: LogKind; member?: string; before?: string }) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v) p.set(k, v);
    return request<{ entries: LogEntry[]; limit: number }>(`${API.log}?${p}`);
  },
};

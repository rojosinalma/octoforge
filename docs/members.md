# Member contract (version 1)

A member is a tool that works on its own and also plugs into Octoforge. Everything here is
optional for standalone use: a member without `OCTOFORGE_TOKEN` behaves exactly as before.

Octoforge uses the contract for three things:

1. **Index**: one card per member, with its status.
2. **Credentials**: create a GitHub App or a personal access token for a member and hand it over.
3. **Database**: host the member's data next to the other members' data.

## 1. `octoforge.json`

Every member ships `octoforge.json` at its repository root and serves the same document at
`GET /api/octoforge/manifest`.

```json
{
  "contract": 1,
  "name": "octohatchery",
  "title": "Octohatchery",
  "description": "Orchestrator for self-hosted GitHub Actions runners.",
  "icon": "/favicon.svg",
  "health": "/health",
  "github": {
    "auth": ["app", "pat"],
    "app": {
      "permissions": {
        "actions": "write", "administration": "write", "contents": "write",
        "workflows": "write", "pull_requests": "write", "metadata": "read"
      },
      "events": ["workflow_job"],
      "webhook_path": "/webhooks/github",
      "setup_path": "/"
    },
    "pat": {
      "classic_scopes": ["repo", "workflow"],
      "fine_grained": { "actions": "write", "administration": "write", "metadata": "read" },
      "user_identity": false
    }
  },
  "database": { "engines": ["sqlite", "postgres"], "schema": true },
  "env": {
    "github_token": "GITHUB_TOKEN",
    "app_id": "GITHUB_APP_ID",
    "app_private_key": "GITHUB_APP_PRIVATE_KEY",
    "app_installation_id": "GITHUB_APP_INSTALLATION_ID",
    "app_webhook_secret": "GITHUB_WEBHOOK_SECRET",
    "database_url": "DATABASE_URL",
    "database_schema": "DATABASE_SCHEMA"
  }
}
```

| Field | Meaning |
|---|---|
| `contract` | Contract version the member implements. Octoforge refuses versions it does not know. |
| `name` | Repository name; also the container, image and schema name. |
| `icon`, `health` | Paths on a running instance. `health` answers 200 when the instance is up. |
| `github.auth` | Supported modes, preferred first: `app`, `pat`. Absent = the member needs no GitHub credentials. |
| `github.app` | What the App manifest asks for. Octoforge adds the name, the URLs and the webhook secret. |
| `github.pat` | Scopes for a classic token, permissions for a fine-grained token. `user_identity: true` means the token must act as the person (an App cannot replace it). The keys of `fine_grained` are GitHub's permission parameter names (`pull_requests`, `actions`, …): Octoforge puts them as they are into GitHub's pre-filled token form. |
| `database.engines` | Engines the member can run on. `schema: true` = it can live in a named Postgres schema. |
| `env` | Names of the variables the member reads. Octoforge uses them for the copyable fallback block. |

Octoforge reads the manifest from a running instance. With no instance configured it reads it from
the member's default branch on GitHub, so the index works before anything is deployed.

## 2. Member API

Base path `/api/octoforge`. The routes exist only when the member's `OCTOFORGE_TOKEN` is set;
otherwise every route answers 404. Every route except `manifest` needs
`Authorization: Bearer <OCTOFORGE_TOKEN>` (constant-time compare, 401 on mismatch). Bodies and
answers are JSON in the `{ok, message, ...data}` shape; errors set `ok: false` and a reason.
The same token value is set in Octoforge's `.env` and in each member's `.env`.

| Route | Does |
|---|---|
| `GET /manifest` | The `octoforge.json` document itself, not wrapped in `{ok, message}`. No bearer needed. |
| `GET /status` | `{contract, version, github: {mode, source, app_id?, login?}, database: {engine, schema?, source}}`. `source` is `env`, `octoforge` or `none`. Never returns a secret. |
| `PUT /github` | Body `{mode: "pat", token}` or `{mode: "app", app_id, private_key, webhook_secret, installation_id?}`. The member checks the credential against GitHub (`GET /user` for a token, `GET /app` with a JWT for an App), stores it in its own settings and uses it from then on. A delivered value wins over the env value. Answer: `{ok, message, login? / app_slug?, restart_required}`; 400 when GitHub refuses the credential, 502 when GitHub cannot be reached. |
| `DELETE /github` | Drops the delivered credential; the member goes back to its env value. |
| `POST /database/adopt` | Body `{url, schema, copy}`. Moves the member to the database at `url` (section 3). |
| `DELETE /database` | Drops the adopted database setting; the member goes back to its `DATABASE_URL` on the next start. |

Credentials never appear in a log line or an answer. A member that cannot apply a credential
without a restart says so with `restart_required: true`.

## 3. Database

Standalone, a member uses its own `DATABASE_URL`, SQLite by default. Under Octoforge it can move
into a shared database: **one schema per member in one Postgres database**, or one SQLite file per
member in a shared directory. Each member keeps owning its tables and runs its own migrations.

### Adoption

`POST /database/adopt {url, schema, copy}` on one instance of the member:

1. Connect to `url`, create `schema` if it is missing, run the member's own migrations there.
2. With `copy: true` (the default), copy every row from the current database, then compare row
   counts per table. Any difference aborts the adoption and leaves the current database in use.
3. Write `url` and `schema` to `DATA_DIR/octoforge-database.json` (mode 0600). At start-up this file
   overrides `DATABASE_URL` / `DATABASE_SCHEMA`.
4. Answer `{ok, message, tables: {<table>: <rows>}, restart_required: true}`.

The call is synchronous: the member answers when the copy and the count check are done. Octoforge
waits up to its `adoptTimeoutSec` setting (300 s by default) for the first instance.

Members with several instances on one database get the call once with `copy: true`, and on every
other instance with `copy: false`. When the first instance fails, the others are not called. The old database stays untouched, so `DELETE /database` plus a
restart rolls back; rows written after the adoption stay in the new database only.

### Engines

- **Postgres**: Octoforge creates a login role named after the member, owning schema `<name>`, with
  its `search_path` set to that schema, and passes its URL in `url`. Every adoption sets a new random
  password for the role, so an adoption always goes to every instance of the member, and each one
  must restart to use the new URL. A read-only role (`octoforge_reader`) gets `USAGE` and `SELECT` on every
  member schema for views that span members. Writes from Octoforge always go through the member's
  API, never through the database.
- **SQLite**: Octoforge and the member mount the same host directory. `url` is
  `sqlite:<path to <name>.db in that directory>`; `schema` is ignored. Octoforge attaches the files
  read-only.

## 4. What Octoforge stores

Its own database holds the member instances (base URLs), the delivery log and the adoption log:
what went where, when, and whether it worked. It never stores a credential or a database password.
A GitHub App key, a token or a generated role password lives in Octoforge's memory only for the
few minutes between creation and delivery.

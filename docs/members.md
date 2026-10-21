# Member contract (version 1)

A member is a tool that works on its own and also plugs into Octoforge. Everything here is
optional for standalone use: a member without `OCTOFORGE_TOKEN` behaves exactly as before.

Octoforge uses the contract for three things:

1. **Index**: one card per member, with its status.
2. **Credentials**: one shared GitHub App for every member, or a personal access token (or an App
   of its own) for one member, handed over through the member API.
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
| `github.app` | What the member needs from a GitHub App. The shared App asks for the union of every member's `permissions` (highest level wins) and `events`. One App has one webhook URL: when several members name a `webhook_path`, Octoforge names them and does not create the shared App. |
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
| `GET /status` | `{contract, version, github: {mode, source, app_id?, login?, missing?, permissions_url?, install_url?}, database: {engine, schema?, source}, public_url?}`. `source` is `env`, `octoforge` or `none`. `missing` is optional: the permissions the member is sure its App lacks, as `"<permission>:<level>"` entries (`["issues:write"]`); list definite gaps only, never guesses. `permissions_url` and `install_url` are optional `https://` links to the App's permission page and its installation page on GitHub. Octoforge shows `missing` on the member's card and Credentials page next to its own comparison; a malformed optional field is ignored, the rest of the status still counts. `public_url` is optional: the address where GitHub and browsers reach the member (`https://tool.example.com`), when it differs from the URL Octoforge calls. Octoforge uses it for the App's webhook and setup URLs unless the instance has its own public URL in Octoforge. Never returns a secret. |
| `PUT /github` | Body `{mode: "pat", token}` or `{mode: "app", app_id, private_key, webhook_secret, installation_id?}`. The member checks the credential against GitHub (`GET /user` for a token, `GET /app` with a JWT for an App), stores it in its own settings and uses it from then on. A delivered value wins over the env value. Answer: `{ok, message, login? / app_slug?, restart_required}`; 400 when GitHub refuses the credential, 502 when GitHub cannot be reached. |
| `DELETE /github` | Drops the delivered credential; the member goes back to its env value. |
| `POST /database/adopt` | Body `{url, schema, copy}`. Moves the member to the database at `url` (section 3). |
| `DELETE /database` | Drops the adopted database setting; the member goes back to its `DATABASE_URL` on the next start. |
| `PUT /siblings` | Body: the sibling list (below). The member stores it in its settings and renders a switcher with links to Octoforge and every member. Answer `{ok, message}`. Optional route: a member without it answers 404 and Octoforge stops sending. |
| `DELETE /siblings` | Clears the stored list; the switcher disappears. |

Credentials never appear in a log line or an answer. A member that cannot apply a credential
without a restart says so with `restart_required: true`.

A member should store a delivered credential **encrypted at rest** (for example AES-256-GCM with a
key derived from its own session secret): Octoforge's read-only role can `SELECT` every member
schema, so a plain value would be readable through it. When the key changes and the stored value no
longer decrypts, the member falls back to its env value and logs a warning.

### Sibling list

Octoforge pushes the family to every instance, so each tool can link to the others. Members do not
need to know where Octoforge runs.

```json
{
  "forge": { "title": "Octoforge", "url": "https://forge.example.com", "icon": "https://forge.example.com/favicon.svg" },
  "members": [
    { "name": "octotally", "title": "Octotally", "url": "https://tally.example.com", "icon": "https://tally.example.com/favicon.svg" },
    { "name": "octowarden", "title": "Octowarden", "url": "https://warden.example.com", "icon": "https://warden.example.com/favicon.svg" }
  ],
  "updated_at": "2026-10-21T12:00:00Z"
}
```

- `members` lists every member with a configured instance, the receiving member included; it marks
  itself by `name`. One entry per member: the first instance in Octoforge's list.
- `url` is the address a browser uses: the instance's public URL, else the `public_url` the member
  reports, else its base URL. `icon` is an absolute URL (instance URL plus the manifest `icon`).
- Octoforge sends the list when an instance is added, changed or removed, at start-up, and again on a
  schedule (setting `siblingsResendMin`, default 60), so a restarted member gets it back.
- The member shows the switcher only while Octoforge is set up: `OCTOFORGE_TOKEN` is set **and** the
  stored list is younger than three schedule periods (`updated_at`, 180 minutes by default). An older
  list hides the switcher; nothing is shown as stale.

## 3. Database

Standalone, a member uses its own `DATABASE_URL`, SQLite by default. Under Octoforge it can move
into a shared database: **one schema per member in one Postgres database**, or one SQLite file per
member in a shared directory. Each member keeps owning its tables and runs its own migrations.

### Adoption

`POST /database/adopt {url, schema, copy}` on one instance of the member:

1. Connect to `url`, create `schema` if it is missing, run the member's own migrations there.
2. With `copy: true` (the default), copy every row from the current database, then compare row
   counts per table. Any difference aborts the adoption and leaves the current database in use.
   A target that already holds rows, or that is the database in use, is refused (409, with the row
   counts per table). With `copy: false` the member only migrates and answers the counts it finds.
3. Write `url` and `schema` to `DATA_DIR/octoforge-database.json` (mode 0600). At start-up this file
   overrides `DATABASE_URL` / `DATABASE_SCHEMA`. A malformed file stops the start-up with the
   reason; the member never falls back silently, so writes never split between two databases.
4. Answer `{ok, message, tables: {<table>: <rows>}, restart_required: true}`.

The call is synchronous: the member answers when the copy and the count check are done. Octoforge
waits up to its `adoptTimeoutSec` setting (300 s by default) for the first instance.

Members with several instances on one database get the call once with `copy: true`, and on every
other instance with `copy: false`. When the first instance fails, the others are not called. The
old database stays untouched, so `DELETE /database` plus a restart rolls back; rows written after
the adoption stay in the new database only.

On Postgres a member names its schema in every query rather than relying on `search_path`, keeps its
migration journal inside its own schema, and starts with a role that owns only that schema (no
`CREATE` on the database). Pool and TLS options go in the URL query (`sslmode=require`).

### Engines

- **Postgres**: Octoforge uses a login role named after the member, owning schema `<name>`, with
  its `search_path` set to that schema in the shared database only (`ALTER ROLE … IN DATABASE`), and
  passes its URL in `url`. A read-only role (`octoforge_reader`) gets `USAGE` and `SELECT` on every
  member schema for views that span members. Writes from Octoforge always go through the member's
  API, never through the database. The role is handled in one of three ways:
  1. **No role yet**: Octoforge creates it with a random password and records that it did.
  2. **A role Octoforge created**: every adoption sets a new random password, so an adoption always
     goes to every instance of the member, and each one must restart to use the new URL.
  3. **A role that exists already**, for example because the member uses it for its own database:
     Octoforge never changes its password, so the member's own `DATABASE_URL` keeps working and a
     rollback stays possible. The operator enters the role's current password with the adoption.
     Octoforge first logs in with it (a wrong password stops the adoption before any change), then
     puts it in `url`. The password lives in memory for that one request and is never stored,
     logged or shown. Without it, the adoption is refused. The admin role needs `ADMIN OPTION` on
     such a role (`GRANT <name> TO <admin> WITH ADMIN OPTION`, as a superuser).
- **SQLite**: Octoforge and the member mount the same host directory. `url` is
  `sqlite:<path to <name>.db in that directory>`; `schema` is ignored. Octoforge attaches the files
  read-only.

## 4. What Octoforge stores

Its own database holds the member instances (base URLs), the delivery log and the adoption log:
what went where, when, and whether it worked, plus the names of the Postgres roles it created. It
never stores a credential or a database password. A GitHub App key, a token, a generated role
password or an existing role's password lives in Octoforge's memory only for the few minutes between
creation and delivery.

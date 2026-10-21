# Configuration

Octoforge reads two kinds of configuration:

1. **Environment** (`.env`, see [`.env.example`](../.env.example)): bootstrap values and secrets.
   A change needs a restart.
2. **Settings** (the Settings page, stored in Octoforge's database): everything tunable. A change
   applies on the next use, no restart.

## Environment

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `AUTH_PASSWORD` | one of the two | none | Password for the login page. |
| `AUTH` | one of the two | none | `none` turns the login off. Set it only when a reverse proxy in front authenticates every request. Setting it together with `AUTH_PASSWORD` is refused. |
| `OCTOFORGE_TOKEN` | for credentials and database | none | Bearer token for the member API, at least 32 characters (`openssl rand -hex 32`). Set the same value on every member. Without it only the index works (no sibling list either). |
| `PUBLIC_URL` | for GitHub Apps and the tool switcher | none | Base URL of Octoforge as your browser reaches it. GitHub sends you back to `<PUBLIC_URL>/github/callback`. Without it, no sibling list is sent. |
| `SESSION_SECRET` | no | generated | Signs the session cookie (at least 32 characters). When empty, one is generated and kept in `DATA_DIR/session.secret`. |
| `DATABASE_URL` | no | `sqlite:<DATA_DIR>/octoforge.db` | Octoforge's own database. A `postgres://` URL puts its tables in schema `forge`. |
| `FORGE_PG_ADMIN_URL` | for Postgres adoption | none | A role with `CREATEROLE` and `CREATE` on the shared database. Used only to create one role and one schema per member. For a member role that exists already, this role needs `ADMIN OPTION` on it, and you enter the role's current password on the Database page ([members](members.md#engines)). |
| `OCTOFORGE_SHARED_DATA` | for SQLite adoption | none | Absolute path of the directory with one SQLite file per member, **as the members see it**. |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, `error` or `silent`. |
| `PORT` | no | `3000` | Listen port. The image sets it. |
| `DATA_DIR` | no | `./data` (`/data` in the image) | Database file and session secret. |
| `WEB_DIST` | no | `packages/web/dist` | Built SPA. The image sets it. |
| `GITMODULES_FILE` | no | the repository's `.gitmodules` | Member list. The image carries a copy. |

Octoforge refuses to start, with the reason on stderr and exit code 78, when neither `AUTH_PASSWORD`
nor `AUTH=none` is set, when both are set, or when a variable is malformed.

### Postgres admin role

Create the role once, as a superuser, in the database the members will share:

```sql
CREATE ROLE forge_admin LOGIN CREATEROLE PASSWORD '<password>';
GRANT CREATE ON DATABASE octoforge TO forge_admin;
```

Octoforge then creates, per member, a login role and a schema with the member's name, and the
read-only role `octoforge_reader`. The admin role becomes a member of each member role, which it
needs to hand the schema over.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| Keep in memory (`secretTtlMin`) | 15 min | How long a created App key, a token or a role password waits for delivery. |
| Waiting at once (`secretStoreMax`) | 20 | Upper bound of credentials held in memory. |
| Fine-grained token lifetime (`patExpiresDays`) | 90 days | Pre-filled on GitHub's form; 0 = no expiry. |
| Organisation (`githubOrg`) | empty | Offered as owner of new Apps and tokens next to your personal account. |
| Postgres host for members (`pgMemberHost`) | empty | `host` or `host:port` members use to reach Postgres. Empty = the host of `FORGE_PG_ADMIN_URL`. |
| Adoption timeout (`adoptTimeoutSec`) | 300 s | How long the first instance may take to copy its rows. |
| Request timeout (`requestTimeoutMs`) | 8 s | Every call to an instance or to GitHub. |
| Manifest cache (`manifestCacheMin`) | 10 min | How long a read manifest is reused. Refresh on the members page reads it again. |
| Index refresh (`indexRefreshSec`) | 30 s | Health refresh on the members page. |
| Resend sibling list (`siblingsResendMin`) | 60 min | Minutes between two pushes of the sibling list to every instance (5 to 1440). Octoforge also sends it at start-up and when an instance changes. **Send sibling list now** on the Settings page sends it at once. |
| Keep log (`logKeepDays`) | 180 days | Older delivery and adoption rows are deleted (hourly). |
| Log page (`logPageSize`) | 100 rows | Rows per page on the log. |
| Theme (`theme`) | system | Primer theme of the UI. |

## Instances

The Settings page also holds the **instances**: the base URL (and an optional label) of every
running member. Pick the member from the list, paste the URL, press Add. Octoforge reads the
manifest and health from there, and delivers credentials and database settings to it.

The base URL only has to work from Octoforge, so it can be a name on your own network
(`http://tool:8080`). GitHub cannot reach such a name. When an instance has a different public
address, put it in **Public URL** (`https://tool.example.com`), or edit it later with the pencil in the
instance list. A GitHub App created for that instance sends its webhooks and setup page there.

The address GitHub uses is picked in this order:

1. The instance's public URL in Octoforge.
2. The `public_url` the member reports in `GET /api/octoforge/status`, if it reports one.
3. The base URL.

## Tool switcher

Octoforge sends every instance the **sibling list**: Octoforge itself and one entry per member with
an instance (contract: [members](members.md#sibling-list)). A member uses it to show links to the
other tools. The address of each member follows the order above (instance public URL, then the
reported `public_url`, then the base URL), taken from the member's first instance.

The members page shows, per instance, the last outcome: `switcher: sent … ago`, `switcher: not
supported` (the instance answered 404; Octoforge stops sending to it until an instance changes, you
press **Send sibling list now**, or Octoforge restarts) or `switcher: failed: <reason>`. Outcomes are
kept in memory only. Without `OCTOFORGE_TOKEN` or `PUBLIC_URL`, nothing is sent and the log says why
once.

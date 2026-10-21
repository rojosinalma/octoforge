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
| `OCTOFORGE_TOKEN` | for credentials and database | none | Bearer token for the member API, at least 32 characters (`openssl rand -hex 32`). Set the same value on every member. Without it only the index works. |
| `PUBLIC_URL` | for GitHub Apps | none | Base URL of Octoforge as your browser reaches it. GitHub sends you back to `<PUBLIC_URL>/github/callback`. |
| `SESSION_SECRET` | no | generated | Signs the session cookie (at least 32 characters). When empty, one is generated and kept in `DATA_DIR/session.secret`. |
| `DATABASE_URL` | no | `sqlite:<DATA_DIR>/octoforge.db` | Octoforge's own database. A `postgres://` URL puts its tables in schema `forge`. |
| `FORGE_PG_ADMIN_URL` | for Postgres adoption | none | A role with `CREATEROLE` and `CREATE` on the shared database. Used only to create one role and one schema per member. |
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
| Keep log (`logKeepDays`) | 180 days | Older delivery and adoption rows are deleted (hourly). |
| Log page (`logPageSize`) | 100 rows | Rows per page on the log. |
| Theme (`theme`) | system | Primer theme of the UI. |

## Instances

The Settings page also holds the **instances**: the base URL (and an optional label) of every
running member. Pick the member from the list, paste the URL, press Add. Octoforge reads the
manifest and health from there, and delivers credentials and database settings to it.

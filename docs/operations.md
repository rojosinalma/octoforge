# Operations

## Health

`GET /health` returns `200` with `{ok, db, version}`, or `503` with `db: "error"` when the database
does not answer. It is never gated. The image carries a `HEALTHCHECK` on it (every 30 s, 20 s start
period); point an uptime monitor at the same URL.

## Start-up

Octoforge exits with code 78 and the reason on stderr when the auth decision is missing
(`AUTH_PASSWORD` or `AUTH=none`) or a variable is malformed. With `restart: unless-stopped` that
shows as a restart loop: read `docker compose logs octoforge`.

At start it logs whether the member API (`OCTOFORGE_TOKEN`), `PUBLIC_URL`, Postgres adoption and
SQLite adoption are available, and warns about each one that is missing.

## Logs

One line per event on stdout (warnings and errors on stderr):

```
2026-10-21T12:43:18.560Z INFO  [member] PUT https://tool.example.com/api/octoforge/github status=200 ms=6
```

Subsystems: `http` (every request: method, path, status, ms), `member` (every call to an instance),
`github` (every call to GitHub), `members` (manifest reads from GitHub), `postgres` (role and schema
provisioning), `db`, `auth`, `boot`. Every outgoing call is logged with method, target and outcome
(status, `timeout` or `unreachable` with a reason). Credentials, codes and passwords never appear in
a log line: fields named like a secret are redacted, and URLs are logged without credentials.
`LOG_LEVEL` sets the verbosity.

```sh
docker compose logs -f octoforge
docker compose logs octoforge | grep '\[member\]'
```

## Data

Everything lives under `DATA_DIR` (`/data` in the image): `octoforge.db` (SQLite in WAL mode, plus
`-wal`/`-shm` files) and `session.secret` when `SESSION_SECRET` is not set. With a Postgres
`DATABASE_URL` the tables live in schema `forge` instead. Back up the directory while the container
is stopped, or `sqlite3 octoforge.db ".backup out.db"` while it runs.

The database holds instances, settings and the delivery and adoption log, never a credential. Log
rows older than `logKeepDays` are deleted hourly. Credentials waiting for delivery live in memory
and are gone after a restart: create them again.

## Upgrade

Migrations are additive and run at every start, so an upgrade is pulling the new image:

```sh
docker compose pull && docker compose up -d
```

Tags: `X.Y.Z`, `X.Y` (latest patch of a minor), `latest`, `sha-<commit>`. `GET /health` shows the
running version.

## Build the image yourself

`compose.yaml` pulls the published image. To build from the checkout instead, add a
`compose.override.yaml` next to it (ignored by git):

```yaml
services:
  octoforge:
    build: .
    image: octoforge:local
```

Then `docker compose up -d --build`. The build context leaves out the tool folders.

## Shutdown

`SIGINT`/`SIGTERM` drop the in-memory secrets, let in-flight requests finish, close the database and
exit 0.

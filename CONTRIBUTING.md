# Contributing

Changes to a tool belong in that tool's repository; open issues and pull requests there. This
repository takes changes to the index, the submodule set, the shared documentation, the checks and
the Octoforge app (`packages/`).

## Running locally

Needs bash, git, [Bun](https://bun.sh) ≥ 1.4 and, for the container test, Docker.

```sh
git clone --recurse-submodules https://github.com/rojosinalma/octoforge.git
cd octoforge
bun install
cp .env.example .env          # AUTH_PASSWORD at least; Bun loads .env from the working directory
cd packages/server && bun --watch src/index.ts     # API on http://localhost:3000
cd packages/web && bun run dev                     # UI on http://localhost:5173, proxied to the API
```

## Running the checks

```sh
bin/verify                 # everything: index + leak checks, install, typecheck, lint, tests, build, container
SKIP_DOCKER=1 bin/verify   # without the container smoke test
SKIP_APP=1 bin/verify      # index and leak checks only
```

`bin/verify` exits non-zero with a reason when the index, `.gitmodules` and the submodules disagree,
when a tracked file contains a local path or a private address, or when an app step fails. Extra leak
patterns can be added per clone in `.git/info/leak-patterns` (one extended regex per line); that file
is never committed.

Single steps: `bun run typecheck`, `bun run lint` (Biome; `bun run lint:fix` formats), `bun test`,
`bun run build`. Typecheck, lint and tests cover `packages/` only; the tool folders check themselves.

The Postgres adoption tests against a real server run only when `OCTOFORGE_TEST_PG_URL` names a
superuser on a throwaway server; they create and drop roles and databases:

```
docker run --rm -d --name pg-test -e POSTGRES_PASSWORD=su -p 127.0.0.1:55432:5432 postgres:17-alpine
OCTOFORGE_TEST_PG_URL=postgres://postgres:su@127.0.0.1:55432/postgres bun test packages/server/test/postgres.test.ts
docker rm -f pg-test
```

## Style and layout

- TypeScript, strict. Biome formats: 2 spaces, single quotes, 110 columns.
- `packages/shared`: zod schemas and pure helpers used by both sides. `packages/server/src/lib`: the
  logic; `src/routes`: thin Hono routes that answer `{ok, message, ...data}`; `src/db`: drivers and
  migrations.
- Database changes: edit `src/db/schema.ts` and `src/db/schema.pg.ts` together, then generate both
  migrations from `packages/server`:

  ```sh
  DATABASE_URL=sqlite::memory: bun run db:generate
  DATABASE_URL=postgres://x bun run db:generate
  ```

- Tunables go into the settings schema (`packages/shared/src/settings.ts`), never into constants.
  Environment variables are for bootstrap values and secrets only.
- No secret in the database, a log line or an API answer after delivery. Tests use neutral names
  (`alice`, `example.com`) and mocked `fetch`; they never call GitHub.

## Adding a tool

1. Add the submodule and its homepage:

   ```sh
   git submodule add https://github.com/rojosinalma/<tool>.git <tool>
   git config -f .gitmodules submodule.<tool>.homepage https://github.com/rojosinalma/<tool>
   ```

2. Add a row to the table in `README.md`, linking the tool's repository.
3. Run `bin/verify` and commit `.gitmodules`, the submodule and `README.md` together. The image build
   context is an allow-list, so the new folder stays out of it without a change.

To plug into the app, the tool implements [docs/members.md](docs/members.md).

## Moving a pinned version

Commit the new submodule pointer on its own, with the tool and the target in the message
(`octotally: bump to v0.2.0`). Only point at commits that are pushed to the tool's default branch.
Dependabot does this weekly through a pull request.

## Commits and pull requests

- Every commit is signed. Unsigned commits are rejected by the branch rules.
- Plain, descriptive commit messages in the imperative.
- One topic per pull request; `bin/verify` must pass.

## Releasing

1. Move the `[Unreleased]` section of `CHANGELOG.md` to the new version and bump `version` in the
   root `package.json`.
2. Tag the commit `vX.Y.Z` (signed) and push the tag. `publish-image` builds
   `ghcr.io/rojosinalma/octoforge` for amd64 and arm64 with the tags `X.Y.Z`, `X.Y`, `latest` and
   `sha-<commit>`.
3. Create the GitHub release with the changelog section as notes.

## Where the docs live

- `README.md`: the index, how to clone and run.
- `docs/SDD.md`: design, decisions and how the pieces fit.
- `docs/members.md`: the contract a tool implements to plug in.
- `docs/configuration.md`, `docs/operations.md`, `docs/credentials.md`: running the app.
- Everything about a single tool: that tool's repository.

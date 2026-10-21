# Octoforge

[![run-checks](https://github.com/rojosinalma/octoforge/actions/workflows/run-checks.yml/badge.svg)](https://github.com/rojosinalma/octoforge/actions/workflows/run-checks.yml)
[![licence](https://img.shields.io/github/license/rojosinalma/octoforge)](LICENSE)

**A family of self-hosted tools that make GitHub easier to live with, in one place.**

Each tool is its own project with its own repository, releases, container image and documentation.
Octoforge lists them in `members.json` and runs as a small app that ties them together:

- **Index**: one card per tool, with the health of every running instance.
- **Credentials**: one GitHub App for every tool (or a personal access token where a tool needs
  one), checked against what each tool needs and handed to every instance, without ever writing it
  to disk.
- **Database**: move the tools' data into one shared database, one schema per tool on Postgres or
  one file per tool in a shared directory.

| Tool | What it does |
|---|---|
| [octotally](https://github.com/rojosinalma/octotally) | Every issue, pull request and discussion you are part of, on one page, filtered to what still needs you. |
| [octohatchery](https://github.com/rojosinalma/octohatchery) | Orchestrator for self-hosted GitHub Actions runners: one ephemeral runner per job, typed runners, slots per host. |
| [octowarden](https://github.com/rojosinalma/octowarden) | Repository configuration from reusable templates: plan, apply and audit settings, security, rulesets, labels, webhooks and files across many repos. |

## Requirements

- Docker ≥ 24 with Compose v2 to run the app.
- Git to clone Octoforge and the tools you want.
- Each tool lists its own requirements in its README.
- Optional: PostgreSQL ≥ 15 for the shared database.

## Installation

```sh
git clone https://github.com/rojosinalma/octoforge.git
```

The tools are not part of this repository. Clone the ones you want inside the `octoforge` folder,
next to the app; git ignores those folders:

```sh
cd octoforge
git clone https://github.com/rojosinalma/octotally.git
```

You do not need Octoforge to run a tool: every tool installs and runs on its own from its repository.

Run the app:

```sh
cd octoforge
cp .env.example .env    # set AUTH_PASSWORD, OCTOFORGE_TOKEN and PUBLIC_URL
docker compose up -d
```

Open <http://localhost:3000> and sign in. Every variable is described in
[docs/configuration.md](docs/configuration.md).

## Usage

Each tool you cloned lives in its own folder (`octotally/`, `octohatchery/`, `octowarden/`), is its
own git repository and runs exactly as its README describes, from inside that folder. Update it
there with `git pull`. To let Octoforge talk to a tool, set the same `OCTOFORGE_TOKEN`
in the tool's `.env`, restart it, and add its address under **Settings → Instances**.

- **Members** shows every tool, its instances and whether they answer.
- **GitHub App** sets up the one App every tool shares, shows which permissions are missing and
  delivers it; **Credentials** on a tool's card handles tokens and per-tool Apps:
  [docs/credentials.md](docs/credentials.md).
- **Database** moves a tool into the shared database and shows which instances need a restart.
- **Log** lists every delivery and adoption.

How a tool plugs in is in [docs/members.md](docs/members.md); health, logs and upgrades in
[docs/operations.md](docs/operations.md).

## Development

The app is a Bun workspace (`packages/shared`, `packages/server`, `packages/web`). `bin/verify`
checks that the index above and `members.json` agree and that no tracked
file leaks local paths or private addresses, then installs, typechecks, lints, tests and builds the
app and smoke-tests the container. CI runs it on every pull request. The workflow is in
[CONTRIBUTING.md](CONTRIBUTING.md); the design is in [docs/SDD.md](docs/SDD.md).

## License

[AGPL-3.0](LICENSE). Each tool carries its own licence in its repository.

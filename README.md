# Octoforge

[![run-checks](https://github.com/rojosinalma/octoforge/actions/workflows/run-checks.yml/badge.svg)](https://github.com/rojosinalma/octoforge/actions/workflows/run-checks.yml)
[![licence](https://img.shields.io/github/license/rojosinalma/octoforge)](LICENSE)

**A family of self-hosted tools that make GitHub easier to live with, in one place.**

Each tool is its own project with its own repository, releases, container image and documentation.
Octoforge pulls them together as git submodules and pins versions that are known to work side by
side. It also runs as a small app that ties the tools together:

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
- Git ≥ 2.34 to clone the tools (submodules over HTTPS or SSH).
- Each tool lists its own requirements in its README.
- Optional: PostgreSQL ≥ 15 for the shared database.

## Installation

Clone with every tool checked out at its pinned version:

```sh
git clone --recurse-submodules https://github.com/rojosinalma/octoforge.git
```

Already cloned without submodules:

```sh
git submodule update --init --recursive
```

You do not need Octoforge to run a tool: every tool installs on its own from its repository.

Run the app:

```sh
cd octoforge
cp .env.example .env    # set AUTH_PASSWORD, OCTOFORGE_TOKEN and PUBLIC_URL
docker compose up -d
```

Open <http://localhost:3000> and sign in. Every variable is described in
[docs/configuration.md](docs/configuration.md).

## Usage

Each tool lives in its own folder (`octotally/`, `octohatchery/`, `octowarden/`) and is run exactly as its README
describes, from inside that folder. To let Octoforge talk to a tool, set the same `OCTOFORGE_TOKEN`
in the tool's `.env`, restart it, and add its address under **Settings → Instances**.

- **Members** shows every tool, its instances and whether they answer.
- **GitHub App** sets up the one App every tool shares, shows which permissions are missing and
  delivers it; **Credentials** on a tool's card handles tokens and per-tool Apps:
  [docs/credentials.md](docs/credentials.md).
- **Database** moves a tool into the shared database and shows which instances need a restart.
- **Log** lists every delivery and adoption.

How a tool plugs in is in [docs/members.md](docs/members.md); health, logs and upgrades in
[docs/operations.md](docs/operations.md).

Move every tool to the latest commit of its default branch:

```sh
git submodule update --remote --merge
```

Dependabot opens a pull request here when a tool moves ahead, so the pinned set stays current.

## Development

The app is a Bun workspace (`packages/shared`, `packages/server`, `packages/web`). `bin/verify`
checks that the index above, `.gitmodules` and the checked-out submodules agree and that no tracked
file leaks local paths or private addresses, then installs, typechecks, lints, tests and builds the
app and smoke-tests the container. CI runs it on every pull request. The workflow is in
[CONTRIBUTING.md](CONTRIBUTING.md); the design is in [docs/SDD.md](docs/SDD.md).

## License

[AGPL-3.0](LICENSE). Each tool carries its own licence in its repository.

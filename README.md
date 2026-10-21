# Octoforge

[![run-checks](https://github.com/rojosinalma/octoforge/actions/workflows/run-checks.yml/badge.svg)](https://github.com/rojosinalma/octoforge/actions/workflows/run-checks.yml)
[![licence](https://img.shields.io/github/license/rojosinalma/octoforge)](LICENSE)

**A family of self-hosted tools that make GitHub easier to live with, in one place.**

Each tool is its own project with its own repository, releases, container image and documentation.
Octoforge pulls them together as git submodules, pins versions that are known to work side by side,
and is the place where they will learn to work with each other.

| Tool | What it does |
|---|---|
| [octotally](https://github.com/rojosinalma/octotally) | Every issue, pull request and discussion you are part of, on one page, filtered to what still needs you. |
| [octohatchery](https://github.com/rojosinalma/octohatchery) | Orchestrator for self-hosted GitHub Actions runners: one ephemeral runner per job, typed runners, slots per host. |

## Requirements

- Git ≥ 2.34 (submodules over HTTPS or SSH).
- Each tool lists its own requirements in its README (most need Docker ≥ 24 with Compose v2).

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

## Usage

Each tool lives in its own folder (`octotally/`, `octohatchery/`) and is run exactly as its README
describes, from inside that folder.

Move every tool to the latest commit of its default branch:

```sh
git submodule update --remote --merge
```

Dependabot opens a pull request here when a tool moves ahead, so the pinned set stays current.

## Development

`bin/verify` checks that the index above, `.gitmodules` and the checked-out submodules agree, and that
no tracked file leaks local paths or private addresses. CI runs it on every pull request. Adding a tool
and the rest of the workflow are in [CONTRIBUTING.md](CONTRIBUTING.md); the design is in
[docs/SDD.md](docs/SDD.md).

## License

[AGPL-3.0](LICENSE). Each tool carries its own licence in its repository.

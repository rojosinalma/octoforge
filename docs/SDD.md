# Octoforge — software design document

## Purpose

Octoforge is the home of a family of self-hosted GitHub tools. It gives them one place to be found,
one clone that holds a known-good set of versions, and a place for features that span tools.

## Architecture

- A plain git repository. Each tool is a **git submodule** at the top level (`<tool>/`), pointing at
  the tool's own repository. The tool keeps its history, CI, releases, container image and URL.
- `.gitmodules` is the machine-readable index: `path`, `url` and a `homepage` key per tool.
- `README.md` is the human index: one table row per tool, linking its repository.
- `bin/verify` keeps the two indexes and the checkout consistent and scans tracked files for leaks.
- Each tool keeps its `compose.yaml` at its own root, so a tool runs the same from `octoforge/<tool>`
  as from a standalone clone.

## Flows

- **Clone**: `git clone --recurse-submodules` checks out every tool at its pinned commit.
- **Bump**: Dependabot (`gitsubmodule`, weekly) opens one pull request per moved tool; `run-checks`
  runs `bin/verify` on it.
- **Add a tool**: `git submodule add`, `homepage` key, README row, `bin/verify` (CONTRIBUTING.md).

## Configuration surface

None at runtime. `bin/verify` reads optional extra leak patterns from `.git/info/leak-patterns`
(path overridable with `OCTOFORGE_LEAK_PATTERNS`).

## Design decisions

| Entry | Option | Reason | Date |
|---|---|---|---|
| Repository layout | Umbrella repo with git submodules | Tools stay independent (own repo, CI, releases, URL); the umbrella pins a working set | 2026-10-21 |
| Index source | `.gitmodules` `homepage` key + README table, checked by `bin/verify` | No extra manifest format; git already parses `.gitmodules` | 2026-10-21 |
| Language | Bash for `bin/verify` | Only git and text checks; no runtime to install | 2026-10-21 |
| Runtime | No container | Nothing to serve yet; a root `compose.yaml` arrives with the first shared feature | 2026-10-21 |
| Versioning | None for the umbrella | The tools version themselves; the umbrella's state is the set of pointers on `main` | 2026-10-21 |
| Dependency updates | Dependabot `gitsubmodule` + `github-actions`, weekly | Keeps pointers and actions current through reviewed pull requests | 2026-10-21 |
| Licence | AGPL-3.0 | Same as the tools | 2026-10-21 |

## Current scope

An index and a pinned set of tools. Features that span tools (shared login, a common dashboard,
cross-tool automation) are designed here when they come.

## Operations

`bin/verify` locally and in CI. There is no service to operate; each tool documents its own
operations.

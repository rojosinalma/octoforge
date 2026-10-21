# Changelog

All notable changes to Octoforge are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/).

## [Unreleased]

## [0.1.2] - 2026-10-21

### Added

- octowarden joins the family: repository configuration from reusable templates.

### Changed

- Postgres adoption no longer changes the password of a member role that already exists and that
  Octoforge did not create. The Database page asks for the role's current password; Octoforge logs
  in with it first and hands it to the member once, without storing it. Without it the adoption is
  refused. Roles Octoforge created itself (recorded in the new `created_roles` table) still get a
  new password on every adoption.
- The member role's `search_path` is set for the shared database only (`ALTER ROLE … IN DATABASE`),
  so a role that also works in its own database keeps its settings there.

## [0.1.1] - 2026-10-21

### Fixed

- Postgres adoption grants `CONNECT` on the shared database to the member role and `octoforge_reader`,
  so adoption works on databases where `PUBLIC` has no privileges.

## [0.1.0] - 2026-10-21

### Added

- Web app (one container, port 3000) with a password login that refuses to start without an auth
  decision (`AUTH_PASSWORD`, or `AUTH=none` behind an authenticating proxy).
- Members page: one card per submodule with its manifest, the health of every instance and links.
- Instances on the Settings page: the base URLs of running tools.
- Credentials: create a GitHub App from the tool's manifest (personal account or organisation),
  find its installations and deliver it to the tool's instances; check a pasted personal access
  token against GitHub, name missing scopes and deliver it; one-time `.env` block as fallback.
  Credentials live in memory only, with a time limit and a size limit.
- Database: adopt a tool into a shared Postgres database (one role and schema per tool, read-only
  `octoforge_reader`) or a shared SQLite directory; release it again.
- Log page with every delivery and adoption.
- Member contract v1 (`docs/members.md`).
- Optional public URL per instance (Settings), for instances whose base URL GitHub cannot reach.
  GitHub App webhooks and setup pages go to that URL, else to the `public_url` a member reports in
  `GET /api/octoforge/status` (new optional field, contract stays 1), else to the base URL. The
  Credentials page shows which one applies.
- `GET /health`, a container image with a health check, `compose.yaml`, and image publishing on tags.
- `bin/verify` runs typecheck, lint, tests, build and a container smoke test after the index checks.

[Unreleased]: https://github.com/rojosinalma/octoforge/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/rojosinalma/octoforge/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/rojosinalma/octoforge/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/rojosinalma/octoforge/releases/tag/v0.1.0

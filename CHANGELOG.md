# Changelog

All notable changes to Octoforge are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/).

## [Unreleased]

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
- `GET /health`, a container image with a health check, `compose.yaml`, and image publishing on tags.
- `bin/verify` runs typecheck, lint, tests, build and a container smoke test after the index checks.

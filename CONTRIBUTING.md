# Contributing

Octoforge holds no application code. Changes to a tool belong in that tool's repository; open issues
and pull requests there. This repository takes changes to the index, the submodule set, the shared
documentation and the checks.

## Running the checks

```sh
git clone --recurse-submodules https://github.com/rojosinalma/octoforge.git
cd octoforge
bin/verify
```

`bin/verify` needs bash and git. It exits non-zero with a reason when the index, `.gitmodules` and the
submodules disagree, or when a tracked file contains a local path or a private address. Extra patterns
can be added per clone in `.git/info/leak-patterns` (one extended regex per line); that file is never
committed.

## Adding a tool

1. Add the submodule and its homepage:

   ```sh
   git submodule add https://github.com/rojosinalma/<tool>.git <tool>
   git config -f .gitmodules submodule.<tool>.homepage https://github.com/rojosinalma/<tool>
   ```

2. Add a row to the table in `README.md`, linking the tool's repository.
3. Run `bin/verify` and commit `.gitmodules`, the submodule and `README.md` together.

## Moving a pinned version

Commit the new submodule pointer on its own, with the tool and the target in the message
(`octotally: bump to v0.2.0`). Only point at commits that are pushed to the tool's default branch.
Dependabot does this weekly through a pull request.

## Commits and pull requests

- Every commit is signed. Unsigned commits are rejected by the branch rules.
- Plain, descriptive commit messages in the imperative.
- One topic per pull request; `bin/verify` must pass.

## Where the docs live

- `README.md`: the index and how to clone.
- `docs/SDD.md`: design, decisions and how the pieces fit.
- Everything about a single tool: that tool's repository.

# Git environment

Initialize long paths in the existing clone before creating a Windows linked
worktree. After creation, complete the [trusted installation sequence](supply-chain.md#installation-and-scan-order)
in the new worktree, then verify its generated hooks before committing or
pushing. Read the SSH procedure below before starting an SSH push.

## Windows worktree long-path initialization

Require effective `core.longpaths=true` in Git for Windows before creating a
linked worktree. The opt-in covers native C-based Git commands. Scripts and other
Windows programs can still have path limits.
[Git for Windows long-path support](https://gitforwindows.org/git-cannot-create-a-file-or-directory-with-a-long-path.html)

A longer worktree root can cause `Filename too long` while the main checkout
works. A managed checkout of the unchanged official Server's deep
issue-description tree previously failed with `core.longpaths` unset. Enabling
the setting locally allowed the managed retry. Preserve every original release
path and file.

From the existing clone root, inspect the effective value and its source.

```powershell
git config --show-scope --show-origin --get core.longpaths
```

If the value is unset or false, enable the repository-local setting and
inspect it again.

```powershell
git config --local core.longpaths true
git config --show-scope --show-origin --get core.longpaths
```

Confirm the actual worktree-creation invocation sees `true`. Repository
configuration normally applies across worktrees in the clone. Preserve and
resolve any worktree, command or process environment override. Keep changes
local to the clone and leave system/global Git settings and the registry alone.
[Git worktree configuration](https://git-scm.com/docs/git-worktree.html#_configuration_file)

After a checkout failure, inspect `git worktree list --porcelain` and the exact
failed path and registration before retrying. Use the owning tool's managed
lifecycle for its worktrees. For a manually created disposable worktree, verify
the exact target before ordinary Git worktree cleanup. Preserve unrelated work
and avoid force, reset, clean or recursive deletion as recovery.

## Local Git hook initialization

Finish the [trusted installation sequence](supply-chain.md#installation-and-scan-order),
then verify Husky in each clone and linked worktree before committing or pushing.
Git reaches the tracked `.husky/pre-push` through the generated
`.husky/_/pre-push`. Git ignores `.husky/_`, so a fresh worktree needs its own
generated entries. An install with `--ignore-scripts` skips root `prepare` and
may leave a configured hook path with no local generated hook.

Run `git config --show-origin --get core.hooksPath` and inspect the generated
entry in the current worktree. The expected path is `.husky/_`. If generation is
missing after the trusted ordinary install, run `pnpm prepare` and inspect again.
Resolve unexpected hook paths before setup can replace them. Preserve existing
user/global configuration and check for `HUSKY=0` or settings that disable scripts.

Push only with the actual hook present and enabled. A manual `pnpm verify:push`
can verify the work but cannot demonstrate that Git invoked the hook. Retain the
normal push output and distinguish a hook verification failure from a remote
transfer failure.

### Hook behavior

`commit-msg` invokes commitlint. Only Git's actual `MERGE_HEAD` proves a merge
and permits the skip.

`pre-commit` invokes `pnpm exec lint-staged --max-arg-length 4096` with the
default stash and partial-staging protections. The 4096-character command
batches accommodate Windows launcher expansion and quoting. Supported staged
TS/MTS/CTS/JS/CJS/MJS/JSON uses `biome check --write --no-errors-on-unmatched`.
Formatting, lint fixes and enabled assists, including `organizeImports`, can
write to the index and working tree. Preserve unrelated and unstaged work
through those default protections.

Other selected staged text goes through the read-only checker at
`tooling/quality/check-staged-text.ts`. It rejects normalized paths under the
retired `plugins/codex/debugging-cdp-targets/dist/` and
`plugins/claude-code/debugging-cdp-targets/dist/` trees before reading the
selected file or release evidence. The repository walker also reports retired
paths and continues ordinary maintained text, filename and directory checks.
[Quality policy](quality.md)

The App and Official package verifiers independently require the complete
original upstream inventory and exact bytes. Changed or incomplete original
release content fails verification. The delivered package contract supplies no
path-based permission to stage a retired host payload.
[Original release delivery and upgrades](supply-chain.md#official-release-delivery-and-upgrades)

`pre-push` uses `git rev-parse --local-env-vars` to enumerate Git's repository
routing variables and clears them before `pnpm verify:push`. Independent Git
fixtures can then use their own repositories safely. `--no-verify` and
`HUSKY=0` can bypass local hooks and supply no evidence of a successful run.

## SSH push initialization

For OpenSSH pushes, require `ServerAliveInterval=30` and
`ServerAliveCountMax=3` before starting Git. OpenSSH sends encrypted keepalives
after 30 seconds without received data and disconnects after three unanswered
requests. These options address idle transport during pre-push verification.
Initial connection timeouts require separate diagnosis.
[OpenSSH server-alive options](https://man.openbsd.org/ssh_config.5#ServerAliveInterval)

Initialize each clone and verify the effective command in each worktree. The
clone-local `core.sshCommand` setting does not travel with the repository.
Inspect `git config --show-scope --show-origin --get core.sshCommand`,
`ssh.variant` and the process's `GIT_SSH_COMMAND`, `GIT_SSH` and `GIT_SSH_VARIANT`
before changing configuration. Git selects `GIT_SSH_COMMAND`, effective
`core.sshCommand`, `GIT_SSH`, then `ssh` in that order. A new local command must
preserve any existing `GIT_SSH` wrapper.
[Git SSH configuration](https://git-scm.com/docs/git-config#Documentation/git-config.txt-coresshCommand)
[Git SSH environment precedence](https://git-scm.com/docs/git#Documentation/git.txt-GITSSHCOMMAND)

For ordinary OpenSSH with no custom command or wrapper, run these commands
from the clone root.

```powershell
git config --local core.sshCommand "ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=3"
git config --show-scope --show-origin --get core.sshCommand
```

For an existing custom command, preserve its executable, configuration,
identity, proxy and wrapper. Apply the two settings to its actual OpenSSH
invocation. Replace conflicting occurrences because OpenSSH uses the first
obtained value. Resolve higher-priority process or worktree overrides too.
Use the documented equivalent for a different SSH client and preserve that
client. Keep this configuration local to the repository.

Verify the effective OpenSSH executable and options with `-G`, using the
actual push remote's user, host alias and port. For the ordinary GitHub case,
run the following check.

```powershell
ssh -G -o ServerAliveInterval=30 -o ServerAliveCountMax=3 git@github.com
```

Confirm `serveraliveinterval 30` and `serveralivecountmax 3` in the output.
Configure the connection before Git opens its transport. The pre-push hook
runs after that point. Retain the actual push and hook results under the
[hook initialization procedure](#local-git-hook-initialization).

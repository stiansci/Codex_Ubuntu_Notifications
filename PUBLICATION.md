# Public release preparation

Run these checks before publishing:

```bash
npm run public:check -- --release
npm test
npm run package
npm run package:check
```

`public:check` inspects current publishable files, tracked exclusions and history reachable from HEAD, branches, tags and remote-tracking branches. It reports possible credential formats, personal home paths, private files and non-noreply commit email addresses without printing matched values. `--release` also rejects uncommitted changes and untracked public files. This is a pattern-based check, not proof that no possible secret exists. CI fetches full history to apply the same check.

Keep `private/`, local instructions (`AGENTS.md`), `.agents/`, `.codex/`, `.aws/`, credentials, dotenv files, local databases/session logs, editor settings, environments and private backups out of Git. Design experiments and their generators are local working material under `private/`. Audio production sources remain private; only the original WAV presets ship. Example dotenv files are public and must contain placeholders only.

`.gitignore` controls future tracking; it does not erase existing commits. Before the first public push, clean private content and personal commit metadata from reachable history. Store original-history backups under the ignored `private/backups/` directory. Never upload those backups as release assets. The legacy `.private/` location also stays ignored to prevent accidental tracking if an older tool recreates it.

Local dependencies, build output, private instructions, legacy artwork and existing caches are consolidated under `private/`. Ignored compatibility links at `node_modules`, `dist` and `AGENTS.md` preserve standard tool paths; the actual files live inside `private/`. `npm ci` can recreate a normal root `node_modules/` directory, and Python can recreate caches. Those generated paths remain ignored. Environment-managed `.agents/`, `.codex/` and `.aws/` directories stay in place and are never public sources.

Codex may retain private editor checkpoints under `refs/codex/`. These local recovery refs are not public branches or tags, are excluded from the publication scan, and must never be pushed. Use ordinary branch/tag pushes, never `git push --mirror`. The provided pre-push hook rejects private source refs and destinations, scans public history and requires a clean release tree. Enable it in each development clone with `git config --local core.hooksPath .githooks`.

Use the repository's public identity for new commits:

```bash
git config --local user.name KaroTechnica
git config --local user.email stiansci@users.noreply.github.com
```

The public tree retains extension source, original artwork, tests, dependency lockfile, CI, license and user documentation. `.vscodeignore` separately limits the installed VSIX to runtime files and selected documentation. `dist/` is local output; release assets should be selected explicitly.

Version 1.1.23 is a release candidate until the human desktop checklist in [TESTING.md](TESTING.md) is completed for the configurations advertised as tested. Automated fixtures and widget screenshots do not certify actual desktop integration. Record real results and retain unverified entries honestly.

GitHub push and Marketplace publication are separate actions. Confirm the destination repository and publisher ownership before either action. No upload or publication is performed by the release scripts.

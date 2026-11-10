# Developer reference

This document is for contributors. The root README is the customer-facing description used on GitHub, the Visual Studio Marketplace page and VS Code's extension Details tab. Keep build procedures, implementation notes and agent instructions out of that description.

## Build and check

Use Node.js 22+, npm and Python 3 in the `aiml` environment. From the repository root:

```bash
npm ci
npm run public:check
npm test
npm run package
npm run package:check
```

`npm run package` creates the local VSIX with bundled documentation images. `npm run package:marketplace` creates the separate Marketplace artifact with HTTPS documentation URLs. `./build-and-install.sh` explicitly rebuilds, checks and installs the local package. Standard tool paths may be ignored compatibility links to local `private/` storage.

For a development host:

```bash
code --new-window --extensionDevelopmentPath="$PWD" .
```

Full desktop validation is performed by the human user outside the sandbox. See [TESTING.md](../TESTING.md), [PUBLICATION.md](../PUBLICATION.md), [VERSIONING.md](../VERSIONING.md) and [ASSETS.md](../ASSETS.md) for verification, publishing, versioning and asset maintenance.

## Source layout

- `lib/`: extension logic, process helpers and local activity readers.
- `media/`: sidebar files and activity-state artwork.
- `sounds/`: approved distributed audio.
- `scripts/` and `test/`: development, packaging and release checks.
- `docs/`: contributor documentation and synthetic screenshots.

Local instructions, recovery archives, design experiments and private production sources live under ignored `private/` storage. `AGENTS.md` is an ignored link to the private project instructions. Environment-managed session directories remain ignored at the root. None of this local material belongs in the public VSIX.

## Activity detection

The reader supports `thread_history_1.sqlite` and `state_5.sqlite` with read-only SQLite connections and query-only enforcement. It uses workspace-scoped session JSONL files referenced by `threads.rollout_path` when that optional column is present. Rollout files must stay inside the configured Codex home. Required columns:

- `thread_turns`: `thread_id`, `turn_id`, `completed_at`, `status`.
- `thread_items`: `thread_id`, `turn_id`, `item_type`, `rollout_ordinal`, `item_json`.
- `threads`: `id`, `cwd`, `title`, `source`, `thread_source`.

Only VS Code user threads are considered. Completed SQLite turns, explicit session `task_complete` events and `agent_message` events with phase `final` or `final_answer` identify answers. Session final answers require an observed `task_started` turn ID. Commentary and subagents are excluded, and a final answer and its later completion share a deduplication key.

Unknown schemas produce an incompatibility state rather than guessed database names. Watching is backed by polling every 1.2 seconds, with reconnection after replacements and retries after temporary errors. EMFILE/ENOSPC watcher errors leave polling active; retries back off. Startup seeds a baseline and begins existing rollout files at their end, so a completion during the initial scan can be treated as baseline. New rollout records use bounded buffers, preserve incomplete lines and skip oversized records.

The most specific containing canonical workspace owns an answer. Cross-window atomic claims use hashed `(Codex home, thread, turn)` identifiers in a private temporary directory. Eligible windows claim at most once; claims expire after seven days. Failure after claiming can lose an alert. Reader restarts retain extension-session deduplication.

The shared indicator reads chat lifecycle events across workspaces. Commentary, reasoning and tool calls also identify continued work after a final answer or a resume without another start event. Trailing usage records and tool outputs do not reopen completed work. Changed logs are scanned backwards to the latest state evidence in bounded chunks, skipping incomplete or oversized records, so large outputs cannot hide earlier lifecycle events. Unchanged files reuse their cached state. Previous-boot sessions, archived chats, CLI chats and subagents are excluded. Quiet unfinished sessions become uncertain after 15 minutes. The first owning window's Codex-home configuration determines its scope. Activity polling preserves menu items for keyboard navigation.

## Desktop processes

GTK and native notification helpers receive private payloads through stdin rather than command-line arguments or temporary payload files. Native notifications use Python's standard-library ctypes interface to libnotify. Diagnostics log deduplicated error categories instead of raw SQL errors or conversation content. Keep those properties when changing monitoring or notification code.

Detailed historical styling notes are retained only under ignored `private/notes/`. They are not part of customer documentation or release assets.

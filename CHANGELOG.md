# Changelog

## 1.1.12

- Write VSIX build artifacts to the ignored `dist/` directory.
- Keep package verification and explicit installation pointed at the versioned artifact there.

## 1.1.11

- Distribute the approved ambient WAV presets while keeping their production scripts private.
- Keep public icon generation available and validate bundled audio format and level.

## 1.1.10

- Include four original stereo ambient startup cues with gentle swells and suspended harmonies.
- Keep preset IDs stable while showing descriptive names in the sidebar.

## 1.1.9

- Replace restored audio with four original project-owned chimes.
- Document the bundled asset provenance and validate the WAV files in tests.

## 1.1.8

- Show Markdown table rows as compact column-name/value pairs in the GTK preview.
- Keep table cells escaped and preserve fenced code blocks.

## 1.1.7

- Cap the complete GTK answer preview at one third of the monitor work area.
- Truncate long answers to fit the available text area without expanding the popup.

## 1.1.6

- Override GTK action-button gradients and child-label colors for normal, hover and pressed states.
- Keep button fallbacks within the resolved theme palette and ensure readable text contrast for normal and hover backgrounds.

## 1.1.5

- Adopt the original Signal Bell proposal for Marketplace and desktop notification icons, with a matching theme-aware monochrome Activity Bar icon.
- Keep icon geometry and palette editable in Python/JSON, with an icons-only regeneration command.

## 1.1.4

- Match the inner answer background and foreground to VS Code editor colors. Inherit the resolved theme palette when optional color tokens are unavailable.

## 1.1.3

- Display the project notification label as Codex Ubuntu Notifications with spaces, and allow the preview header to show the full name.

## 1.1.2

- Include the Markdown renderer and theme module in the VSIX and report missing files separately from unexpected ones.
- Detect workspace-scoped Codex final answers and task completions incrementally from local session JSONL files when live user turns are absent from SQLite history.
- Keep periodic completion checks running when inotify returns EMFILE/ENOSPC, and back off watcher retries.
- Wait for the first reader result before printing Check Configuration diagnostics, and report the watcher error code.

## 1.1.1

- Handle unavailable desktop tools and recover from reader/process failures.
- Add dependency diagnostics, real monitoring states and a Check Configuration command.
- Fix SQLite URI handling, validate the supported schema and recover after database replacement.
- Fix multi-root labels and navigation, and deduplicate notifications across local windows.
- Isolate sidebar scripts, apply a restrictive CSP and validate messages and audio imports.
- Add machine-local Codex home configuration and explicit remote/platform exclusions.
- Use pinned VSCE packaging, MIT licensing, original reproducible assets and automated checks.
- Document compatibility targets separately from manually verified configurations.

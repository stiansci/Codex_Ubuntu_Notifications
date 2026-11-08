# Changelog

## 1.1.25

- Apply the MIT License subject to Commons Clause License Condition v1.0 to project-owned code and original distributed assets. Ordinary work use remains allowed; the clause's sale restriction applies.
- Declare the complete license through `SEE LICENSE IN LICENSE` and include a plain-language licensing guide in both VSIX variants.
- Add version-history listing, safe version bumps and immutable local version tags tied to actual committed manifests.
- Add verified release preparation with both VSIX variants, source commit records, release notes and SHA-256 checksums.
- Add a manually invoked GitHub Actions workflow that prepares a draft prerelease for human review; Marketplace publication remains separate.
- Preserve the original unpublished history and old MIT-only build archives privately before reissuing local development snapshots with the selected combined terms.

## 1.1.24

- Replace the bell with an original miniature agent-reply notification card for the Marketplace icon, popup and sidebar header.
- Use a simplified reply bubble with answer lines for the Activity Bar and top-bar status colors.
- Refresh the synthetic notification and top-bar screenshots to match the new artwork.
- Add a separately checked Marketplace VSIX with HTTPS documentation images pinned to the release tag; keep local VSIX documentation usable offline.
- Record the user-reported successful 1.1.23 top-bar smoke test without implying that the full desktop release checklist has passed.

## 1.1.23

- Clean inherited Snap library, GTK/GIO module and typelib paths even when terminal sessions no longer contain SNAP or SNAP_NAME.
- Share the host environment policy between the extension and desktop smoke check; preserve desktop session and audio access.
- Use system GJS, GDBus and dbus-run-session in the smoke check so Conda or Snap PATH entries cannot shadow Ubuntu desktop tools.
- Cover partially cleaned environments with shared JavaScript/Python regression fixtures.

## 1.1.22

- Send GTK preview and native notification payloads through stdin so private answer text and workspace labels do not appear in process arguments.
- Replace the vendor blossom with original bell-and-check artwork throughout the extension, tray icons and documentation screenshots.
- Exclude local instructions, design experiments, credentials, databases and private backups from public Git sources.
- Add a public-source and Git-history privacy check to release verification and CI, including a clean-release check for missing source files.
- Correct the README title and installation version. Desktop certification remains pending human validation.

## 1.1.21

- Replace conversation titles in the top-bar menu with explicit English workspace actions, grouping working chats by workspace and distinguishing same-named folders.
- Make the activity summary an Open VS Code action and remove the dimmed helper text.
- Preserve menu items during activity polling so keyboard navigation and assistive technology keep stable targets.
- Stop reading and exporting conversation titles in the activity worker.

## 1.1.20

- Enable only the bottom-left answer preview by default; Ubuntu Desktop Popup remains selectable and defaults to off.
- Respect the Ubuntu notification toggle even when the preview fails or is unavailable, and use the in-editor fallback instead.
- Require libnotify-bin only when Ubuntu desktop notifications are enabled.

## 1.1.19

- Offer first-use Ubuntu dependency setup, with an Install Missing Dependencies sidebar button and Command Palette command.
- Select packages for enabled features, detect the existing audio system or ask which playback tools to install, and run apt in a visible terminal with password entry and package confirmation there.
- Recheck dependencies and restart monitoring after setup, handle cancellation and failures, and distinguish missing GTK/AppIndicator libraries from display-session problems.

## 1.1.18

- Ship the approved refined Ember icon under a new extension version so sidebar and Activity Bar assets load from a fresh installation path.

## 1.1.17

- Adopt the refined Ember logo: a large Codex blossom inside a curved outline bell on light ivory, with matching sidebar branding and a theme-aware Activity Bar icon.
- Add sidebar color pickers and editable hex values for the top-bar icons and notification, with individual and global reset controls.
- Center the Codex label beside the project name and give it a rounded badge with configurable background and text colors.
- Keep completion monitoring running when colors change and refresh the README notification screenshot.

## 1.1.16

- Put the working-chat count before the Codex logo, separated by a vertical bar.
- Add a small Codex blossom badge to the extension and Activity Bar bell icons.
- Include a notification screenshot and blue/green top-bar previews in the README and VSIX.

## 1.1.15

- Use the same OpenAI blossom logo as the Codex VS Code extension for the top-bar indicator, with flashing blue and steady green variants.

## 1.1.14

- Add one shared Ubuntu top-bar Codex icon with a working-chat count across local VS Code workspaces.
- Flash blue while working, show steady green when idle and gray when activity cannot be confirmed. Static blue is configurable.
- Exclude previous-boot activity and subagents; flag quiet unfinished sessions instead of trusting stale database statuses.
- Fix preview-button launcher detection for Snap VS Code and show launch failures.

## 1.1.13

- Shorten the four bundled cues to 1.1 seconds and retune their notes into brighter major chords.
- Use Drift as the default sound and simplify the preset names.
- Remove backend helper text and collapse configuration diagnostics at the bottom under Troubleshooting & Bug Reports.

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

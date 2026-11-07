# Release verification for 1.1.22

Status: release candidate. Human desktop validation is pending; no supported desktop is certified by automated tests.

## Automated checks

Use the already active `aiml` environment. Node.js 22+ is required for VSCE.

```bash
npm ci
npm run public:check -- --release
npm test
npm run package
npm run package:check
```

Tests use temporary synthetic databases and mocked VS Code/desktop APIs. They do not read personal conversations, connect to a graphical session, install the extension, publish, or validate the GPU. CI runs on Ubuntu 22.04 and 24.04 with Python 3.10 and 3.12 and Node 22. Ubuntu 26.04 and ARM64 remain human validation targets rather than inferred CI coverage.

Local automated evidence for 1.1.22, recorded 2026-11-07: 62 JavaScript tests and 20 Python tests pass in `aiml` with Node 26.6.0 and Python 3.10.20. Additional bounded checks exercised the actual GJS stdin reader with Unicode, invalid JSON and oversized input; real libnotify delivered a synthetic payload to a private D-Bus fixture. Documentation widgets were captured on a virtual display with synthetic content. These checks do not certify a real desktop/session combination.

## Human desktop run

```bash
code --new-window --extensionDevelopmentPath="$PWD" .
```

In the development host:

1. Open the panel and run Check Configuration. Verify that the reported backends match the desktop. Missing optional components must yield a useful explanation.
   In a disposable Ubuntu desktop VM/profile with missing packages, verify the first-use **Install Missing Dependencies** prompt and **Finish Setup** sidebar card. Choose **Later**, reload, and confirm that only the sidebar/Command Palette action remains. Run setup, check that the terminal shows only the required feature packages (plus any libraries that could not yet be probed), enter the password there, and confirm apt's package changes. Monitoring should restart automatically after the task finishes. Test cancellation before and during installation, an unavailable repository, duplicate clicks, and retry. Verify automatic PipeWire/PulseAudio selection, the audio picker when detection is inconclusive, and no offer for unsupported/remote windows. With all libraries installed but no X11/XWayland display, setup must not suggest reinstalling GTK. Do not remove dependencies from your working desktop to create these conditions.
2. Run Send Test Notification. Check the native banner, audio volume, preview, close button and VS Code button. Repeat with the preview disabled and with all visual channels disabled.
3. Complete a Codex turn with a Markdown table and verify that column names and values are readable. Complete a long Codex turn and check that the entire bottom-left preview stays within one third of the monitor work area. Complete real Codex turns with VS Code focused and unfocused. Verify both notification modes. Reloading the window must not replay historical completions.
4. Open two windows on the same project. Only one eligible window should notify. Repeat with one window disabled or excluded by its focus setting.
5. Use a multi-root workspace and a symlinked project. Check the correct label and destination. Without a folder, monitoring must be paused.
6. Import and remove a sound, import it twice, test supported formats, and check that unsupported codecs fail visibly. Verify oversized files and links are rejected.
7. Change the machine-local Codex home to a temporary test location. Verify missing/incompatible database states and recovery after restoration. Test a synthetic user session with no SQLite turn rows: a final-answer event must notify once, and its later task-completion event must not notify again. Verify periodic detection also works with the filesystem watcher unavailable. Do not modify real Codex databases to simulate errors.
8. Reload and disable the extension while a preview is open. Verify child processes and the preview stop.
9. Check desktop Do Not Disturb and lock-screen behavior, multiple monitors and display scaling. These are controlled partly by the desktop, and must not be advertised as uniform.
10. Install the generated VSIX explicitly in a separate VS Code profile and repeat steps 1 through 4:

```bash
code --profile CodexNotifierReleaseTest --install-extension dist/codex-ubuntu-notifications-1.1.22.vsix
code --profile CodexNotifierReleaseTest --new-window .
```

## Manual matrix

All cells start **not verified**. Record the OS release, CPU architecture, desktop/version, display session, VS Code version/package, Codex version, observed database schema and test results before changing status. Do not infer desktop compatibility from unit tests or presence of binaries.

| Ubuntu | Desktop targets | Session targets | VS Code packages | Current evidence |
| --- | --- | --- | --- | --- |
| 22.04 LTS | GNOME, KDE Plasma, Xfce | X11; Wayland where offered | deb, Snap | Not manually verified |
| 24.04 LTS | GNOME, KDE Plasma, Xfce | X11; Wayland where offered | deb, Snap | Not manually verified |
| 26.04 LTS | GNOME, KDE Plasma, Xfce | X11/Wayland where offered | deb, Snap | Not manually verified |
| ARM64, at least one LTS desktop | Record actual desktop | Record actual session | Record actual package | Not manually verified |

A desktop/session combination not offered by the distribution is not applicable, not a passed test. Validate native notifications and fallback behavior on Wayland without XWayland separately.

## Publication gate

- Automated checks and actual VSIX installation pass.
- Public-source checks pass for the exact committed release, including all reachable Git history and noreply commit metadata.
- With a synthetic test notification visible, confirm that process listings do not contain its answer, title, workspace label or PDF URLs. Both GTK and native notification payloads use stdin.
- No unhandled errors for missing tools or temporary database failures.
- Manual matrix accurately records what was tested; limitations remain visible.
- The GitHub repository link resolves and the publisher account owner confirms `KaroTechnica`.
- Combined MIT + Commons Clause license, asset provenance, changelog and version agree.
- Review the exact VSIX file list and commit diff, then authorize GitHub push and Marketplace publication separately.
# Top-bar indicator checks

Run `python -m unittest discover -s test -p test_activity.py` for synthetic chat-count fixtures and `node test/indicator.test.js` for the process lifecycle. From a desktop terminal, `python test/check_indicator_desktop.py` performs a bounded smoke check on a private D-Bus session: idle green/0, active flashing blue/1, completion green/0 and single-instance ownership. It does not read real chat content or install anything.

After installation, verify the top-bar number across two VS Code workspaces and cancel one running turn. Disable **Flash While Working** in the sidebar to check static blue. The count should update within roughly two seconds. Quiet unfinished sessions become uncertain after 15 minutes, displaying `?` rather than falsely reporting all work finished. Check that closing the owning window lets another open window take over within ten seconds.

Open the indicator menu using the keyboard. Verify the **Open VS Code** summary action and **Open workspace: folder (1 chat working)** actions are readable and announced by the desktop screen reader, and that a focused workspace action stays focused across several activity updates. Verify two working chats in one workspace share a single action with the plural count, and same-named folders in different locations show distinct paths. Conversation titles, including titles in other languages, must never appear. Check the checkbox's checked state is announced and its label remains readable in the desktop's light, dark and high-contrast themes. The native menu uses the desktop theme rather than hardcoded text colors.

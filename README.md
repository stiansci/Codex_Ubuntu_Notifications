# Codex Ubuntu Notifications

Independent VS Code extension for completion alerts in local Codex workspaces on Ubuntu. It can show a desktop notification, play a chime and optionally display an answer preview. A configuration panel reports missing dependencies and monitoring failures.

This is not an official OpenAI or Microsoft extension. It relies on a specific local Codex database schema, which can change independently of this project.

## Compatibility and verification

Compatibility targets are Ubuntu **22.04, 24.04 and 26.04 LTS**, GNOME/KDE Plasma/Xfce, X11/Wayland and VS Code `.deb`/Snap. These are targets, **not a claim that every combination has been manually verified**. No desktop combination or ARM64 device has been certified by the automated tests. See [TESTING.md](TESTING.md) for the release checklist and verification matrix.

- Requires VS Code 1.90 or newer, a trusted local folder and initialized Codex databases.
- Local Linux desktop windows only. SSH, containers, WSL, Codespaces, browser VS Code, virtual workspaces and non-Linux platforms are not supported.
- Without a folder open, automatic monitoring is paused. The test command still works.
- Notifications require a running FreeDesktop notification service and a desktop session bus. Do Not Disturb and lock-screen behavior are controlled by the desktop.
- Native notifications work independently of the optional preview. The preview requires GTK3, GJS and a working X11 display, including XWayland on Wayland sessions. Pure Wayland sessions without XWayland use native notifications instead. Positioning on arbitrary Wayland compositors is not promised.
- Audio tries PipeWire, then PulseAudio, then ALSA. ALSA is WAV-only and does not apply the configured volume. Other formats depend on the codecs supported by the installed backend. Unavailable Yaru sound presets are hidden.

## Dependencies

Python 3 with its standard `sqlite3` module is required for monitoring. Ubuntu 22.04's Python 3.10 is supported. Node.js is not required by users installing a VSIX; VS Code provides the extension runtime.

Desktop notifications:

```bash
sudo apt install python3 libnotify-bin
```

Choose audio tools appropriate for the audio server already in use; the extension never installs packages or changes the audio server:

```bash
# PipeWire
sudo apt install pipewire-bin
# PulseAudio
sudo apt install pulseaudio-utils
# Optional WAV-only ALSA fallback
sudo apt install alsa-utils
```

Optional preview dependencies:

```bash
sudo apt install gjs gir1.2-gtk-3.0
```

A working X11/XWayland session is also required for the preview. Run **Codex Ubuntu Notifications: Check Configuration** to check the current session. Finding a binary alone does not prove its service or codecs work; runtime failures are reported too.

## Configuration

Use the activity-bar panel or VS Code settings. Settings are machine-local and cannot be supplied by a repository's workspace settings.

| Setting under `codexNotifier` | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Start or stop automatic monitoring. |
| `mode` | `always` | `always` or `unfocused`. |
| `desktopNotification` | `true` | Request a native desktop notification. |
| `previewCard` | `true` | Request an optional GTK3 answer preview. |
| `previewDuration` | `7` | Preview duration, 3 to 20 seconds. |
| `sound` | `true` | Play completion audio. |
| `soundChoice` | `synth-1` | Four original ambient startup presets or `custom:<filename>`. Legacy preset IDs remain accepted. |
| `volume` | `55` | 5 to 100 percent; unavailable with ALSA fallback. |
| `vscodeToast` | `false` | Also show an in-editor message. |
| `codexHome` | empty | Absolute Codex home path. Empty uses `CODEX_HOME`, then `~/.codex`. Changing it restarts the reader. |

Commands:

- **Codex Ubuntu Notifications: Check Configuration**: recheck dependencies, restart the monitor and open the diagnostic Output channel.
- **Codex Ubuntu Notifications: Send Test Notification**: test the selected channels, even when automatic monitoring is disabled or VS Code is focused.
- **Codex Ubuntu Notifications: Import Custom Sound File**: copy a regular local `.wav`, `.ogg`, `.oga`, `.mp3` or `.flac` file, up to 20 MiB. The import uses a unique filename and does not overwrite existing sounds. Symbolic links are rejected.

Existing custom sounds remain in `~/.config/codex-notifier/sounds/`. Oversized or linked files are not listed or played.

If a requested preview is unavailable, a native notification is attempted. If requested visual channels fail, an in-editor message is used. Explicitly disabling all visual channels keeps notifications audio-only. Missing components do not disable independent channels.

## Diagnostics and privacy

The panel distinguishes Ready, Disabled, Paused, Checking, Waiting for Codex, Incompatible, Partially available and Unsupported. It reports database, notification, audio and preview capabilities. The Output channel records deduplicated error categories, not SQL errors containing paths or conversation content.

No telemetry or application network requests are implemented. The extension reads local completion records, workspace-scoped session events, working directories, titles and the latest answer, and can pass previews to local desktop processes and the notification service. Session records are parsed locally; tool records do not generate alerts and are not logged. Previews can be visible on screen or retained by the desktop notification history. Disable the visual channels if you do not want answer previews. A separate privacy-mode feature is not included in this release.

Imported audio is stored locally. Cross-window claims contain hashed identifiers only. No credentials or conversations are included in the VSIX.

## License

Code and replacement assets use the [MIT license subject to Commons Clause v1.0](LICENSE). See [ASSETS.md](ASSETS.md) for asset provenance and regeneration instructions.


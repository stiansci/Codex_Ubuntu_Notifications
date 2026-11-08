# Codex Ubuntu Notifications

Get a bottom-left answer preview and a chime when Codex finishes a reply in VS Code. Keep track of working chats across your Ubuntu workspaces, and return to the right project when a reply is ready.

This is an independent extension, not an official OpenAI or Microsoft product.

## What you can do

- Read a short answer preview without switching back to VS Code.
- Open the relevant workspace from the notification.
- Open PDFs linked in a reply. Multiple PDFs appear in a chooser.
- Choose a notification sound, adjust its volume or import your own audio.
- See how many chats are working across your workspaces.
- Choose whether to receive alerts every time or only while VS Code is in the background.

Answer previews and sound are enabled by default. Native Ubuntu desktop notifications are optional and start disabled.

![Answer preview with a completed reply and VS Code button](docs/screenshots/bottom-left-notification.png)

## Track chat activity

The Ubuntu top bar shows the number of working chats across your VS Code workspaces. Multiple windows share the same count. Open its menu to switch to a workspace with active chats.

| Status | Meaning |
| --- | --- |
| Blue | At least one tracked chat is working. |
| Green, with a count of zero | No tracked chats are working. Cancelled or failed turns also count as idle. |
| Gray or a `?` | Activity cannot be confirmed, or a chat has been quiet for an extended period. |

Counts normally update about every two seconds. Disable **Flash While Working** for a steady display, or turn off **Ubuntu Top-Bar Icon** to hide the activity count. Conversation titles are not displayed in the top-bar menu.

| Working | Idle |
| --- | --- |
| ![Two chats working](docs/screenshots/topbar-blue.png) | ![No chats working](docs/screenshots/topbar-green.png) |

The screenshots use sample content and activity counts.

## Get started

1. Install the extension in VS Code. For a downloaded `.vsix` file, open the Extensions view, choose **Install from VSIX…** from its menu and select the file.
2. Open a trusted local workspace and start using Codex there.
3. Open the **Codex Ubuntu Notifications** panel to choose your alerts and check the setup status.
4. Run **Codex Ubuntu Notifications: Send Test Notification** from the Command Palette to try your settings.

If dependencies are missing, choose **Install Missing Dependencies** or use **Finish Setup** in the panel. Setup opens a visible Ubuntu terminal. Review the package changes and enter your administrator password there if asked. If prompted to choose an audio system, select the one already used by your desktop.

Choosing **Later** dismisses the first-use setup prompt. You can return to setup from the panel or Command Palette. Failed or cancelled installation can be retried. Installing packages requires administrator privileges and access to your configured Ubuntu package repositories.

## Choose your alerts

Use the extension panel or the `codexNotifier` settings in VS Code. Settings apply to your machine and cannot be supplied by a repository's workspace settings.

| Setting | Default | What it does |
| --- | --- | --- |
| `enabled` | `true` | Enable automatic completion alerts. |
| `mode` | `always` | Notify every time, or use `unfocused` for alerts only while VS Code is in the background. |
| `previewCard` | `true` | Show the bottom-left answer preview. |
| `previewDuration` | `7` | Keep the preview visible for 3 to 20 seconds. |
| `sound` | `true` | Play a completion sound. |
| `soundChoice` | `synth-2` | Choose Dawn, Drift, Halo, Horizon or an imported sound. |
| `volume` | `55` | Set sound volume from 5 to 100 percent. |
| `desktopNotification` | `false` | Also send a native Ubuntu desktop notification. |
| `vscodeToast` | `false` | Also show an information message inside VS Code. |
| `topBarIndicator` | `true` | Show the number of working chats across workspaces. |
| `topBarFlash` | `true` | Flash while chats are working. |
| `colors` | `{}` | Customize activity and notification colors. |
| `codexHome` | empty | Set a custom local Codex data location, if needed. Empty uses `CODEX_HOME` or `~/.codex`. |

Use **Colors** to change backgrounds, text, buttons, borders and activity states. Color fields accept values such as `#3b82f6`, `3b82f6` or `#abc`. Clear a field to restore its default, or choose **Reset All Colors**. Changes save automatically. Unset preview colors follow your VS Code theme; native Ubuntu notifications use the desktop's appearance.

Use **Import Custom Sound File** to add a regular local `.wav`, `.ogg`, `.oga`, `.mp3` or `.flac` file up to 20 MiB. Available formats depend on your installed audio support. Symbolic links are not accepted. The ALSA fallback supports WAV only and does not apply the volume setting.

If the bottom-left preview is unavailable, the extension uses an in-editor message. Native Ubuntu notifications are sent only when you enable them. Disable all visual channels for audio-only alerts.

## Compatibility

- Requires VS Code 1.90 or newer, Python 3 and a trusted local workspace with Codex initialized.
- Intended for local Ubuntu desktops. Compatibility targets include Ubuntu 22.04, 24.04 and 26.04 LTS; availability varies by desktop environment and display session.
- SSH, containers, WSL, Codespaces, browser VS Code and non-Linux systems are not supported.
- The bottom-left preview needs GTK3, GJS and X11 or XWayland. Sessions without these use the in-editor fallback.
- The top-bar count needs Ayatana AppIndicator3 and an enabled AppIndicators service in your desktop session.
- Automatic monitoring pauses when no local folder is open. Test notifications remain available.

Desktop Do Not Disturb, lock-screen behavior, display scaling and notification history are controlled partly by your desktop. Opening or reloading VS Code does not replay historical replies. Changes to Codex's local data format can temporarily affect detection.

## Troubleshooting

Run **Codex Ubuntu Notifications: Check Configuration** to recheck your setup and open the diagnostic Output channel. The panel reports whether monitoring is ready, paused, waiting for Codex or partially available.

If something is missing, use **Install Missing Dependencies**. If a test works but automatic alerts do not, check that a local folder is open, notifications are enabled and your chosen focus mode allows an alert. For native Ubuntu notifications, also check your desktop's Do Not Disturb setting.

## Privacy

The extension reads local Codex activity and reply content without modifying Codex's databases. No telemetry or application network requests are implemented. Optional dependency installation contacts your configured Ubuntu package repositories.

Answer previews may be visible to people looking at your screen, and native notifications may remain in desktop notification history. Disable the visual channels if you do not want replies displayed. Imported sounds stay on your computer.

## License and support

The source is available under the [MIT License subject to Commons Clause v1.0](LICENSE). Ordinary personal and work use is allowed. Selling the extension or services covered by the clause's definition is restricted. See [LICENSING.md](LICENSING.md) for the full scope.

Report problems through [GitHub Issues](https://github.com/stiansci/Codex_Ubuntu_Notifications/issues), including your Ubuntu and VS Code versions and the result of **Check Configuration**. Do not include credentials or private conversation content.

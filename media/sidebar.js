"use strict";

    const vscode = acquireVsCodeApi();
    let state = {};
    let themeGeneration = 0;
    function reportTheme() {
      const style = getComputedStyle(document.body);
      const names = {
        background: ['notifications-background', 'editorWidget-background', 'editor-background'],
        foreground: ['notifications-foreground', 'editorWidget-foreground', 'editor-foreground'],
        muted: ['descriptionForeground'], inset: ['editor-background', 'notifications-background'],
        insetForeground: ['editor-foreground', 'notifications-foreground'],
        border: ['notifications-border', 'widget-border'], button: ['button-background'],
        buttonText: ['button-foreground'], hover: ['button-hoverBackground']
      };
      const tokens = {};
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      for (const [key, candidates] of Object.entries(names)) {
        for (const name of candidates) {
        const color = style.getPropertyValue(`--vscode-${name}`).trim();
        if (!color || !CSS.supports('color', color)) continue;
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        const pixel = ctx.getImageData(0, 0, 1, 1).data;
        if (pixel[3] !== 255) continue;
        tokens[key] = '#' + [...pixel].slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('');
        break;
        }
      }
      tokens.fontFamily = style.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
      tokens.fontSize = parseFloat(style.fontSize);
      vscode.postMessage({ type: 'theme', generation: themeGeneration, tokens });
    }
    const themeObserver = new MutationObserver(() => reportTheme());
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-vscode-theme-id'] });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['style', 'class', 'data-vscode-theme-id'] });

    const enabledToggle = document.getElementById("enabledToggle");
    const statusBadge = document.getElementById("statusBadge");
    const modeSelect = document.getElementById("modeSelect");
    const desktopToggle = document.getElementById("desktopToggle");
    const previewCardToggle = document.getElementById("previewCardToggle");
    const previewDurationWrap = document.getElementById("previewDurationWrap");
    const previewDurationSlider = document.getElementById("previewDurationSlider");
    const previewDurationLabel = document.getElementById("previewDurationLabel");
    const toastToggle = document.getElementById("toastToggle");
    const soundToggle = document.getElementById("soundToggle");
    const soundSelect = document.getElementById("soundSelect");
    const previewBtn = document.getElementById("previewBtn");
    const volumeSlider = document.getElementById("volumeSlider");
    const volumeLabel = document.getElementById("volumeLabel");
    const importBtn = document.getElementById("importBtn");
    const customList = document.getElementById("customList");
    const testBtn = document.getElementById("testBtn");

    function render() {
      enabledToggle.checked = !!state.enabled;
      statusBadge.textContent = state.diagnostics?.status || "Checking";
      document.getElementById("diagnostics").textContent = (state.diagnostics?.details || []).join("\n");
      statusBadge.className = "badge " + (state.diagnostics?.status === "Ready" ? "on" : "off");

      modeSelect.value = state.mode || "always";
      desktopToggle.checked = !!state.desktopNotification;
      const previewOn = state.previewCard !== false;
      previewCardToggle.checked = previewOn;
      previewDurationWrap.style.display = previewOn ? "block" : "none";
      previewDurationSlider.value = state.previewDuration ?? 7;
      previewDurationLabel.textContent = (state.previewDuration ?? 7) + "s";
      toastToggle.checked = !!state.vscodeToast;
      soundToggle.checked = !!state.sound;
      volumeSlider.value = state.volume ?? 55;
      volumeLabel.textContent = (state.volume ?? 55) + "%";

      soundSelect.innerHTML = "";
      const presetGroup = document.createElement("optgroup");
      presetGroup.label = "Built-in Tones";
      for (const p of state.presets || []) {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.label;
        presetGroup.appendChild(opt);
      }
      soundSelect.appendChild(presetGroup);

      if (state.customSounds && state.customSounds.length > 0) {
        const customGroup = document.createElement("optgroup");
        customGroup.label = "Imported Custom Sounds";
        for (const c of state.customSounds) {
          const opt = document.createElement("option");
          opt.value = c.id;
          opt.textContent = c.label;
          customGroup.appendChild(opt);
        }
        soundSelect.appendChild(customGroup);
      }

      soundSelect.value = state.soundChoice || "synth-1";
      if (!soundSelect.value && soundSelect.options.length > 0) {
        soundSelect.selectedIndex = 0;
      }

      customList.innerHTML = "";
      if (!state.customSounds || state.customSounds.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-note";
        empty.textContent = "No custom sounds imported yet.";
        customList.appendChild(empty);
      } else {
        for (const c of state.customSounds) {
          const item = document.createElement("div");
          item.className = "custom-item";
          const nameSpan = document.createElement("span");
          nameSpan.className = "custom-name";
          nameSpan.textContent = c.fileName;
          nameSpan.title = c.fileName;

          const actions = document.createElement("div");
          actions.className = "custom-actions";

          const playBtn = document.createElement("button");
          playBtn.className = "icon-btn";
          playBtn.innerHTML = '<svg class="svg-icon"  viewBox="0 0 24 24"><polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none"/></svg>';
          playBtn.title = "Preview";
          playBtn.onclick = () => {
            vscode.postMessage({
              type: "previewSound",
              soundChoice: c.id,
              volume: Number(volumeSlider.value)
            });
          };

          const delBtn = document.createElement("button");
          delBtn.className = "icon-btn";
          delBtn.innerHTML = '<svg class="svg-icon"  viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
          delBtn.title = "Remove custom sound";
          delBtn.onclick = () => {
            vscode.postMessage({
              type: "deleteCustomSound",
              fileName: c.fileName
            });
          };

          actions.appendChild(playBtn);
          actions.appendChild(delBtn);
          item.appendChild(nameSpan);
          item.appendChild(actions);
          customList.appendChild(item);
        }
      }
    }

    enabledToggle.onchange = () => {
      vscode.postMessage({ type: "updateSetting", key: "enabled", value: enabledToggle.checked });
    };
    modeSelect.onchange = () => {
      vscode.postMessage({ type: "updateSetting", key: "mode", value: modeSelect.value });
    };
    desktopToggle.onchange = () => {
      vscode.postMessage({ type: "updateSetting", key: "desktopNotification", value: desktopToggle.checked });
    };
    previewCardToggle.onchange = () => {
      vscode.postMessage({ type: "updateSetting", key: "previewCard", value: previewCardToggle.checked });
    };
    previewDurationSlider.oninput = () => {
      previewDurationLabel.textContent = previewDurationSlider.value + "s";
    };
    previewDurationSlider.onchange = () => {
      vscode.postMessage({ type: "updateSetting", key: "previewDuration", value: Number(previewDurationSlider.value) });
    };
    toastToggle.onchange = () => {
      vscode.postMessage({ type: "updateSetting", key: "vscodeToast", value: toastToggle.checked });
    };
    soundToggle.onchange = () => {
      vscode.postMessage({ type: "updateSetting", key: "sound", value: soundToggle.checked });
    };
    soundSelect.onchange = () => {
      vscode.postMessage({ type: "updateSetting", key: "soundChoice", value: soundSelect.value });
      vscode.postMessage({
        type: "previewSound",
        soundChoice: soundSelect.value,
        volume: Number(volumeSlider.value)
      });
    };
    volumeSlider.oninput = () => {
      volumeLabel.textContent = volumeSlider.value + "%";
    };
    volumeSlider.onchange = () => {
      vscode.postMessage({ type: "updateSetting", key: "volume", value: Number(volumeSlider.value) });
      vscode.postMessage({
        type: "previewSound",
        soundChoice: soundSelect.value,
        volume: Number(volumeSlider.value)
      });
    };
    previewBtn.onclick = () => {
      vscode.postMessage({
        type: "previewSound",
        soundChoice: soundSelect.value,
        volume: Number(volumeSlider.value)
      });
    };
    importBtn.onclick = () => {
      vscode.postMessage({ type: "importSound" });
    };
    testBtn.onclick = () => {
      vscode.postMessage({ type: "testNotification" });
    };

    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (msg && msg.type === 'requestTheme') {
        themeGeneration = msg.generation;
        reportTheme();
      }
      if (msg && msg.type === "state") {
        state = msg.state;
        render();
      }
    });

    document.getElementById("checkBtn").onclick = () => vscode.postMessage({ type: "checkConfiguration" });
    vscode.postMessage({ type: "requestState" });

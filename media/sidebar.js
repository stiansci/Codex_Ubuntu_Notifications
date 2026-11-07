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
    const topBarToggle = document.getElementById("topBarToggle");
    const topBarFlashToggle = document.getElementById("topBarFlashToggle");
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
    const colorControls = new Map();
    const colorGroups = [
      ["Top bar", [["working", "Working icon"], ["finished", "Finished icon"]]],
      ["Bottom-left notification", [["background", "Card background"], ["foreground", "Project text"],
        ["inset", "Answer background"], ["insetForeground", "Answer text"],
        ["badgeBackground", "Codex badge"], ["badgeText", "Codex badge text"],
        ["button", "VS Code button"], ["buttonText", "Button text"],
        ["muted", "Secondary text"], ["border", "Card border"]]]
    ];
    function saveColor(key, value) {
      const colors = { ...state.colors };
      if (value) colors[key] = value;
      else delete colors[key];
      state.colors = colors;
      vscode.postMessage({ type: "updateSetting", key: "colors", value: colors });
    }
    function normalizeHex(value) {
      const hex = value.trim().replace(/^#/, "");
      if (/^[\da-f]{3}$/i.test(hex)) return "#" + [...hex.toLowerCase()].map(c => c + c).join("");
      return /^[\da-f]{6}$/i.test(hex) ? "#" + hex.toLowerCase() : null;
    }
    for (const [group, fields] of colorGroups) {
      const heading = document.createElement("div");
      heading.className = "color-group"; heading.textContent = group;
      document.getElementById("colorFields").appendChild(heading);
      for (const [key, label] of fields) {
        const row = document.createElement("div"); row.className = "color-row";
        const name = document.createElement("label"); name.textContent = label; name.htmlFor = "hex-" + key;
        const controls = document.createElement("div"); controls.className = "color-controls";
        const picker = document.createElement("input"); picker.type = "color"; picker.setAttribute("aria-label", label + " picker");
        const hex = document.createElement("input"); hex.type = "text"; hex.className = "color-hex";
        hex.id = "hex-" + key; hex.maxLength = 7; hex.placeholder = "Default"; hex.spellcheck = false;
        hex.setAttribute("aria-label", label + " hex value");
        const reset = document.createElement("button"); reset.className = "icon-btn";
        reset.textContent = "↺"; reset.title = "Reset " + label.toLowerCase(); reset.setAttribute("aria-label", reset.title);
        picker.oninput = () => { hex.value = picker.value; hex.setCustomValidity(""); };
        picker.onchange = () => saveColor(key, picker.value);
        hex.oninput = () => {
          const value = normalizeHex(hex.value);
          hex.setCustomValidity(hex.value.trim() && !value ? "Enter a hex color, for example #3b82f6." : "");
          if (value) picker.value = value;
        };
        hex.onchange = () => {
          const value = normalizeHex(hex.value);
          if (hex.value.trim() && !value) { hex.reportValidity(); return; }
          hex.value = value || "";
          saveColor(key, value);
        };
        hex.onkeydown = event => { if (event.key === "Enter") { event.preventDefault(); hex.onchange(); } };
        reset.onclick = () => { hex.value = ""; hex.setCustomValidity(""); saveColor(key, null); };
        controls.appendChild(picker); controls.appendChild(hex); controls.appendChild(reset);
        row.appendChild(name); row.appendChild(controls);
        document.getElementById("colorFields").appendChild(row);
        colorControls.set(key, { picker, hex });
      }
    }
    document.getElementById("resetColorsBtn").onclick = () => {
      state.colors = {};
      for (const { hex } of colorControls.values()) { hex.value = ""; hex.setCustomValidity(""); }
      vscode.postMessage({ type: "updateSetting", key: "colors", value: {} });
    };

    function render() {
      const setup = state.dependencySetup;
      document.getElementById("setupCard").hidden = !setup?.available || (!setup.installing && !setup.packages.length && !setup.audioChoiceRequired);
      const installButton = document.getElementById("installDependenciesBtn");
      installButton.disabled = !!setup?.installing;
      installButton.textContent = setup?.installing ? "Installing Dependencies..." : "Install Missing Dependencies";
      document.getElementById("setupDetails").textContent = setup?.installing ? "Follow the prompts in the setup terminal. Dependencies will be checked again when it finishes." :
        [setup?.packages.length ? "Packages: " + setup.packages.join(", ") + "." : "",
          setup?.audioChoiceRequired ? "Choose your existing audio system during setup." : ""].filter(Boolean).join(" ");
      for (const [key, { picker, hex }] of colorControls) {
        if (document.activeElement !== hex) hex.value = state.colors?.[key] || "";
        if (document.activeElement !== picker && document.activeElement !== hex) picker.value = state.resolvedColors?.[key] || "#000000";
      }
      enabledToggle.checked = !!state.enabled;
      topBarToggle.checked = state.topBarIndicator !== false;
      topBarFlashToggle.checked = state.topBarFlash === true;
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

    topBarToggle.onchange = () => vscode.postMessage({ type: "updateSetting", key: "topBarIndicator", value: topBarToggle.checked });
    topBarFlashToggle.onchange = () => vscode.postMessage({ type: "updateSetting", key: "topBarFlash", value: topBarFlashToggle.checked });
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
    document.getElementById("installDependenciesBtn").onclick = () => vscode.postMessage({ type: "installDependencies" });
    vscode.postMessage({ type: "requestState" });

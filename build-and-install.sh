#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
npm run package
npm run package:check
VSIX_NAME="$(node -p 'const p = require("./package.json"); p.name + "-" + p.version + ".vsix"')"
code --install-extension "$SCRIPT_DIR/dist/$VSIX_NAME" --force

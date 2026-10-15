#!/bin/zsh
set -eu
cd -- "${0:A:h}"
if [[ -d ClaudeSync.app ]]; then
  exec /usr/bin/open ClaudeSync.app
fi
exec pnpm dev

#!/bin/zsh
# Local launcher for this Mac. Cloud accounts and keys are not required.
cd -- "${0:A:h}"
third_space_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
if [[ -x "$third_space_node" ]]; then
  exec "$third_space_node" scripts/dev.mjs "$@"
else
  exec node scripts/dev.mjs "$@"
fi

#!/bin/sh
set -eu
# Hosts mount disks after the image is built. Allow Node to write the mount
# directory while retaining existing file ownership and dropping root for runtime.
install -d -o node -g node /data
exec gosu node "$@"

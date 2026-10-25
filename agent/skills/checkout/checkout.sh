#!/usr/bin/env bash
# Launcher for checkout.mjs. MIT; see the repository root LICENSE.
exec node "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/checkout.mjs" "$@"

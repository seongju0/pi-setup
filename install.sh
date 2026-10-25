#!/bin/sh
set -eu
main() {
case "${1-}" in
  --help|-h) printf '%s\n' 'Usage: sh install.sh [--help]' 'Obtain a persistent managed checkout and run interactive pi-setup.'; exit 0 ;;
  '') ;;
  *) printf '%s\n' 'Unknown argument. Use --help.' >&2; exit 1 ;;
esac
fail() { printf '%s\n' "$*" >&2; exit 1; }
# A pipe supplies this script, not approvals. Acquire the controlling terminal
# before any mkdir, clone, or installer invocation.
( : < /dev/tty ) 2>/dev/null || fail 'Installation requires an accessible /dev/tty; run in a terminal.'
exec < /dev/tty
[ "$(uname -s)" = Darwin ] || fail 'pi-setup currently supports macOS only.'
command -v node >/dev/null 2>&1 || fail 'Install Node >=26.0.0 using your existing installation owner first.'
node -e 'process.exit(Number(process.versions.node.split(".")[0])>=26?0:1)' || fail 'Node >=26.0.0 is required; no runtime was installed or upgraded.'
command -v pi >/dev/null 2>&1 || fail 'Pi must already be installed on PATH.'
command -v git >/dev/null 2>&1 || fail 'Git must already be installed on PATH.'
: "${HOME:?HOME must be set}"
managed=${PI_SETUP_HOME:-"$HOME/.local/share/pi-setup"}
checkout=$managed/checkout
repository=${PI_SETUP_REPOSITORY:-https://github.com/seongju0/pi-setup.git}
printf 'Persistent checkout: %s\nRepository: %s\n' "$checkout" "$repository"
mode=install
if [ -e "$checkout" ] || [ -L "$checkout" ]; then
  printf 'Update this existing checkout before reviewing setup? [y/N] '
  IFS= read -r answer || answer=
  case "$answer" in y|Y|yes|YES) mode=update ;; esac
else
  printf 'Obtain this checkout? Repository code will run. [y/N] '
  IFS= read -r answer || answer=
  case "$answer" in
    y|Y|yes|YES) mkdir -p "$managed"; git clone -- "$repository" "$checkout" ;;
    *) printf '%s\n' 'Cancelled; nothing changed.'; exit 0 ;;
  esac
fi
exec node "$checkout/scripts/client.mjs" "$mode"
}
main "$@"

# pi-setup: after a reboot, reopen this Herdr terminal's last Pi session. Source as the LAST line of ~/.zshrc.
() {
  emulate -L zsh
  [[ -o interactive && -n $TTY && $HC_TERMINAL_ID =~ '^[A-Za-z0-9_-]{1,128}$' ]] || return 0
  local -a records=($HOME/.local/state/pi-setup/herdr-sessions/*/$HC_TERMINAL_ID.json(N))
  (( $#records && $+commands[node] )) || return 0
  local out; out=$(node $1/restore.mjs $$ 2>$TTY) || return 0
  [[ -n $out ]] || return 0
  local -a launch=("${(@0)out}")
  builtin cd -q -- $launch[1] || return 0
  PI_CODING_AGENT_DIR=$launch[2] "${(@)launch[3,-1]}" <$TTY >$TTY 2>$TTY
  return 0
} ${${(%):-%x}:A:h}

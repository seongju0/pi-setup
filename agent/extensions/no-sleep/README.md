# No-sleep

Requests **local macOS idle-system sleep inhibition** while Pi is open. Enabled
with **session scope by default**, including time when Pi is idle. Choose agent
scope to protect active runs only, or disable it when you do not need protection.
The display may idle-sleep by default. Other platforms are unsupported and do not
launch a helper.

## Commands

| Command | Effect |
| --- | --- |
| `/no-sleep` or `/no-sleep status` | Show enabled policy, scope, display preference, and helper state. Does not toggle. |
| `/no-sleep on` | Enable the selected scope immediately; explicitly retry a failed helper. No duplicate if already running. |
| `/no-sleep off` | Disable and terminate the owned helper; keep scope. |
| `/no-sleep session` | Select session scope without changing enabled/disabled; if enabled, acquire even while idle. |
| `/no-sleep agent` | Select agent scope without changing enabled/disabled; if enabled, acquire only while busy. |
| `/no-sleep help` | Show syntax and the local-host/idle-sleep limitation. |

Arguments accept one exact lowercase word, with surrounding whitespace allowed.
Other input warns without changing policy. Agent scope remains protected across
low-level run continuations, retries, compaction, and approval/dialog waits;
release happens at `agent_settled`, including aborted runs, not `agent_end`.

**Commands are in-memory only.** `/reload`, `/new`, `/resume`, and `/fork` stop the
old helper and create a replacement runtime using environment defaults. In
particular, manually turning off a default-enabled session does not survive
reload. No settings, session entries, or preference files are written.

## Environment

Set these before launching Pi:

| Variable | Absent or empty | Accepted nonempty values |
| --- | --- | --- |
| `PI_NO_SLEEP` | Enabled | `1`: enabled; `0`: disabled |
| `PI_NO_SLEEP_SCOPE` | Session | `session`, `agent` |
| `PI_NO_SLEEP_DISPLAY` | Display may idle-sleep | `0`: display may idle-sleep; `1`: request idle-display sleep inhibition |

All other nonempty values, including other case or extra whitespace, are invalid.
Invalid startup configuration warns and acquires nothing. Correct the environment
and reload; commands cannot bypass invalid configuration. Configuration is read
at session startup. Display preference is also re-read on each new acquisition;
an already-running helper is not reconfigured by environment mutations.

## Helper state and failures

Status separates requested policy from helper state: `running`, `waiting for
agent`, `off`, `failed`, or `unsupported platform`. Invalid configuration is
reported as off with correction guidance. Running status includes the helper PID
and means **OS assertion not independently verified**—process existence alone is
not proof of an active assertion or that the entire machine will stay awake.

Normal automatic acquisition/release is quiet. Commands use Pi notifications in
TUI/RPC; without UI, command feedback and failures go to stderr with a
`[no-sleep]` prefix, never non-protocol stdout. Helper failure emits one error and
suppresses automatic retries. `/no-sleep on` explicitly tries again. The extension
does not inspect prompts or history for diagnostics.

The helper is `/usr/bin/caffeinate -i -s [-d] -w <Pi PID>`, spawned without a shell
and with ignored stdio. `-d` is opt-in. Pi shutdown releases only its own helper
with SIGTERM; native `-w` ties its lifetime to the Pi process. No daemon, process
exit listener, timer, watchdog, automatic retry, or power-setting change is used.

## Host placement, Herdr, and limits

A local macOS Pi inside Herdr runs on the same execution host; no special Herdr
integration, pane focus, visible tab, or terminal output is needed for the native
mechanism. This is a host-placement statement, not acceptance evidence for this
replacement's full runtime lifecycle.

- **Idle sleep:** `-i` requests prevention of automatic system sleep due to
  inactivity. It has no AC-only restriction in the native manual.
- **System-sleep flag:** the manual describes `-s` as AC-only, while the SDK
  deprecates its assertion in favor of idle inhibition. Do not rely on it for
  stronger protection or battery claims.
- **Display:** default policy allows display idle sleep. `-d` requests prevention
  of idle display sleep; it does not unlock or deliberately wake a display.
- **Not guaranteed:** lid-close, explicit/forced sleep, low-battery sleep, thermal
  protection, shutdown, or closed-lid operation. No security settings are changed.
  Disk idle inhibition is not requested.
- **Remote/guest execution:** Pi over SSH affects the remote execution Mac, not
  the Mac showing the Herdr client. Linux containers/guests have no supported
  bridge to inhibit the physical macOS host. A macOS VM assertion is not proof of
  a host assertion.

For read-only native diagnosis on macOS:

```sh
pmset -g assertions
```

Match the helper PID from `/no-sleep status` to its owned idle-system assertion;
do not attribute assertions owned by other processes to this extension. A record
for `PreventSystemSleep` alone is not proof of effective system policy, especially
on battery. Do not disable other processes' assertions to test this extension.

Automated tests use Pi's actual extension loader and documented event/command
contracts with mocked native spawning, not actual OS assertions or the complete
Pi session runtime.

On 2026-10-25, an authorized isolated real Pi RPC process inside a local macOS
Herdr environment loaded only this replacement. Its own idle-system assertion
appeared at startup, disappeared on `off`, returned with a new helper on `on`,
and disappeared on orderly Pi exit. Verification matched the helper's PID and
parent process, not merely the machine-wide summary; other assertions were left
untouched. Temporary configuration and both owned helpers were cleaned up.

This bounded check did not deliberately put the machine to sleep. Active-agent,
abort, reload, abrupt-process-death, display opt-in, overnight, and hardware-specific
behavior remain unverified by native acceptance. No existing Pi session was
reloaded or activated for this test.

## License

[MIT](../../../LICENSE).

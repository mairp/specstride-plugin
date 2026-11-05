#!/bin/sh
# host-limit-event — thin host hook shim of the Specstride plugin (F113-FR-020, F113-FR-024).
# It writes the event THROUGH THE CLI as an inbox request of type `host-event` (`inbox:host-events:<launchId>`), with its kind and redacted data. It writes no inbox file itself and injects NO context: it prints nothing at all.
set -u

# F113-FR-027 (T018) — SILENT inside a child of a run. the harness adapter
# switches the customizations off; this is the second guard. The names are the event
# context of the run, annex C §C.10, as the alias table of annex X §X.8 hands it to every
# process the runtime starts.
if [ -n "${SPECSTRIDE_EVENTS:-}" ] || [ -n "${SPECSTRIDE_RUN_ID:-}" ] || [ -n "${SPECSTRIDE_TASK:-}" ] || [ -n "${SPECSTRIDE_TRACE_ID:-}" ]; then
  exit 0
fi

# The host hands the event on standard input. Outside text is DATA: it is matched,
# never expanded into a command (the constitution, principle III; threats T-09, T-12).
event=""
if [ ! -t 0 ]; then
  event="$(cat 2>/dev/null)" || event=""
fi
if [ -z "$event" ]; then exit 0; fi

# The kind, and then the ALLOW-LISTED fields with safe values only: redaction keeps
# everything else inside the host (F113-FR-024).
kind="$(printf '%s\n' "$event" | sed -n 's/.*"kind"[ ]*:[ ]*"\{0,1\}\([A-Za-z0-9._-]*\)"\{0,1\}.*/\1/p' | sed -n '1p')"
if [ -z "$kind" ]; then exit 0; fi
data=""
for field in limit resetsAt retryAfter scope; do
  value="$(printf '%s\n' "$event" | sed -n "s/.*\"$field\"[ ]*:[ ]*\"\{0,1\}\([A-Za-z0-9:._+-]*\)\"\{0,1\}.*/\\1/p" | sed -n '1p')"
  if [ -n "$value" ]; then
    if [ -n "$data" ]; then data="$data,"; fi
    data="$data\"$field\":\"$value\""
  fi
done

# The CLI is reached through the plugin's own shim (T007), which resolves the executable
# and checks the protocol. Where it is not there, the hook is silent: no run depends on a
# host hook (F113-FR-020).
if [ -z "${CLAUDE_PLUGIN_ROOT:-}" ]; then exit 0; fi
cli="$CLAUDE_PLUGIN_ROOT/bin/specstride.mjs"
if [ ! -x "$cli" ]; then exit 0; fi

# The CLI writes the inbox on behalf of the host. Nothing is printed: no context is
# injected, and a failure of the call costs nothing of the run.
"$cli" "host" "event" --kind "$kind" --data "{$data}" >/dev/null 2>&1 || :
exit 0

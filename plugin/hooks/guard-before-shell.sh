#!/bin/sh
# guard-before-shell — thin host hook shim of the Specstride plugin (F113-FR-020, F113-FR-023).
# Before a shell command that launches a run it has the CLI evaluate the launch checks WITHOUT launching, and denies with one line where a launch check would refuse. It is defence in depth: the CLI refuses the same checks itself.
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

# Only a shell command that launches a run is guarded.
case "$event" in
  *'specstride launch'*|*'specstride run'*|*'specstride pipeline run'*) ;;
  *) exit 0 ;;
esac

# The CLI is reached through the plugin's own shim (T007), which resolves the executable
# and checks the protocol. Where it is not there, the hook is silent: no run depends on a
# host hook (F113-FR-020).
if [ -z "${CLAUDE_PLUGIN_ROOT:-}" ]; then exit 0; fi
cli="$CLAUDE_PLUGIN_ROOT/bin/specstride.mjs"
if [ ! -x "$cli" ]; then exit 0; fi

# No argument of the proposed command and no comment is passed: outside text is data,
# never argv, and the comment MUST NOT override the guardrail (F113-FR-023).
out="$("$cli" "launch" "--mode" "dry-run" 2>&1)"
code=$?
deny="$(printf '%s\n' "$out" | sed -n 's/^\(\[SPECSTRIDE-REFUSE\].*\)$/\1/p' | sed -n '1p')"
if [ -n "$deny" ]; then
  # ONE line, the CLI's own.
  printf '%s\n' "$deny" >&2
  exit 2
fi
if [ "$code" = 4 ]; then
  printf '%s\n' '[SPECSTRIDE-REFUSE] action=launch reason=launch-check-would-refuse' >&2
  exit 2
fi
exit 0

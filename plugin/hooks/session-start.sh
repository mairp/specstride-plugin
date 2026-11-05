#!/bin/sh
# session-start — thin host hook shim of the Specstride plugin (F113-FR-020, F113-FR-021).
# It prints the precomputed line of `workspace:current:status-line` and nothing else: no interpreter is started, no command of the product is run, and nothing is printed when no run exists.
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

# The line is found through `workspace:current:status-line` of annex B §B.5, whose place
# depends on the real path of the workspace only, so a shell shim finds it without
# starting the product (F100-FR-229).
root="${SPECSTRIDE_STATE_DIR:-}"
if [ -z "$root" ]; then exit 0; fi
line="$root/status.line"
if [ ! -f "$line" ]; then exit 0; fi
text="$(cat "$line" 2>/dev/null)" || exit 0
if [ -z "$text" ]; then exit 0; fi

# `validUntil=` is a key of the status line (row 248 of annex X §X.6). Past it,
# the state is unknown (F113-FR-021); `none` is a run that
# rests and has no lease (annex F §F.5).
valid_until="$(printf '%s\n' "$text" | tr ' ' '\n' | sed -n 's/^validUntil=//p' | sed -n '1p')"
stale=0
if [ -n "$valid_until" ] && [ "$valid_until" != "none" ]; then
  case "$valid_until" in
    *[!0-9]*)
      NOW="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
      FIRST="$(printf '%s\n%s\n' "$valid_until" "$NOW" | LC_ALL=C sort | sed -n '1p')"
      if [ "$FIRST" = "$valid_until" ] && [ "$valid_until" != "$NOW" ]; then stale=1; fi
      ;;
    *)
      NOW_EPOCH="$(date -u '+%s')"
      if [ "$valid_until" -lt "$NOW_EPOCH" ]; then stale=1; fi
      ;;
  esac
fi
if [ "$stale" = 1 ]; then
  text='[SPECSTRIDE-STATE] st=unknown reason=stale'
fi

# The two keys the shims compare: `st` and
# `ph` (row 248 of annex X §X.6).
state="$(printf '%s\n' "$text" | tr ' ' '\n' | sed -n 's/^st=//p' | sed -n '1p')"
phase="$(printf '%s\n' "$text" | tr ' ' '\n' | sed -n 's/^ph=//p' | sed -n '1p')"
signature="st=$state ph=$phase"

# The marker of the last injected state (F113-FR-021). It is state of the HOST, in the
# host's plugin data directory: no run and no command of the product reads it, annex B
# §B.5 holds no logical name for it, and when it is missing or damaged ONE more line is
# printed and nothing else changes.
marker_dir="${CLAUDE_PLUGIN_DATA_DIR:-${XDG_STATE_HOME:-${HOME:-}/.local/state}/specstride/host-claude-code}"
marker="$marker_dir/last-injected-state"
last=""
if [ -f "$marker" ]; then
  last="$(cat "$marker" 2>/dev/null)" || last=""
fi
case "$last" in
  st=*) ;;
  *) last="" ;;
esac

# F113-FR-021 — after a COMPACTION the line is printed again only if the state
# changed since the last injection. A fresh start always prints.
compaction=0
case "$event" in
  *'"source"'*compact*) compaction=1 ;;
esac
if [ "$compaction" = 1 ] && [ "$signature" = "$last" ]; then
  exit 0
fi

# ONE line, and it is the line the runtime precomputed.
printf '%s\n' "$text"
# Best effort: a marker that cannot be written costs one more line and nothing else
# (F113-FR-021; the constitution, principle V).
mkdir -p "$marker_dir" 2>/dev/null || :
printf '%s\n' "$signature" > "$marker" 2>/dev/null || :
exit 0

#!/usr/bin/env bash
# T001 — probe of the keychain existence query (F110-FR-031).
#
# It creates a test entry, queries its existence with the output discarded,
# and removes it. It never reads a real credential and prints no value: the
# only thing the existence query yields here is its exit status.
#
#   Linux : libsecret (`secret-tool`) against the Secret Service of a
#           throw-away gnome-keyring in its own D-Bus session.
#   macOS : `security find-generic-password -s SERVICE -a ACCOUNT` with the
#           output discarded (no `-w`, so no value is ever written out).
#           NOT RUN HERE — no macOS runner (see research.md).
#
# Usage: packages/config/tools/keychain-probe.sh
set -u

SERVICE="specstride-probe-t001"
ACCOUNT="probe"
PROBE_VALUE="probe-value-never-printed"

probe_linux() {
  local store="$1"            # XDG_DATA_HOME of the throw-away keyring
  local keyring="$store/keyrings/login.keyring"

  # The daemon that answers the Secret Service on this D-Bus session.
  echo -n "probe-keyring-password" | gnome-keyring-daemon --unlock --daemonize --components=secrets >/dev/null 2>&1
  sleep 1

  echo "step 0: before the entry exists"
  secret-tool lookup service "$SERVICE" account "$ACCOUNT" >/dev/null 2>&1
  echo "  lookup (output discarded) exit=$?   # 1 = absent"
  echo "  keyring file present=$([ -f "$keyring" ] && echo yes || echo no)"
  echo "  keyring sha256=$(sha256sum "$keyring" 2>/dev/null | cut -c1-32)"
  echo "  keyring bytes=$(wc -c <"$keyring" 2>/dev/null)"

  echo "step 1: create the test entry"
  printf '%s' "$PROBE_VALUE" | secret-tool store --label="specstride T001 probe" service "$SERVICE" account "$ACCOUNT" >/dev/null 2>&1
  echo "  store exit=$?"

  echo "step 2: query its existence, output discarded"
  secret-tool lookup service "$SERVICE" account "$ACCOUNT" >/tmp/t001-lookup.out 2>/tmp/t001-lookup.err
  local rc=$?
  echo "  lookup exit=$rc   # 0 = present"
  echo "  bytes the query wrote to our stdout capture: $(wc -c </tmp/t001-lookup.out)"
  echo "  the captured bytes hold the probe value: $(grep -qF "$PROBE_VALUE" /tmp/t001-lookup.out && echo YES || echo no)"
  echo "  (with >/dev/null, as the port runs it, nothing is written at all)"

  echo "step 3: independent read path — the keyring file on disk"
  echo "  keyring file present=$([ -f "$keyring" ] && echo yes || echo no)"
  echo "  keyring sha256=$(sha256sum "$keyring" 2>/dev/null | cut -c1-32)"
  echo "  keyring bytes=$(wc -c <"$keyring" 2>/dev/null)"
  echo "  the service name is in the stored keyring: $(strings "$keyring" 2>/dev/null | grep -qF "$SERVICE" && echo YES || echo no)"
  echo "  the probe VALUE is in cleartext in the keyring: $(strings "$keyring" 2>/dev/null | grep -qF "$PROBE_VALUE" && echo YES || echo no)"

  echo "step 4: remove the test entry"
  secret-tool clear service "$SERVICE" account "$ACCOUNT" >/dev/null 2>&1
  echo "  clear exit=$?"

  echo "step 5: after the removal"
  secret-tool lookup service "$SERVICE" account "$ACCOUNT" >/dev/null 2>&1
  echo "  lookup (output discarded) exit=$?   # 1 = absent again"
  echo "  keyring sha256=$(sha256sum "$keyring" 2>/dev/null | cut -c1-32)"
  echo "  keyring bytes=$(wc -c <"$keyring" 2>/dev/null)"
  rm -f /tmp/t001-lookup.out /tmp/t001-lookup.err
}

case "$(uname -s)" in
  Linux)
    command -v secret-tool >/dev/null || { echo "secret-tool absent: unprobed"; exit 2; }
    command -v gnome-keyring-daemon >/dev/null || { echo "gnome-keyring-daemon absent: unprobed"; exit 2; }
    STORE="$(mktemp -d)"
    echo "platform: Linux ($(uname -r)); tool: $(command -v secret-tool); keyring store: $STORE"
    export XDG_DATA_HOME="$STORE"
    dbus-run-session -- bash -c "$(declare -f probe_linux); SERVICE='$SERVICE' ACCOUNT='$ACCOUNT' PROBE_VALUE='$PROBE_VALUE' probe_linux '$STORE'"
    rc=$?
    rm -rf "$STORE"
    exit $rc
    ;;
  Darwin)
    echo "macOS: not run here (no runner). See research.md: unverified."
    exit 3
    ;;
esac

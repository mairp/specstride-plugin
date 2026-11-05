#!/usr/bin/env bash
# The live probe of the critic of form (b) (T050). PAID: this script calls
# the model once, with an API key. Run it only as an authorized person, out
# of band (owner ruling of 2026-09-30); this feature never runs it and never
# fakes its result.
#
# It makes ONE direct call of form (b): an `openai-chat` POST to the chat
# path under the base address, the key as the bearer credential, one user
# message that holds the prompt, the model `gpt-5`. The reply, the usage the
# endpoint reports and the cost the descriptor's dated prices give are the
# log (F131-FR-038).
#
# Usage: AUTHORIZED=yes OPENAI_API_KEY=sk-... bash procedure.sh <out-dir>
set -euo pipefail
[ "${AUTHORIZED:-}" = "yes" ] || { echo "refusing: set AUTHORIZED=yes" >&2; exit 126; }
[ -n "${OPENAI_API_KEY:-}" ] || { echo "refusing: set OPENAI_API_KEY" >&2; exit 126; }
out="${1:?output directory}"
mkdir -p "$out"
base="${OPENAI_BASE_URL:-https://api.openai.com/v1}"
model="${SPECSTRIDE_CODEX_CRITIC_MODEL:-gpt-5}"
version="$(codex --version)"; printf '%s\n' "$version" > "$out/harness-version.txt"

prompt="critic-call nonce: probe-t050
Answer with the single word ACK."

body=$(printf '{"model":"%s","stream":false,"messages":[{"role":"user","content":"%s"}]}' \
  "$model" "$prompt")
set +e
http=$(curl -sS -o "$out/reply.json" -w '%{http_code}' \
  -H "authorization: Bearer ${OPENAI_API_KEY}" \
  -H 'content-type: application/json' \
  -d "$body" "${base%/}/chat/completions")
rc=$?
set -e
printf '%s\n' "$rc" > "$out/curl-exit-code.txt"
printf '%s\n' "$http" > "$out/http-status.txt"
printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$out/date.txt"
printf '%s\n' "$base" "$model" > "$out/request-facts.txt"
echo "record reply.json, http-status.txt, curl-exit-code.txt, request-facts.txt, harness-version.txt and date.txt into probe.json (logFiles), and the usage and the priced cost into log.json and usage.json"

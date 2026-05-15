#!/usr/bin/env bash
set -euo pipefail

: "${IHATEPDF_API_KEY:?Set IHATEPDF_API_KEY to an API key from /api/api-keys}"
: "${1:?Usage: IHATEPDF_API_KEY=ihp_... ./examples/cli/compress-pdf.sh input.pdf}"

API_BASE_URL="${IHATEPDF_API_BASE_URL:-http://localhost:4000/api}"
INPUT_FILE="$1"

UPLOAD_RESPONSE="$(
  curl -sS -X POST "$API_BASE_URL/v1/files" \
    -H "Authorization: Bearer $IHATEPDF_API_KEY" \
    -F "file=@$INPUT_FILE"
)"

FILE_ID="$(printf '%s' "$UPLOAD_RESPONSE" | node -e 'let data=""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => console.log(JSON.parse(data).file.id));')"

TASK_RESPONSE="$(
  curl -sS -X POST "$API_BASE_URL/v1/tasks/compress" \
    -H "Authorization: Bearer $IHATEPDF_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"fileId\":\"$FILE_ID\",\"outputName\":\"compressed.pdf\"}"
)"

TASK_ID="$(printf '%s' "$TASK_RESPONSE" | node -e 'let data=""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => console.log(JSON.parse(data).task.id));')"
echo "Queued task: $TASK_ID"

while true; do
  STATUS_RESPONSE="$(
    curl -sS "$API_BASE_URL/v1/tasks/$TASK_ID/status" \
      -H "Authorization: Bearer $IHATEPDF_API_KEY"
  )"
  STATUS="$(printf '%s' "$STATUS_RESPONSE" | node -e 'let data=""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => console.log(JSON.parse(data).task.status));')"
  PERCENT="$(printf '%s' "$STATUS_RESPONSE" | node -e 'let data=""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => console.log(JSON.parse(data).task.progress.percent));')"
  echo "$STATUS $PERCENT%"

  if [[ "$STATUS" == "completed" ]]; then
    printf '%s' "$STATUS_RESPONSE" | node -e 'let data=""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => console.log(JSON.parse(data).task.result.downloadUrl));'
    break
  fi

  if [[ "$STATUS" == "failed" ]]; then
    printf '%s' "$STATUS_RESPONSE" | node -e 'let data=""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => { const task = JSON.parse(data).task; console.error(task.error?.message ?? "Task failed"); process.exit(1); });'
  fi

  sleep 1
done

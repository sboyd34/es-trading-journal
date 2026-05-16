#!/usr/bin/env bash
# Auto-run `npx tsc --noEmit` after edits to *.ts/*.tsx and inject errors
# back to the model as informational context (non-blocking).
set -u

F=$(jq -r '.tool_input.file_path // .tool_response.filePath // ""')

case "$F" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac

cd /Users/shawndeeboyd/es-trading-journal || exit 0

if ! OUT=$(npx tsc --noEmit 2>&1); then
  jq -n --arg out "$OUT" --arg file "$F" '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: ("⚠️ TypeScript errors after editing " + $file + ":\n" + $out)
    }
  }'
fi

exit 0

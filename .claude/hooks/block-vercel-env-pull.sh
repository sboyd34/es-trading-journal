#!/usr/bin/env bash
# Block `vercel env pull` to prevent overwriting .env.local with empty values
# for sensitive Vercel env vars (has happened — see project memory).
set -u

CMD=$(jq -r '.tool_input.command // ""')

if echo "$CMD" | grep -qE '(^|[[:space:]])vercel[[:space:]]+env[[:space:]]+pull([[:space:]]|$)'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "BLOCKED: `vercel env pull` has wiped working .env.local files before — sensitive Vercel env vars come back empty and silently overwrite real values. Back up .env.local first, or add new env vars manually by appending lines. If you really need to pull, run it yourself in a terminal outside Claude Code."
    }
  }'
fi

exit 0

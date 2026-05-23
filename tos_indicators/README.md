# TOS Indicators

Backup and reference copies of ThinkOrSwim ThinkScript indicators.

These files use `.ts` extension by convention — they are **ThinkScript**, not TypeScript. They are excluded from `tsconfig.json` and are not compiled by Next.js or run by Node.

TOS reads its scripts from the user's study editor, not the filesystem. The files here exist only as version-controlled backups and as a source of truth for future agent sessions that need to modify the indicators.

## Files

- `firelines.ts` — FireLines indicator (daily + weekly pivot projections, confluence detection with per-level labels)
- `liquidity_map.ts` — Liquidity Map indicator (ICT-style buy-side / sell-side liquidity tracking)

## Updating

When you modify an indicator in TOS:

1. In TOS: Studies → Edit Studies → select the indicator → select all script text → copy
2. In repo: paste-replace the contents of the corresponding `.ts` file
3. Commit with message format: `TOS: <indicator>: <what changed>`

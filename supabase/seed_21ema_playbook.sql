-- supabase/seed_21ema_playbook.sql
-- Seeds the 21-EMA Bounce playbook entry (priority 4, between AVWAP Bounce
-- and FVG Bounce). Mirrors the PLAYBOOK_SETUPS entry in lib/trading-system.ts.
-- Run in the Supabase dashboard SQL editor.
--
-- playbook_setups has no unique constraint on (user_id, name), so ON CONFLICT
-- cannot dedupe here — the NOT EXISTS guard is what makes a re-run a no-op.
INSERT INTO playbook_setups (user_id, name, description, entry_criteria, exit_criteria, tags)
SELECT
  u.id,
  '21-EMA Bounce',
  'Trend pullback into the 21 EMA — the same line that sets the 1H bias. The most bias-aligned continuation entry in the system, and never a standalone signal.',
  '1. 1H bias clear — price above a rising 21 EMA for longs, below a falling one for shorts.
2. Pullback into the 21 EMA on the 15m (touch or slight wick through — not a close beyond).
3. 5m confirmation off the EMA: rejection wick, hold candle, or reclaim close.
4. Confluence required (VWAP/AVWAP, prior swing, FireLines level, VAH/VAL) — never the EMA alone.
5. Room to target: prior swing extreme in the trade direction.
If the 15m closes decisively beyond the EMA the setup is dead — that is a bias change, not a bounce. If the EMA is flat, there is no trend to pull back into: no trade.',
  'Target the prior swing extreme in the trade direction, or the next major level (FireLines, VAH/VAL, PDH/PDL). Scale at 1R, trail the runner with 5m structure. Exit if a 5m closes back through the EMA against the trade.',
  ARRAY['ema', 'bounce', 'trend-continuation']
FROM auth.users u
WHERE u.email = 'mr.shawnboyd@gmail.com'
  AND NOT EXISTS (
    SELECT 1 FROM playbook_setups p
    WHERE p.user_id = u.id AND p.name = '21-EMA Bounce'
  );

-- Seed FireLines Level playbook entry
-- Run in Supabase dashboard SQL editor
INSERT INTO playbook_setups (user_id, name, description, entry_criteria, exit_criteria, tags)
VALUES (
  (SELECT id FROM auth.users WHERE email = 'mr.shawnboyd@gmail.com'),
  'FireLines Level',
  'FireLines is a ThinkScript indicator that projects key intraday price levels from the prior session''s range. On bullish structure days it generates B-FL1, B-FL2, and B-FL3 above the Initial Print (IP); on bearish days it generates S-FL1, S-FL2, and S-FL3 below. These levels act as high-probability decision zones — price tends to stall, reverse, or accelerate at each level on first touch. Confluent FireLines levels (daily and weekly stacking within a few points) are the highest-priority trade locations.',
  '1. 1H bias aligned — above 21 EMA for longs (B-FL levels), below for shorts (S-FL levels)
2. Price reaches a FireLines level (B-FL1, B-FL2, B-FL3 or S-FL1, S-FL2, S-FL3)
3. Confirmation candle at the level: rejection wick, engulfing, or inside bar breakout on 5m
4. Inside approved time window — Opening Drive or Closing Drive preferred
5. Emotionally flat — no FOMO, no revenge, no chasing',
  'Target: Next FireLines level in trade direction (B-FL1 → B-FL2 → B-FL3)
Stop: 2-3 points beyond the entry FireLines level
Trail stop to breakeven once first target is tagged
Close full position at the final level (B-FL3 / S-FL3) or at the day''s profit target
Exit immediately if price closes back through the entry level on the 5m',
  ARRAY['firelines', 'levels', 'price-action']
)
ON CONFLICT DO NOTHING;

-- Add F grade for off-system trades.
-- F means: trade was not one of the 5 system setups (off-playbook discipline lapse).
-- F is distinct from C (which is a rule violation within the system).

ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_grade_check;

ALTER TABLE trades
  ADD CONSTRAINT trades_grade_check
  CHECK (grade IN ('A', 'B', 'C', 'F'));

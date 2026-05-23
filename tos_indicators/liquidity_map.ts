# ═══════════════════════════════════════════════════════════════
#  Liquidity Map — ICT-Style Liquidity Indicator
#  Layers alongside FireLines on the same chart as an independent
#  indicator. Marks buy-side liquidity (above swing highs) and
#  sell-side liquidity (below swing lows) from two sources:
#   • Algorithmic intraday pivots (rolling 3 per direction)
#   • Session levels (PDH, PDL, ONH, ONL, PWH, PWL)
#
#  Three lifecycle states per level: LIVE / SWEPT / ACCEPTED.
#  Lineless visual: bubbles at right edge + sweep arrows on the
#  exact bar. ATR-based thresholds scale across any ticker.
#  Runs 24/7 by default (sessionGating = no) for night trading.
#
#  pivotLookback tuning suggestions:
#    1m chart   → 10–15  (filter noise)
#    5m chart   → 5–7    (default range)
#    15m chart  → 3–5    (otherwise pivots are too rare)
#    1H chart   → 3      (real swings need less padding)
# ═══════════════════════════════════════════════════════════════

declare upper;

# ── Detection parameters ─────────────────────────────────────────
input pivotLookback           = 5;
input pivotsToTrack           = 3;
input equalATRMult            = 0.15;
input approachATRMult         = 0.25;
input atrLength               = 14;
input atrAggregation          = AggregationPeriod.DAY;

# ── Source toggles ───────────────────────────────────────────────
input showAlgorithmicPivots   = yes;
input showSessionLevels       = yes;
input showPDH                 = yes;
input showPDL                 = yes;
input showONH                 = yes;
input showONL                 = yes;
input showPWH                 = yes;
input showPWL                 = yes;

# ── Feature toggles ──────────────────────────────────────────────
input showApproachAlerts      = yes;
input showSweepArrows         = yes;
input showEqualClusterLabels  = yes;
input showCornerSummary       = yes;

# ── Session gating (default OFF for night trading) ───────────────
input sessionGating           = no;
input sessionStartHHMM        = 0830;
input sessionEndHHMM          = 1500;

# ── ATR (ticker-agnostic distance threshold) ─────────────────────
def atr      = WildersAverage(TrueRange(high(period = atrAggregation),
                                         close(period = atrAggregation),
                                         low(period = atrAggregation)),
                              atrLength);
def equalThr    = equalATRMult    * atr;
def approachThr = approachATRMult * atr;

# ── Session window ───────────────────────────────────────────────
def inSession = if sessionGating
                then SecondsFromTime(sessionStartHHMM) >= 0 and SecondsTillTime(sessionEndHHMM) >= 0
                else yes;

def lastBar = BarNumber() == HighestAll(BarNumber());

# ════════════════════════════════════════════════════════════════
#  Sections below are filled in by subsequent implementation tasks:
#   • Task 4: Session levels (LIVE bubbles)
#   • Task 5: Session level lifecycle (SWEPT/ACCEPTED + arrows)
#   • Task 6: Algorithmic pivots (LIVE bubbles)
#   • Task 7: Algorithmic pivot lifecycle
#   • Task 8: Equal-highs/lows clustering
#   • Task 9: Corner labels
#   • Task 10: Alerts
# ════════════════════════════════════════════════════════════════

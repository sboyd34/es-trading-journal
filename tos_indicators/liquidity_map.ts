# ═══════════════════════════════════════════════════════════════
#  Liquidity Map — ICT-Style Liquidity Indicator
#  Layers alongside FireLines on the same chart as an independent
#  indicator. Marks buy-side liquidity (above swing highs) and
#  sell-side liquidity (below swing lows) from two sources:
#   • Algorithmic intraday pivots (rolling 3 per direction)
#   • Session levels (PDH, PDL, ONH, ONL, PWH, PWL)
#
#  Three lifecycle states per level: LIVE / SWEPT / ACCEPTED.
#  Lineless visual: anchor dots + right-edge bubbles + sweep
#  arrows on the exact bar. ATR-based thresholds scale across any
#  ticker. Runs 24/7 by default (sessionGating = no) for night
#  trading.
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
#  SESSION LEVELS
#  Six static levels computed from prior-period OHLC. Each renders
#  as an anchor dot + right-edge bubble at its price when its toggle
#  is on. Anchor dots force TOS to extend the y-axis scale so the
#  bubbles remain visible even at off-current-range prices.
# ════════════════════════════════════════════════════════════════

def PDH = high(period = AggregationPeriod.DAY)[1];
def PDL = low(period  = AggregationPeriod.DAY)[1];
def PWH = high(period = AggregationPeriod.WEEK)[1];
def PWL = low(period  = AggregationPeriod.WEEK)[1];

def isOvernightBar = SecondsFromTime(0830) < 0 and SecondsFromTime(1700) >= 0;
def isNewSession   = SecondsFromTime(0830) >= 0 and SecondsFromTime(0830)[1] < 0;

def ONH = if isNewSession then Highest(high, 1)
          else if isOvernightBar
               then if IsNaN(ONH[1]) then high else Max(ONH[1], high)
          else ONH[1];

def ONL = if isNewSession then Lowest(low, 1)
          else if isOvernightBar
               then if IsNaN(ONL[1]) then low else Min(ONL[1], low)
          else ONL[1];

# Session-level LIVE state (always LIVE for now — Task 5 adds lifecycle).
def PDH_live = yes;
def PDL_live = yes;
def ONH_live = yes;
def ONL_live = yes;
def PWH_live = yes;
def PWL_live = yes;

# ── Anchor dots (single point at last bar; forces y-axis to include level) ─
plot pPDH = if showSessionLevels and showPDH and PDH_live and lastBar then PDH else Double.NaN;
pPDH.SetPaintingStrategy(PaintingStrategy.POINTS);
pPDH.SetDefaultColor(CreateColor(100, 180, 255));
pPDH.SetLineWeight(3);

plot pPDL = if showSessionLevels and showPDL and PDL_live and lastBar then PDL else Double.NaN;
pPDL.SetPaintingStrategy(PaintingStrategy.POINTS);
pPDL.SetDefaultColor(Color.PINK);
pPDL.SetLineWeight(3);

plot pONH = if showSessionLevels and showONH and ONH_live and lastBar then ONH else Double.NaN;
pONH.SetPaintingStrategy(PaintingStrategy.POINTS);
pONH.SetDefaultColor(CreateColor(100, 180, 255));
pONH.SetLineWeight(3);

plot pONL = if showSessionLevels and showONL and ONL_live and lastBar then ONL else Double.NaN;
pONL.SetPaintingStrategy(PaintingStrategy.POINTS);
pONL.SetDefaultColor(Color.PINK);
pONL.SetLineWeight(3);

plot pPWH = if showSessionLevels and showPWH and PWH_live and lastBar then PWH else Double.NaN;
pPWH.SetPaintingStrategy(PaintingStrategy.POINTS);
pPWH.SetDefaultColor(CreateColor(100, 180, 255));
pPWH.SetLineWeight(3);

plot pPWL = if showSessionLevels and showPWL and PWL_live and lastBar then PWL else Double.NaN;
pPWL.SetPaintingStrategy(PaintingStrategy.POINTS);
pPWL.SetDefaultColor(Color.PINK);
pPWL.SetLineWeight(3);

# ── Right-edge bubbles (paired with anchor dots above) ───────────
AddChartBubble(showSessionLevels and showPDH and PDH_live and lastBar, PDH,
    "B-Liq PDH: " + Round(PDH, 2), CreateColor(100, 180, 255), yes);
AddChartBubble(showSessionLevels and showPDL and PDL_live and lastBar, PDL,
    "S-Liq PDL: " + Round(PDL, 2), Color.PINK, no);
AddChartBubble(showSessionLevels and showONH and ONH_live and lastBar, ONH,
    "B-Liq ONH: " + Round(ONH, 2), CreateColor(100, 180, 255), yes);
AddChartBubble(showSessionLevels and showONL and ONL_live and lastBar, ONL,
    "S-Liq ONL: " + Round(ONL, 2), Color.PINK, no);
AddChartBubble(showSessionLevels and showPWH and PWH_live and lastBar, PWH,
    "B-Liq PWH: " + Round(PWH, 2), CreateColor(100, 180, 255), yes);
AddChartBubble(showSessionLevels and showPWL and PWL_live and lastBar, PWL,
    "S-Liq PWL: " + Round(PWL, 2), Color.PINK, no);

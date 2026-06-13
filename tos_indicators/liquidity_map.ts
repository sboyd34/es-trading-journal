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

# ── Session-level lifecycle state machine ────────────────────────
# Buy-side level X (above price):
#   ACCEPTED first  → close > X
#   else SWEPT      → high > X AND close <= X (wick through, close back inside)
#   else LIVE       → otherwise
# State latches: once transitioned, stays transitioned for the session.
# _sweepBar is the first bar where _swept becomes true (state-transition edge).

def PDH_accepted = PDH_accepted[1] or (close > PDH);
def PDH_swept    = PDH_swept[1] or (!PDH_accepted[1] and !PDH_swept[1] and high > PDH and close <= PDH);
def PDH_live     = !PDH_accepted and !PDH_swept;
def PDH_sweepBar = PDH_swept and !PDH_swept[1];

def ONH_accepted = ONH_accepted[1] or (close > ONH);
def ONH_swept    = ONH_swept[1] or (!ONH_accepted[1] and !ONH_swept[1] and high > ONH and close <= ONH);
def ONH_live     = !ONH_accepted and !ONH_swept;
def ONH_sweepBar = ONH_swept and !ONH_swept[1];

def PWH_accepted = PWH_accepted[1] or (close > PWH);
def PWH_swept    = PWH_swept[1] or (!PWH_accepted[1] and !PWH_swept[1] and high > PWH and close <= PWH);
def PWH_live     = !PWH_accepted and !PWH_swept;
def PWH_sweepBar = PWH_swept and !PWH_swept[1];

# Sell-side level X (below price): mirror with low/close-back-up logic.

def PDL_accepted = PDL_accepted[1] or (close < PDL);
def PDL_swept    = PDL_swept[1] or (!PDL_accepted[1] and !PDL_swept[1] and low < PDL and close >= PDL);
def PDL_live     = !PDL_accepted and !PDL_swept;
def PDL_sweepBar = PDL_swept and !PDL_swept[1];

def ONL_accepted = ONL_accepted[1] or (close < ONL);
def ONL_swept    = ONL_swept[1] or (!ONL_accepted[1] and !ONL_swept[1] and low < ONL and close >= ONL);
def ONL_live     = !ONL_accepted and !ONL_swept;
def ONL_sweepBar = ONL_swept and !ONL_swept[1];

def PWL_accepted = PWL_accepted[1] or (close < PWL);
def PWL_swept    = PWL_swept[1] or (!PWL_accepted[1] and !PWL_swept[1] and low < PWL and close >= PWL);
def PWL_live     = !PWL_accepted and !PWL_swept;
def PWL_sweepBar = PWL_swept and !PWL_swept[1];

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

# ── Sweep arrow plots (buy-side: down arrow above bar high) ──────
plot PDH_sweepArrow = if showSweepArrows and showSessionLevels and showPDH and PDH_sweepBar then high else Double.NaN;
PDH_sweepArrow.SetPaintingStrategy(PaintingStrategy.ARROW_DOWN);
PDH_sweepArrow.SetDefaultColor(Color.GRAY);
PDH_sweepArrow.SetLineWeight(3);

plot ONH_sweepArrow = if showSweepArrows and showSessionLevels and showONH and ONH_sweepBar then high else Double.NaN;
ONH_sweepArrow.SetPaintingStrategy(PaintingStrategy.ARROW_DOWN);
ONH_sweepArrow.SetDefaultColor(Color.GRAY);
ONH_sweepArrow.SetLineWeight(3);

plot PWH_sweepArrow = if showSweepArrows and showSessionLevels and showPWH and PWH_sweepBar then high else Double.NaN;
PWH_sweepArrow.SetPaintingStrategy(PaintingStrategy.ARROW_DOWN);
PWH_sweepArrow.SetDefaultColor(Color.GRAY);
PWH_sweepArrow.SetLineWeight(3);

# ── Sweep arrow plots (sell-side: up arrow below bar low) ────────
plot PDL_sweepArrow = if showSweepArrows and showSessionLevels and showPDL and PDL_sweepBar then low else Double.NaN;
PDL_sweepArrow.SetPaintingStrategy(PaintingStrategy.ARROW_UP);
PDL_sweepArrow.SetDefaultColor(Color.GRAY);
PDL_sweepArrow.SetLineWeight(3);

plot ONL_sweepArrow = if showSweepArrows and showSessionLevels and showONL and ONL_sweepBar then low else Double.NaN;
ONL_sweepArrow.SetPaintingStrategy(PaintingStrategy.ARROW_UP);
ONL_sweepArrow.SetDefaultColor(Color.GRAY);
ONL_sweepArrow.SetLineWeight(3);

plot PWL_sweepArrow = if showSweepArrows and showSessionLevels and showPWL and PWL_sweepBar then low else Double.NaN;
PWL_sweepArrow.SetPaintingStrategy(PaintingStrategy.ARROW_UP);
PWL_sweepArrow.SetDefaultColor(Color.GRAY);
PWL_sweepArrow.SetLineWeight(3);

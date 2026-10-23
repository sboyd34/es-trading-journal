# ═══════════════════════════════════════════════════════════════
#  FireLines Approximation for ThinkorSwim — v2 (refactored)
#  Inspired by Rob Tovell's FireLines indicator (TradingView)
#
#  CHANGES FROM v1:
#   1. HighestAll() removed — replaced with future-offset /
#      GetLastDay() checks. Big speedup on tick / 1m charts.
#   2. sessionOpen seeded with CompoundValue — no phantom 0-line
#      when the chart loads mid-session.
#   3. Overnight sessions supported (e.g. start 1700, end 1600
#      for Globex) — the start/end window now wraps midnight.
#   4. Adaptive confluence threshold — Points, % of prior-day
#      range, or fraction of a daily ATR. One saved study works
#      on ES, SPY and CL alike.
#   5. NearW() script subroutine — the nine duplicated
#      confluence blocks collapse to one call each, and the
#      corner-label pairing is guaranteed consistent with the
#      flag that triggered it (single source of truth).
#   6. DVL aggregation clamped to the chart's aggregation — no
#      more "secondary period must be greater" error on 30m+.
#      The clamp keeps it legal; dvlOK then hides the line above
#      dvlAggregation, because a clamped DVL is a different
#      indicator, not a degraded one (see note at the def).
#   7. Polish: tick-aware rounding, DefineGlobalColor palette,
#      proximity declutter filter, confluence strength (⚡⚡),
#      tested-level dimming, UVL/LVL/FL1 cross alerts, optional
#      session gating for weekly lines.
#   8. Timeframe-adaptive (1m → 1H). Session and overnight window
#      starts are widened by one bar period, so a start that is
#      not a bar boundary (08:30 on a 1H chart) no longer drops
#      the bar containing the open and begins the session a full
#      period late. Derived from GetAggregationPeriod(), so it
#      holds under either hourly-bar alignment. Anything that
#      cannot be computed faithfully at the chart's period — the
#      DVL, the session Open — is now hidden rather than drawn
#      from substituted data. 5m/15m output is unchanged.
#
#  LIQUIDITY LAYER (v2.1):
#   PDH/PDL + overnight ONH/ONL price-memory levels, sweep
#   detection (wick through + close back), and confluence with
#   the daily FireLines (reuses NearW). Visual + alerts only —
#   no hit-rate stats (see 2026-06-13 probe: distance confound).
#
#  THRESHOLD TUNING BY MODE:
#   Points          → threshold in raw points   (e.g. 5.0 on ES)
#   PriorDayRangePct→ % of prior day's range    (e.g. 10 = 10%)
#   ATR             → fraction of daily ATR(14) (e.g. 0.15)
# ═══════════════════════════════════════════════════════════════

declare upper;

# ── User Inputs ──────────────────────────────────────────────────
input showIP             = yes;
input showValueZone      = yes;
input showBullLines      = yes;
input showBearLines      = yes;
input showDVL            = yes;
input showOpen           = yes;
input showWeeklyLevels   = yes;
input gateWeeklyToSession = no;   # yes = weekly lines obey session window too
input showCornerLabels   = yes;
input showLineLabels     = yes;
input showConfluence     = yes;
input confluenceMode     = {default Points, PriorDayRangePct, ATR};
input confluenceThreshold = 5.0;  # meaning depends on confluenceMode (see header)
input atrLength          = 14;
input dvlLength          = 20;
input dvlAggregation     = AggregationPeriod.FIFTEEN_MIN;
input dvlType            = AverageType.EXPONENTIAL;
input sessionGating      = yes;
input sessionStartHHMM   = 0830;
input sessionEndHHMM     = 1500;
input openMaxPeriod      = AggregationPeriod.FIFTEEN_MIN;  # hide Open line above this
input proximityFilter    = no;    # yes = only draw FL levels near price
input proximityATRmult   = 2.0;   # "near" = within this many daily ATRs of close
input dimTestedLevels    = yes;   # dim a level after price has touched it today
input showLiquidity      = yes;   # PDH/PDL + overnight liquidity levels
input showOvernight      = yes;   # ONH/ONL need Extended Hours (ETH) ON to populate
input onStartHHMM        = 1700;  # overnight (Globex) window start
input onEndHHMM          = 0830;  # overnight window end (wraps midnight)
input liqSweepArrows     = yes;   # draw arrows on liquidity sweeps

# ── Global Colors (user-restylable via study settings) ──────────
DefineGlobalColor("Pivot",      Color.WHITE);
DefineGlobalColor("Value",      Color.YELLOW);
DefineGlobalColor("Bull",       Color.GREEN);
DefineGlobalColor("Bear",       Color.RED);
DefineGlobalColor("Trend",      Color.CYAN);
DefineGlobalColor("OpenLine",   Color.MAGENTA);
DefineGlobalColor("Confluence", Color.ORANGE);
DefineGlobalColor("Liquidity",  Color.GRAY);

# ── Subroutines ──────────────────────────────────────────────────
# NearW: returns index (1-9) of the FIRST weekly level within thr
# of lvl (0 = none), plus cnt = how many weekly levels are within
# thr (confluence strength). Single source of truth for flags,
# labels and clouds.
script NearW {
    input lvl = 0;
    input thr = 0;
    input w1 = 0; input w2 = 0; input w3 = 0;
    input w4 = 0; input w5 = 0; input w6 = 0;
    input w7 = 0; input w8 = 0; input w9 = 0;
    plot idx = if AbsValue(lvl - w1) <= thr then 1
          else if AbsValue(lvl - w2) <= thr then 2
          else if AbsValue(lvl - w3) <= thr then 3
          else if AbsValue(lvl - w4) <= thr then 4
          else if AbsValue(lvl - w5) <= thr then 5
          else if AbsValue(lvl - w6) <= thr then 6
          else if AbsValue(lvl - w7) <= thr then 7
          else if AbsValue(lvl - w8) <= thr then 8
          else if AbsValue(lvl - w9) <= thr then 9
          else 0;
    plot cnt = (AbsValue(lvl - w1) <= thr) + (AbsValue(lvl - w2) <= thr) +
               (AbsValue(lvl - w3) <= thr) + (AbsValue(lvl - w4) <= thr) +
               (AbsValue(lvl - w5) <= thr) + (AbsValue(lvl - w6) <= thr) +
               (AbsValue(lvl - w7) <= thr) + (AbsValue(lvl - w8) <= thr) +
               (AbsValue(lvl - w9) <= thr);
}

# Tested: latches yes once price has traded through lvl since the
# last reset (session start or day change).
script Tested {
    input lvl = 0;
    input reset = no;
    def hit = high >= lvl and low <= lvl;
    def t = CompoundValue(1, if reset then hit else t[1] or hit, no);
    plot tested = t;
}

# Swept: liquidity-sweep detector. poke = price wicks through lvl
# then closes back on the origin side. firstBar isolates the single
# event bar per session (latched via reset).
script Swept {
    input lvl = 0;
    input isHigh = yes;      # yes = liquidity above (wick over, close under)
    input reset = no;
    def poke = if isHigh then high > lvl and close < lvl
                         else low  < lvl and close > lvl;
    def latched = CompoundValue(1, if reset then poke else latched[1] or poke, no);
    plot firstBar = poke and (reset or !latched[1]);
}

# RoundTick: rounds to the symbol's tick size instead of 2 decimals
# (4527.25 on ES rather than 4527.13).
script RoundTick {
    input v = 0;
    plot r = Round(v / TickSize(), 0) * TickSize();
}

# ── Prior Day OHLC ───────────────────────────────────────────────
def pH = high(period  = AggregationPeriod.DAY)[1];
def pL = low(period   = AggregationPeriod.DAY)[1];
def pC = close(period = AggregationPeriod.DAY)[1];
def r  = pH - pL;

# ── Daily Levels ─────────────────────────────────────────────────
def IP   = (pH + pL + pC) / 3;
def UVL  = 2 * IP - pL;
def LVL  = 2 * IP - pH;

def bFL1  = IP + r;
def bFL2  = pH + 2 * (IP - pL);
def bFL3  = bFL1 + r;

def beFL1 = IP - r;
def beFL2 = pL - 2 * (pH - IP);
def beFL3 = beFL1 - r;

# ── Prior Week OHLC ──────────────────────────────────────────────
def wH = high(period  = AggregationPeriod.WEEK)[1];
def wL = low(period   = AggregationPeriod.WEEK)[1];
def wC = close(period = AggregationPeriod.WEEK)[1];
def wR = wH - wL;

# ── Weekly Levels ────────────────────────────────────────────────
def wIP   = (wH + wL + wC) / 3;
def wUVL  = 2 * wIP - wL;
def wLVL  = 2 * wIP - wH;

def wBFL1  = wIP + wR;
def wBFL2  = wH + 2 * (wIP - wL);
def wBFL3  = wBFL1 + wR;

def wBEFL1 = wIP - wR;
def wBEFL2 = wL - 2 * (wH - wIP);
def wBEFL3 = wBEFL1 - wR;

# ── Daily ATR (Wilder-style, sampled once per day) ──────────────
# NOTE: a plain Average() over daily-period TR on an intraday chart
# would average BARS, not DAYS — so we update recursively on the
# day boundary using the prior day's true range.
def dTR = TrueRange(high(period = AggregationPeriod.DAY),
                    close(period = AggregationPeriod.DAY),
                    low(period  = AggregationPeriod.DAY));
def newDay = GetDay() != GetDay()[1];
def dATR = CompoundValue(1,
    if newDay then (dATR[1] * (atrLength - 1) + dTR[1]) / atrLength else dATR[1],
    dTR);

# ── Confluence Threshold Resolution ──────────────────────────────
def _c = if confluenceMode == confluenceMode.ATR
             then dATR * confluenceThreshold
         else if confluenceMode == confluenceMode.PriorDayRangePct
             then r * confluenceThreshold / 100
         else confluenceThreshold;

# ── Dynamic Value Line ───────────────────────────────────────────
# ThinkScript forbids a secondary aggregation below the chart's own,
# so a 15m DVL is not *computable* on a 30m+ chart. That's a platform
# limit, not a tuning knob.
#
# The clamp below exists only to keep that hard error from firing —
# it is NOT a fix. EMA20 of 15m closes is 300 minutes of lookback;
# EMA20 of 1H closes is 1200. Same name, same colour, different line.
# Clamping alone would draw a line that is always present and silently
# means something else, which is the worst of the three options: an
# error you fix, a wrong number you trade off of.
#
# So: clamp to stay legal, then gate every *display* of it on dvlOK.
# Above dvlAggregation the DVL is absent rather than misleading.
def dvlOK  = GetAggregationPeriod() <= dvlAggregation;
def dvlAgg = Max(GetAggregationPeriod(), dvlAggregation);
def dvl = MovingAverage(dvlType, close(period = dvlAgg), dvlLength);

# ── Session Gating (overnight-safe, bar-boundary aware) ──────────
# A session edge is a wall-clock instant; a bar is an interval. On any
# period where the start does not land on a bar boundary (08:30 on a
# 1H chart) the old `SecondsFromTime(start) >= 0` test rejected the
# bar that *contains* the open, so the session silently began a full
# period late — the Opening Drive window simply vanished.
#
# Widening the start by one bar period admits the containing bar
# instead. Derived from GetAggregationPeriod() rather than an assumed
# alignment, so it holds whether TOS stamps hourly bars at :00 or at
# the session start. Strict `>` keeps the bar that *ends* exactly at
# the open out of the window — it holds no session time. On 5m/15m,
# where 08:30 is a real boundary, this is bit-identical to before.
#
# Only the start is widened. The end keeps `>= 0`: the bar stamped at
# the close has always been included, and that is not ours to change.
def barSec = GetAggregationPeriod() / 1000;
def afterStart = SecondsFromTime(sessionStartHHMM) > -barSec;
def inSession = if !sessionGating then yes
    else if sessionStartHHMM < sessionEndHHMM
        then afterStart and SecondsTillTime(sessionEndHHMM) >= 0
    else afterStart or SecondsTillTime(sessionEndHHMM) >= 0;

def lastBar = !IsNaN(close) and IsNaN(close[-1]);
def lastDay = GetDay() == GetLastDay();
def lastInSession = lastDay and inSession
                    and (IsNaN(close[-1]) or !inSession[-1]);

def resetTested = if sessionGating then inSession and !inSession[1] else newDay;

# ── Session Open (seeded — no phantom 0-line) ────────────────────
# Seeded off the same edge inSession uses, so the open can never be
# stamped from a different bar than the one that starts the session.
#
# The price this captures is the containing bar's open, which is stale
# by (session start − bar open). On 5m that is at most 5 minutes —
# immaterial. On 1H it is up to an hour, and a level labelled "Open"
# that is actually an overnight print is worse than no level at all.
# openMaxPeriod draws the line where staleness stops being tolerable;
# it is a trader's judgement, so it is an input rather than baked in.
def openOK = GetAggregationPeriod() <= openMaxPeriod;
def sessionOpen = CompoundValue(1,
    if afterStart and !afterStart[1] then open else sessionOpen[1],
    Double.NaN);
def haveOpen = !IsNaN(sessionOpen) and openOK;

def openAboveBFL3  = haveOpen and sessionOpen > bFL3;
def openAboveBFL2  = haveOpen and sessionOpen > bFL2  and sessionOpen <= bFL3;
def openAboveBFL1  = haveOpen and sessionOpen > bFL1  and sessionOpen <= bFL2;
def openAboveUVL   = haveOpen and sessionOpen > UVL   and sessionOpen <= bFL1;
def openInValue    = haveOpen and sessionOpen >= LVL  and sessionOpen <= UVL;
def openBelowLVL   = haveOpen and sessionOpen < LVL   and sessionOpen >= beFL1;
def openBelowBEFL1 = haveOpen and sessionOpen < beFL1 and sessionOpen >= beFL2;
def openBelowBEFL2 = haveOpen and sessionOpen < beFL2 and sessionOpen >= beFL3;
def openBelowBEFL3 = haveOpen and sessionOpen < beFL3;

# ════════════════════════════════════════════════════════════════
#  CONFLUENCE DETECTION  (one NearW call per daily level)
#  idx: 1=W-IP 2=W-UVL 3=W-LVL 4=W-B-FL1 5=W-B-FL2 6=W-B-FL3
#       7=W-Be-FL1 8=W-Be-FL2 9=W-Be-FL3
# ════════════════════════════════════════════════════════════════
def IP_m    = NearW(IP,    _c, wIP, wUVL, wLVL, wBFL1, wBFL2, wBFL3, wBEFL1, wBEFL2, wBEFL3).idx;
def IP_n    = NearW(IP,    _c, wIP, wUVL, wLVL, wBFL1, wBFL2, wBFL3, wBEFL1, wBEFL2, wBEFL3).cnt;
def UVL_m   = NearW(UVL,   _c, wIP, wUVL, wLVL, wBFL1, wBFL2, wBFL3, wBEFL1, wBEFL2, wBEFL3).idx;
def UVL_n   = NearW(UVL,   _c, wIP, wUVL, wLVL, wBFL1, wBFL2, wBFL3, wBEFL1, wBEFL2, wBEFL3).cnt;
def LVL_m   = NearW(LVL,   _c, wIP, wUVL, wLVL, wBFL1, wBFL2, wBFL3, wBEFL1, wBEFL2, wBEFL3).idx;
def LVL_n   = NearW(LVL,   _c, wIP, wUVL, wLVL, wBFL1, wBFL2, wBFL3, wBEFL1, wBEFL2, wBEFL3).cnt;
def bFL1_m  = NearW(bFL1,  _c, wIP, wUVL, wLVL, wBFL1, wBFL2, wBFL3, wBEFL1, wBEFL2, wBEFL3).idx;
def bFL1_n  = NearW(bFL1,  _c, wIP, wUVL, wLVL, wBFL1, wBFL2, wBFL3, wBEFL1, wBEFL2, wBEFL3).cnt;
def bFL2_m  = NearW(bFL2,  _c, wIP, wUVL, wLVL, wBFL1, wBFL2, wBFL3, wBEFL1, wBEFL2, wBEFL3).idx;
def bFL2_n  = NearW(bFL2,  _c, wIP, wUVL, wLVL, wBFL1, wBFL2, wBFL3, wBEFL1, wBEFL2, wBEFL3).cnt;
def bFL3_m  = NearW(bFL3,  _c, wIP, wUVL, wLVL, wBFL1, wBFL2, wBFL3, wBEFL1, wBEFL2, wBEFL3).idx;
def bFL3_n  = NearW(bFL3,  _c, wIP, wUVL, wLVL, wBFL1, wBFL2, wBFL3, wBEFL1, wBEFL2, wBEFL3).cnt;
def beFL1_m = NearW(beFL1, _c, wIP, wUVL, wLVL, wBFL1, wBFL2, wBFL3, wBEFL1, wBEFL2, wBEFL3).idx;
def beFL1_n = NearW(beFL1, _c, wIP, wUVL, wLVL, wBFL1, wBFL2, wBFL3, wBEFL1, wBEFL2, wBEFL3).cnt;
def beFL2_m = NearW(beFL2, _c, wIP, wUVL, wLVL, wBFL1, wBFL2, wBFL3, wBEFL1, wBEFL2, wBEFL3).idx;
def beFL2_n = NearW(beFL2, _c, wIP, wUVL, wLVL, wBFL1, wBFL2, wBFL3, wBEFL1, wBEFL2, wBEFL3).cnt;
def beFL3_m = NearW(beFL3, _c, wIP, wUVL, wLVL, wBFL1, wBFL2, wBFL3, wBEFL1, wBEFL2, wBEFL3).idx;
def beFL3_n = NearW(beFL3, _c, wIP, wUVL, wLVL, wBFL1, wBFL2, wBFL3, wBEFL1, wBEFL2, wBEFL3).cnt;

def IP_conf    = showConfluence and IP_m    > 0;
def UVL_conf   = showConfluence and UVL_m   > 0;
def LVL_conf   = showConfluence and LVL_m   > 0;
def bFL1_conf  = showConfluence and bFL1_m  > 0;
def bFL2_conf  = showConfluence and bFL2_m  > 0;
def bFL3_conf  = showConfluence and bFL3_m  > 0;
def beFL1_conf = showConfluence and beFL1_m > 0;
def beFL2_conf = showConfluence and beFL2_m > 0;
def beFL3_conf = showConfluence and beFL3_m > 0;

# ── Orange cloud plots (±threshold/2 band around confluent level) ─
plot cIP_hi    = if inSession and IP_conf    then IP    + _c / 2 else Double.NaN;
plot cIP_lo    = if inSession and IP_conf    then IP    - _c / 2 else Double.NaN;
plot cUVL_hi   = if inSession and UVL_conf   then UVL   + _c / 2 else Double.NaN;
plot cUVL_lo   = if inSession and UVL_conf   then UVL   - _c / 2 else Double.NaN;
plot cLVL_hi   = if inSession and LVL_conf   then LVL   + _c / 2 else Double.NaN;
plot cLVL_lo   = if inSession and LVL_conf   then LVL   - _c / 2 else Double.NaN;
plot cBFL1_hi  = if inSession and bFL1_conf  then bFL1  + _c / 2 else Double.NaN;
plot cBFL1_lo  = if inSession and bFL1_conf  then bFL1  - _c / 2 else Double.NaN;
plot cBFL2_hi  = if inSession and bFL2_conf  then bFL2  + _c / 2 else Double.NaN;
plot cBFL2_lo  = if inSession and bFL2_conf  then bFL2  - _c / 2 else Double.NaN;
plot cBFL3_hi  = if inSession and bFL3_conf  then bFL3  + _c / 2 else Double.NaN;
plot cBFL3_lo  = if inSession and bFL3_conf  then bFL3  - _c / 2 else Double.NaN;
plot cBEFL1_hi = if inSession and beFL1_conf then beFL1 + _c / 2 else Double.NaN;
plot cBEFL1_lo = if inSession and beFL1_conf then beFL1 - _c / 2 else Double.NaN;
plot cBEFL2_hi = if inSession and beFL2_conf then beFL2 + _c / 2 else Double.NaN;
plot cBEFL2_lo = if inSession and beFL2_conf then beFL2 - _c / 2 else Double.NaN;
plot cBEFL3_hi = if inSession and beFL3_conf then beFL3 + _c / 2 else Double.NaN;
plot cBEFL3_lo = if inSession and beFL3_conf then beFL3 - _c / 2 else Double.NaN;

cIP_hi.Hide();    cIP_lo.Hide();
cUVL_hi.Hide();   cUVL_lo.Hide();
cLVL_hi.Hide();   cLVL_lo.Hide();
cBFL1_hi.Hide();  cBFL1_lo.Hide();
cBFL2_hi.Hide();  cBFL2_lo.Hide();
cBFL3_hi.Hide();  cBFL3_lo.Hide();
cBEFL1_hi.Hide(); cBEFL1_lo.Hide();
cBEFL2_hi.Hide(); cBEFL2_lo.Hide();
cBEFL3_hi.Hide(); cBEFL3_lo.Hide();

AddCloud(cIP_hi,    cIP_lo,    GlobalColor("Confluence"), GlobalColor("Confluence"));
AddCloud(cUVL_hi,   cUVL_lo,   GlobalColor("Confluence"), GlobalColor("Confluence"));
AddCloud(cLVL_hi,   cLVL_lo,   GlobalColor("Confluence"), GlobalColor("Confluence"));
AddCloud(cBFL1_hi,  cBFL1_lo,  GlobalColor("Confluence"), GlobalColor("Confluence"));
AddCloud(cBFL2_hi,  cBFL2_lo,  GlobalColor("Confluence"), GlobalColor("Confluence"));
AddCloud(cBFL3_hi,  cBFL3_lo,  GlobalColor("Confluence"), GlobalColor("Confluence"));
AddCloud(cBEFL1_hi, cBEFL1_lo, GlobalColor("Confluence"), GlobalColor("Confluence"));
AddCloud(cBEFL2_hi, cBEFL2_lo, GlobalColor("Confluence"), GlobalColor("Confluence"));
AddCloud(cBEFL3_hi, cBEFL3_lo, GlobalColor("Confluence"), GlobalColor("Confluence"));

# ── Tested-Level Tracking ────────────────────────────────────────
def tUVL   = Tested(UVL,   resetTested);
def tLVL   = Tested(LVL,   resetTested);
def tBFL1  = Tested(bFL1,  resetTested);
def tBFL2  = Tested(bFL2,  resetTested);
def tBFL3  = Tested(bFL3,  resetTested);
def tBEFL1 = Tested(beFL1, resetTested);
def tBEFL2 = Tested(beFL2, resetTested);
def tBEFL3 = Tested(beFL3, resetTested);

# ── Proximity Declutter ──────────────────────────────────────────
def proxBand = proximityATRmult * dATR;
def pf = !proximityFilter;   # shorthand: pf=yes means "always show"

# ════════════════════════════════════════════════════════════════
#  DAILY PLOTS  (Curve.FIRM, weight 2 — prominent)
#  Tested levels dim to a darker shade until the next session.
# ════════════════════════════════════════════════════════════════

plot pIP = if showIP and inSession then IP else Double.NaN;
pIP.SetDefaultColor(GlobalColor("Pivot"));
pIP.SetStyle(Curve.SHORT_DASH);
pIP.SetLineWeight(2);

plot pUVL = if showValueZone and inSession and (pf or AbsValue(UVL - close) <= proxBand) then UVL else Double.NaN;
pUVL.AssignValueColor(if dimTestedLevels and tUVL then CreateColor(128, 128, 0) else GlobalColor("Value"));
pUVL.SetStyle(Curve.FIRM);
pUVL.SetLineWeight(2);

plot pLVL = if showValueZone and inSession and (pf or AbsValue(LVL - close) <= proxBand) then LVL else Double.NaN;
pLVL.AssignValueColor(if dimTestedLevels and tLVL then CreateColor(128, 128, 0) else GlobalColor("Value"));
pLVL.SetStyle(Curve.FIRM);
pLVL.SetLineWeight(2);

plot pBFL1 = if showBullLines and inSession and (pf or AbsValue(bFL1 - close) <= proxBand) then bFL1 else Double.NaN;
pBFL1.AssignValueColor(if dimTestedLevels and tBFL1 then Color.DARK_GREEN else GlobalColor("Bull"));
pBFL1.SetStyle(Curve.FIRM);
pBFL1.SetLineWeight(2);

plot pBFL2 = if showBullLines and inSession and (pf or AbsValue(bFL2 - close) <= proxBand) then bFL2 else Double.NaN;
pBFL2.AssignValueColor(if dimTestedLevels and tBFL2 then Color.DARK_GREEN else GlobalColor("Bull"));
pBFL2.SetStyle(Curve.FIRM);
pBFL2.SetLineWeight(1);

plot pBFL3 = if showBullLines and inSession and (pf or AbsValue(bFL3 - close) <= proxBand) then bFL3 else Double.NaN;
pBFL3.AssignValueColor(if dimTestedLevels and tBFL3 then Color.DARK_GREEN else GlobalColor("Bull"));
pBFL3.SetStyle(Curve.SHORT_DASH);
pBFL3.SetLineWeight(1);

plot pBEFL1 = if showBearLines and inSession and (pf or AbsValue(beFL1 - close) <= proxBand) then beFL1 else Double.NaN;
pBEFL1.AssignValueColor(if dimTestedLevels and tBEFL1 then Color.DARK_RED else GlobalColor("Bear"));
pBEFL1.SetStyle(Curve.FIRM);
pBEFL1.SetLineWeight(2);

plot pBEFL2 = if showBearLines and inSession and (pf or AbsValue(beFL2 - close) <= proxBand) then beFL2 else Double.NaN;
pBEFL2.AssignValueColor(if dimTestedLevels and tBEFL2 then Color.DARK_RED else GlobalColor("Bear"));
pBEFL2.SetStyle(Curve.FIRM);
pBEFL2.SetLineWeight(1);

plot pBEFL3 = if showBearLines and inSession and (pf or AbsValue(beFL3 - close) <= proxBand) then beFL3 else Double.NaN;
pBEFL3.AssignValueColor(if dimTestedLevels and tBEFL3 then Color.DARK_RED else GlobalColor("Bear"));
pBEFL3.SetStyle(Curve.SHORT_DASH);
pBEFL3.SetLineWeight(1);

plot pDVL = if showDVL and dvlOK and inSession then dvl else Double.NaN;
pDVL.SetDefaultColor(GlobalColor("Trend"));
pDVL.SetStyle(Curve.FIRM);
pDVL.SetLineWeight(2);

plot pOpen = if showOpen and inSession and haveOpen then sessionOpen else Double.NaN;
pOpen.SetDefaultColor(GlobalColor("OpenLine"));
pOpen.SetStyle(Curve.SHORT_DASH);
pOpen.SetLineWeight(1);

# ════════════════════════════════════════════════════════════════
#  WEEKLY PLOTS  (Curve.LONG_DASH, weight 1 — secondary layer)
# ════════════════════════════════════════════════════════════════
def wkGate = if gateWeeklyToSession then inSession else yes;
def wkVis  = showWeeklyLevels and wkGate;

plot pWIP = if wkVis then wIP else Double.NaN;
pWIP.SetDefaultColor(GlobalColor("Pivot"));
pWIP.SetStyle(Curve.LONG_DASH);
pWIP.SetLineWeight(1);

plot pWUVL = if wkVis and (pf or AbsValue(wUVL - close) <= proxBand) then wUVL else Double.NaN;
pWUVL.SetDefaultColor(GlobalColor("Value"));
pWUVL.SetStyle(Curve.LONG_DASH);
pWUVL.SetLineWeight(1);

plot pWLVL = if wkVis and (pf or AbsValue(wLVL - close) <= proxBand) then wLVL else Double.NaN;
pWLVL.SetDefaultColor(GlobalColor("Value"));
pWLVL.SetStyle(Curve.LONG_DASH);
pWLVL.SetLineWeight(1);

plot pWBFL1 = if wkVis and showBullLines and (pf or AbsValue(wBFL1 - close) <= proxBand) then wBFL1 else Double.NaN;
pWBFL1.SetDefaultColor(GlobalColor("Bull"));
pWBFL1.SetStyle(Curve.LONG_DASH);
pWBFL1.SetLineWeight(1);

plot pWBFL2 = if wkVis and showBullLines and (pf or AbsValue(wBFL2 - close) <= proxBand) then wBFL2 else Double.NaN;
pWBFL2.SetDefaultColor(GlobalColor("Bull"));
pWBFL2.SetStyle(Curve.LONG_DASH);
pWBFL2.SetLineWeight(1);

plot pWBFL3 = if wkVis and showBullLines and (pf or AbsValue(wBFL3 - close) <= proxBand) then wBFL3 else Double.NaN;
pWBFL3.SetDefaultColor(GlobalColor("Bull"));
pWBFL3.SetStyle(Curve.LONG_DASH);
pWBFL3.SetLineWeight(1);

plot pWBEFL1 = if wkVis and showBearLines and (pf or AbsValue(wBEFL1 - close) <= proxBand) then wBEFL1 else Double.NaN;
pWBEFL1.SetDefaultColor(GlobalColor("Bear"));
pWBEFL1.SetStyle(Curve.LONG_DASH);
pWBEFL1.SetLineWeight(1);

plot pWBEFL2 = if wkVis and showBearLines and (pf or AbsValue(wBEFL2 - close) <= proxBand) then wBEFL2 else Double.NaN;
pWBEFL2.SetDefaultColor(GlobalColor("Bear"));
pWBEFL2.SetStyle(Curve.LONG_DASH);
pWBEFL2.SetLineWeight(1);

plot pWBEFL3 = if wkVis and showBearLines and (pf or AbsValue(wBEFL3 - close) <= proxBand) then wBEFL3 else Double.NaN;
pWBEFL3.SetDefaultColor(GlobalColor("Bear"));
pWBEFL3.SetStyle(Curve.LONG_DASH);
pWBEFL3.SetLineWeight(1);

# ════════════════════════════════════════════════════════════════
#  LIQUIDITY LAYER — price-memory levels where stops rest
#  PDH/PDL = prior-day high/low (reuses pH/pL, already computed).
#  ONH/ONL = overnight (Globex) range. REQUIRES Extended Hours ON.
#  Sweep = wick through a level then close back on the origin side.
# ════════════════════════════════════════════════════════════════

# ── Overnight running range (overnight-safe window wrap) ─────────
# Start widened by one bar period for the same reason inSession is —
# 17:00 is not a bar boundary on every period, and an overnight range
# that starts a bar late misses the Globex open.
def afterON = SecondsFromTime(onStartHHMM) > -barSec;
def inON = if onStartHHMM < onEndHHMM
    then afterON and SecondsTillTime(onEndHHMM) >= 0
    else afterON or SecondsTillTime(onEndHHMM) >= 0;
def onStart = inON and !inON[1];
def ONH = CompoundValue(1, if onStart then high else if inON then Max(ONH[1], high) else ONH[1], high);
def ONL = CompoundValue(1, if onStart then low  else if inON then Min(ONL[1], low)  else ONL[1], low);

# ── Sweep events (single bar per session) ───────────────────────
def swPDH = Swept(pH,  yes, resetTested);
def swPDL = Swept(pL,  no,  resetTested);
def swONH = Swept(ONH, yes, resetTested);
def swONL = Swept(ONL, no,  resetTested);
def bearSweep = swPDH or swONH;   # grabbed liquidity ABOVE  → look short
def bullSweep = swPDL or swONL;   # grabbed liquidity BELOW  → look long

# ── Confluence with a DAILY FireLine (reuses NearW, fed daily) ──
#  idx: 1=IP 2=UVL 3=LVL 4=B-FL1 5=B-FL2 6=B-FL3 7=Be-FL1 8=Be-FL2 9=Be-FL3
def PDH_dm = NearW(pH,  _c, IP, UVL, LVL, bFL1, bFL2, bFL3, beFL1, beFL2, beFL3).idx;
def PDL_dm = NearW(pL,  _c, IP, UVL, LVL, bFL1, bFL2, bFL3, beFL1, beFL2, beFL3).idx;
def ONH_dm = NearW(ONH, _c, IP, UVL, LVL, bFL1, bFL2, bFL3, beFL1, beFL2, beFL3).idx;
def ONL_dm = NearW(ONL, _c, IP, UVL, LVL, bFL1, bFL2, bFL3, beFL1, beFL2, beFL3).idx;

# ── Tested dimming (reuses existing Tested subroutine) ──────────
def tPDH = Tested(pH,  resetTested);
def tPDL = Tested(pL,  resetTested);
def tONH = Tested(ONH, resetTested);
def tONL = Tested(ONL, resetTested);

# ── Liquidity plots ─────────────────────────────────────────────
plot pPDH = if showLiquidity and inSession and (pf or AbsValue(pH - close) <= proxBand) then pH else Double.NaN;
pPDH.AssignValueColor(if dimTestedLevels and tPDH then CreateColor(80, 80, 80) else GlobalColor("Liquidity"));
pPDH.SetStyle(Curve.FIRM);
pPDH.SetLineWeight(1);

plot pPDL = if showLiquidity and inSession and (pf or AbsValue(pL - close) <= proxBand) then pL else Double.NaN;
pPDL.AssignValueColor(if dimTestedLevels and tPDL then CreateColor(80, 80, 80) else GlobalColor("Liquidity"));
pPDL.SetStyle(Curve.FIRM);
pPDL.SetLineWeight(1);

plot pONH = if showLiquidity and showOvernight and inSession and (pf or AbsValue(ONH - close) <= proxBand) then ONH else Double.NaN;
pONH.AssignValueColor(if dimTestedLevels and tONH then CreateColor(80, 80, 80) else GlobalColor("Liquidity"));
pONH.SetStyle(Curve.SHORT_DASH);
pONH.SetLineWeight(1);

plot pONL = if showLiquidity and showOvernight and inSession and (pf or AbsValue(ONL - close) <= proxBand) then ONL else Double.NaN;
pONL.AssignValueColor(if dimTestedLevels and tONL then CreateColor(80, 80, 80) else GlobalColor("Liquidity"));
pONL.SetStyle(Curve.SHORT_DASH);
pONL.SetLineWeight(1);

# ── Sweep arrows ────────────────────────────────────────────────
plot pBearSweep = if liqSweepArrows and inSession and bearSweep then high + TickSize() else Double.NaN;
pBearSweep.SetPaintingStrategy(PaintingStrategy.ARROW_DOWN);
pBearSweep.SetDefaultColor(GlobalColor("Bear"));
pBearSweep.SetLineWeight(3);

plot pBullSweep = if liqSweepArrows and inSession and bullSweep then low - TickSize() else Double.NaN;
pBullSweep.SetPaintingStrategy(PaintingStrategy.ARROW_UP);
pBullSweep.SetDefaultColor(GlobalColor("Bull"));
pBullSweep.SetLineWeight(3);

# ── Liquidity line labels (⚡ when stacked on a daily FireLine) ──
AddChartBubble(showLineLabels and showLiquidity and lastInSession and (pf or AbsValue(pH - close) <= proxBand), pH,
    (if PDH_dm > 0 then "⚡ " else "") + "PDH: " + RoundTick(pH),
    if PDH_dm > 0 then GlobalColor("Confluence") else GlobalColor("Liquidity"), yes);
AddChartBubble(showLineLabels and showLiquidity and lastInSession and (pf or AbsValue(pL - close) <= proxBand), pL,
    (if PDL_dm > 0 then "⚡ " else "") + "PDL: " + RoundTick(pL),
    if PDL_dm > 0 then GlobalColor("Confluence") else GlobalColor("Liquidity"), no);
AddChartBubble(showLineLabels and showLiquidity and showOvernight and lastInSession and (pf or AbsValue(ONH - close) <= proxBand), ONH,
    (if ONH_dm > 0 then "⚡ " else "") + "ONH: " + RoundTick(ONH),
    if ONH_dm > 0 then GlobalColor("Confluence") else GlobalColor("Liquidity"), yes);
AddChartBubble(showLineLabels and showLiquidity and showOvernight and lastInSession and (pf or AbsValue(ONL - close) <= proxBand), ONL,
    (if ONL_dm > 0 then "⚡ " else "") + "ONL: " + RoundTick(ONL),
    if ONL_dm > 0 then GlobalColor("Confluence") else GlobalColor("Liquidity"), no);

# ── Liquidity corner labels (only when in FireLine confluence) ──
AddLabel(showCornerLabels and showLiquidity and PDH_dm > 0,
    "⚡ PDH ↔ " + (if PDH_dm == 1 then "IP" else if PDH_dm == 2 then "UVL" else if PDH_dm == 3 then "LVL"
        else if PDH_dm == 4 then "B-FL1" else if PDH_dm == 5 then "B-FL2" else if PDH_dm == 6 then "B-FL3"
        else if PDH_dm == 7 then "Be-FL1" else if PDH_dm == 8 then "Be-FL2" else "Be-FL3"),
    GlobalColor("Confluence"));
AddLabel(showCornerLabels and showLiquidity and PDL_dm > 0,
    "⚡ PDL ↔ " + (if PDL_dm == 1 then "IP" else if PDL_dm == 2 then "UVL" else if PDL_dm == 3 then "LVL"
        else if PDL_dm == 4 then "B-FL1" else if PDL_dm == 5 then "B-FL2" else if PDL_dm == 6 then "B-FL3"
        else if PDL_dm == 7 then "Be-FL1" else if PDL_dm == 8 then "Be-FL2" else "Be-FL3"),
    GlobalColor("Confluence"));
AddLabel(showCornerLabels and showLiquidity and showOvernight and ONH_dm > 0,
    "⚡ ONH ↔ " + (if ONH_dm == 1 then "IP" else if ONH_dm == 2 then "UVL" else if ONH_dm == 3 then "LVL"
        else if ONH_dm == 4 then "B-FL1" else if ONH_dm == 5 then "B-FL2" else if ONH_dm == 6 then "B-FL3"
        else if ONH_dm == 7 then "Be-FL1" else if ONH_dm == 8 then "Be-FL2" else "Be-FL3"),
    GlobalColor("Confluence"));
AddLabel(showCornerLabels and showLiquidity and showOvernight and ONL_dm > 0,
    "⚡ ONL ↔ " + (if ONL_dm == 1 then "IP" else if ONL_dm == 2 then "UVL" else if ONL_dm == 3 then "LVL"
        else if ONL_dm == 4 then "B-FL1" else if ONL_dm == 5 then "B-FL2" else if ONL_dm == 6 then "B-FL3"
        else if ONL_dm == 7 then "Be-FL1" else if ONL_dm == 8 then "Be-FL2" else "Be-FL3"),
    GlobalColor("Confluence"));

# ════════════════════════════════════════════════════════════════
#  DAILY LINE LABELS
#  ⚡ = confluence with 1 weekly level, ⚡⚡ = 2+, tick-rounded values
# ════════════════════════════════════════════════════════════════
AddChartBubble(showLineLabels and showBullLines and lastInSession and (pf or AbsValue(bFL3 - close) <= proxBand), bFL3,
    (if bFL3_n >= 2 then "⚡⚡ " else if bFL3_conf then "⚡ " else "") + "B-FL3: " + RoundTick(bFL3),
    if bFL3_conf then GlobalColor("Confluence") else GlobalColor("Bull"), yes);
AddChartBubble(showLineLabels and showBullLines and lastInSession and (pf or AbsValue(bFL2 - close) <= proxBand), bFL2,
    (if bFL2_n >= 2 then "⚡⚡ " else if bFL2_conf then "⚡ " else "") + "B-FL2: " + RoundTick(bFL2),
    if bFL2_conf then GlobalColor("Confluence") else GlobalColor("Bull"), yes);
AddChartBubble(showLineLabels and showBullLines and lastInSession and (pf or AbsValue(bFL1 - close) <= proxBand), bFL1,
    (if bFL1_n >= 2 then "⚡⚡ " else if bFL1_conf then "⚡ " else "") + "B-FL1: " + RoundTick(bFL1),
    if bFL1_conf then GlobalColor("Confluence") else GlobalColor("Bull"), yes);
AddChartBubble(showLineLabels and showValueZone and lastInSession and (pf or AbsValue(UVL - close) <= proxBand), UVL,
    (if UVL_n >= 2 then "⚡⚡ " else if UVL_conf then "⚡ " else "") + "UVL: " + RoundTick(UVL),
    if UVL_conf then GlobalColor("Confluence") else GlobalColor("Value"), yes);
AddChartBubble(showLineLabels and showValueZone and lastInSession and (pf or AbsValue(LVL - close) <= proxBand), LVL,
    (if LVL_n >= 2 then "⚡⚡ " else if LVL_conf then "⚡ " else "") + "LVL: " + RoundTick(LVL),
    if LVL_conf then GlobalColor("Confluence") else GlobalColor("Value"), no);
AddChartBubble(showLineLabels and showIP and lastInSession, IP,
    (if IP_n >= 2 then "⚡⚡ " else if IP_conf then "⚡ " else "") + "IP: " + RoundTick(IP),
    if IP_conf then GlobalColor("Confluence") else GlobalColor("Pivot"), yes);
AddChartBubble(showLineLabels and showBearLines and lastInSession and (pf or AbsValue(beFL1 - close) <= proxBand), beFL1,
    (if beFL1_n >= 2 then "⚡⚡ " else if beFL1_conf then "⚡ " else "") + "Be-FL1: " + RoundTick(beFL1),
    if beFL1_conf then GlobalColor("Confluence") else GlobalColor("Bear"), no);
AddChartBubble(showLineLabels and showBearLines and lastInSession and (pf or AbsValue(beFL2 - close) <= proxBand), beFL2,
    (if beFL2_n >= 2 then "⚡⚡ " else if beFL2_conf then "⚡ " else "") + "Be-FL2: " + RoundTick(beFL2),
    if beFL2_conf then GlobalColor("Confluence") else GlobalColor("Bear"), no);
AddChartBubble(showLineLabels and showBearLines and lastInSession and (pf or AbsValue(beFL3 - close) <= proxBand), beFL3,
    (if beFL3_n >= 2 then "⚡⚡ " else if beFL3_conf then "⚡ " else "") + "Be-FL3: " + RoundTick(beFL3),
    if beFL3_conf then GlobalColor("Confluence") else GlobalColor("Bear"), no);
AddChartBubble(showLineLabels and showDVL and dvlOK and lastInSession, dvl,
    "DVL: " + RoundTick(dvl), GlobalColor("Trend"), yes);
AddChartBubble(showLineLabels and showOpen and lastInSession and haveOpen, sessionOpen,
    "Open: " + RoundTick(sessionOpen), GlobalColor("OpenLine"), yes);

# ════════════════════════════════════════════════════════════════
#  WEEKLY LINE LABELS  (W- prefix, pinned to rightmost bar)
# ════════════════════════════════════════════════════════════════
AddChartBubble(showLineLabels and showWeeklyLevels and showBullLines and lastBar, wBFL3,  "W-B-FL3: "  + RoundTick(wBFL3),  GlobalColor("Bull"),  yes);
AddChartBubble(showLineLabels and showWeeklyLevels and showBullLines and lastBar, wBFL2,  "W-B-FL2: "  + RoundTick(wBFL2),  GlobalColor("Bull"),  yes);
AddChartBubble(showLineLabels and showWeeklyLevels and showBullLines and lastBar, wBFL1,  "W-B-FL1: "  + RoundTick(wBFL1),  GlobalColor("Bull"),  yes);
AddChartBubble(showLineLabels and showWeeklyLevels                   and lastBar, wUVL,   "W-UVL: "    + RoundTick(wUVL),   GlobalColor("Value"), yes);
AddChartBubble(showLineLabels and showWeeklyLevels                   and lastBar, wIP,    "W-IP: "     + RoundTick(wIP),    GlobalColor("Pivot"), yes);
AddChartBubble(showLineLabels and showWeeklyLevels                   and lastBar, wLVL,   "W-LVL: "    + RoundTick(wLVL),   GlobalColor("Value"), no);
AddChartBubble(showLineLabels and showWeeklyLevels and showBearLines and lastBar, wBEFL1, "W-Be-FL1: " + RoundTick(wBEFL1), GlobalColor("Bear"),  no);
AddChartBubble(showLineLabels and showWeeklyLevels and showBearLines and lastBar, wBEFL2, "W-Be-FL2: " + RoundTick(wBEFL2), GlobalColor("Bear"),  no);
AddChartBubble(showLineLabels and showWeeklyLevels and showBearLines and lastBar, wBEFL3, "W-Be-FL3: " + RoundTick(wBEFL3), GlobalColor("Bear"),  no);

# ════════════════════════════════════════════════════════════════
#  CORNER LABELS
# ════════════════════════════════════════════════════════════════
# Daily and weekly level values are read off the chart bubbles — no corner
# labels for them. The corner is reserved for state: open location + confluence.
AddLabel(showCornerLabels and showOpen and haveOpen,
    "Open: " + (if openAboveBFL3  then "above B-FL3"
           else if openAboveBFL2  then "B-FL2 to B-FL3"
           else if openAboveBFL1  then "B-FL1 to B-FL2"
           else if openAboveUVL   then "above UVL"
           else if openInValue    then "in value"
           else if openBelowLVL   then "below LVL"
           else if openBelowBEFL1 then "Be-FL1 to Be-FL2"
           else if openBelowBEFL2 then "Be-FL2 to Be-FL3"
           else                        "below Be-FL3"),
    if openAboveBFL3 or openAboveBFL2 or openAboveBFL1 or openAboveUVL then GlobalColor("Bull")
    else if openInValue then GlobalColor("Value")
    else GlobalColor("Bear"));

# ════════════════════════════════════════════════════════════════
#  CONFLUENCE CORNER LABELS
#  idx→name mapping only (no AbsValue recomputation) — guaranteed
#  to match the level that set the flag. "+N" = additional weekly
#  levels also inside the threshold.
# ════════════════════════════════════════════════════════════════
def confCount = IP_conf + UVL_conf + LVL_conf + bFL1_conf + bFL2_conf + bFL3_conf +
                beFL1_conf + beFL2_conf + beFL3_conf;
AddLabel(showCornerLabels and showConfluence and confCount > 0,
    "⚡ " + confCount + (if confCount == 1 then " confluence" else " confluences"),
    GlobalColor("Confluence"));

AddLabel(showCornerLabels and showConfluence and IP_conf,
    "⚡ IP ↔ " + (if IP_m == 1 then "W-IP" else if IP_m == 2 then "W-UVL"
            else if IP_m == 3 then "W-LVL" else if IP_m == 4 then "W-B-FL1"
            else if IP_m == 5 then "W-B-FL2" else if IP_m == 6 then "W-B-FL3"
            else if IP_m == 7 then "W-Be-FL1" else if IP_m == 8 then "W-Be-FL2"
            else "W-Be-FL3")
    + (if IP_n >= 2 then " +" + (IP_n - 1) else ""),
    GlobalColor("Confluence"));

AddLabel(showCornerLabels and showConfluence and UVL_conf,
    "⚡ UVL ↔ " + (if UVL_m == 1 then "W-IP" else if UVL_m == 2 then "W-UVL"
             else if UVL_m == 3 then "W-LVL" else if UVL_m == 4 then "W-B-FL1"
             else if UVL_m == 5 then "W-B-FL2" else if UVL_m == 6 then "W-B-FL3"
             else if UVL_m == 7 then "W-Be-FL1" else if UVL_m == 8 then "W-Be-FL2"
             else "W-Be-FL3")
    + (if UVL_n >= 2 then " +" + (UVL_n - 1) else ""),
    GlobalColor("Confluence"));

AddLabel(showCornerLabels and showConfluence and LVL_conf,
    "⚡ LVL ↔ " + (if LVL_m == 1 then "W-IP" else if LVL_m == 2 then "W-UVL"
             else if LVL_m == 3 then "W-LVL" else if LVL_m == 4 then "W-B-FL1"
             else if LVL_m == 5 then "W-B-FL2" else if LVL_m == 6 then "W-B-FL3"
             else if LVL_m == 7 then "W-Be-FL1" else if LVL_m == 8 then "W-Be-FL2"
             else "W-Be-FL3")
    + (if LVL_n >= 2 then " +" + (LVL_n - 1) else ""),
    GlobalColor("Confluence"));

AddLabel(showCornerLabels and showConfluence and bFL1_conf,
    "⚡ B-FL1 ↔ " + (if bFL1_m == 1 then "W-IP" else if bFL1_m == 2 then "W-UVL"
               else if bFL1_m == 3 then "W-LVL" else if bFL1_m == 4 then "W-B-FL1"
               else if bFL1_m == 5 then "W-B-FL2" else if bFL1_m == 6 then "W-B-FL3"
               else if bFL1_m == 7 then "W-Be-FL1" else if bFL1_m == 8 then "W-Be-FL2"
               else "W-Be-FL3")
    + (if bFL1_n >= 2 then " +" + (bFL1_n - 1) else ""),
    GlobalColor("Confluence"));

AddLabel(showCornerLabels and showConfluence and bFL2_conf,
    "⚡ B-FL2 ↔ " + (if bFL2_m == 1 then "W-IP" else if bFL2_m == 2 then "W-UVL"
               else if bFL2_m == 3 then "W-LVL" else if bFL2_m == 4 then "W-B-FL1"
               else if bFL2_m == 5 then "W-B-FL2" else if bFL2_m == 6 then "W-B-FL3"
               else if bFL2_m == 7 then "W-Be-FL1" else if bFL2_m == 8 then "W-Be-FL2"
               else "W-Be-FL3")
    + (if bFL2_n >= 2 then " +" + (bFL2_n - 1) else ""),
    GlobalColor("Confluence"));

AddLabel(showCornerLabels and showConfluence and bFL3_conf,
    "⚡ B-FL3 ↔ " + (if bFL3_m == 1 then "W-IP" else if bFL3_m == 2 then "W-UVL"
               else if bFL3_m == 3 then "W-LVL" else if bFL3_m == 4 then "W-B-FL1"
               else if bFL3_m == 5 then "W-B-FL2" else if bFL3_m == 6 then "W-B-FL3"
               else if bFL3_m == 7 then "W-Be-FL1" else if bFL3_m == 8 then "W-Be-FL2"
               else "W-Be-FL3")
    + (if bFL3_n >= 2 then " +" + (bFL3_n - 1) else ""),
    GlobalColor("Confluence"));

AddLabel(showCornerLabels and showConfluence and beFL1_conf,
    "⚡ Be-FL1 ↔ " + (if beFL1_m == 1 then "W-IP" else if beFL1_m == 2 then "W-UVL"
                else if beFL1_m == 3 then "W-LVL" else if beFL1_m == 4 then "W-B-FL1"
                else if beFL1_m == 5 then "W-B-FL2" else if beFL1_m == 6 then "W-B-FL3"
                else if beFL1_m == 7 then "W-Be-FL1" else if beFL1_m == 8 then "W-Be-FL2"
                else "W-Be-FL3")
    + (if beFL1_n >= 2 then " +" + (beFL1_n - 1) else ""),
    GlobalColor("Confluence"));

AddLabel(showCornerLabels and showConfluence and beFL2_conf,
    "⚡ Be-FL2 ↔ " + (if beFL2_m == 1 then "W-IP" else if beFL2_m == 2 then "W-UVL"
                else if beFL2_m == 3 then "W-LVL" else if beFL2_m == 4 then "W-B-FL1"
                else if beFL2_m == 5 then "W-B-FL2" else if beFL2_m == 6 then "W-B-FL3"
                else if beFL2_m == 7 then "W-Be-FL1" else if beFL2_m == 8 then "W-Be-FL2"
                else "W-Be-FL3")
    + (if beFL2_n >= 2 then " +" + (beFL2_n - 1) else ""),
    GlobalColor("Confluence"));

AddLabel(showCornerLabels and showConfluence and beFL3_conf,
    "⚡ Be-FL3 ↔ " + (if beFL3_m == 1 then "W-IP" else if beFL3_m == 2 then "W-UVL"
                else if beFL3_m == 3 then "W-LVL" else if beFL3_m == 4 then "W-B-FL1"
                else if beFL3_m == 5 then "W-B-FL2" else if beFL3_m == 6 then "W-B-FL3"
                else if beFL3_m == 7 then "W-Be-FL1" else if beFL3_m == 8 then "W-Be-FL2"
                else "W-Be-FL3")
    + (if beFL3_n >= 2 then " +" + (beFL3_n - 1) else ""),
    GlobalColor("Confluence"));

# ════════════════════════════════════════════════════════════════
#  ALERTS
# ════════════════════════════════════════════════════════════════
Alert(inSession and close crosses above IP,  "FireLines: Above IP — bull bias",   Alert.BAR, Sound.Ding);
Alert(inSession and close crosses below IP,  "FireLines: Below IP — bear bias",   Alert.BAR, Sound.Ring);
Alert(dvlOK and inSession and close crosses above dvl, "FireLines: Above DVL — trend up",   Alert.BAR, Sound.Bell);
Alert(dvlOK and inSession and close crosses below dvl, "FireLines: Below DVL — trend down", Alert.BAR, Sound.Bell);

# Value-area and first FireLine events — the tradeable levels
Alert(inSession and close crosses above UVL,   "FireLines: Value-area breakout (above UVL)",  Alert.BAR, Sound.Chimes);
Alert(inSession and close crosses below LVL,   "FireLines: Value-area breakdown (below LVL)", Alert.BAR, Sound.Chimes);
Alert(inSession and close crosses above bFL1,  "FireLines: B-FL1 breached",                   Alert.BAR, Sound.Chimes);
Alert(inSession and close crosses below beFL1, "FireLines: Be-FL1 breached",                  Alert.BAR, Sound.Chimes);

# Confluence zone alert — fires once when price enters the zone
def inConfluenceZone =
    (bFL1_conf  and AbsValue(close - bFL1)  <= _c / 2) or
    (bFL2_conf  and AbsValue(close - bFL2)  <= _c / 2) or
    (bFL3_conf  and AbsValue(close - bFL3)  <= _c / 2) or
    (beFL1_conf and AbsValue(close - beFL1) <= _c / 2) or
    (beFL2_conf and AbsValue(close - beFL2) <= _c / 2) or
    (beFL3_conf and AbsValue(close - beFL3) <= _c / 2) or
    (IP_conf    and AbsValue(close - IP)    <= _c / 2) or
    (UVL_conf   and AbsValue(close - UVL)   <= _c / 2) or
    (LVL_conf   and AbsValue(close - LVL)   <= _c / 2);
Alert(inSession and showConfluence and inConfluenceZone and !inConfluenceZone[1],
    "FireLines: Price entering confluence zone!", Alert.BAR, Sound.Bell);

# ── Liquidity sweep alerts ──────────────────────────────────────
Alert(inSession and swPDH, "FireLines: PDH swept (grab above) — look short", Alert.BAR, Sound.Ring);
Alert(inSession and swPDL, "FireLines: PDL swept (grab below) — look long",  Alert.BAR, Sound.Ding);
Alert(inSession and showOvernight and swONH, "FireLines: Overnight-high swept — look short", Alert.BAR, Sound.Ring);
Alert(inSession and showOvernight and swONL, "FireLines: Overnight-low swept — look long",   Alert.BAR, Sound.Ding);
# A+ : swept a liquidity level that is ALSO a FireLine confluence
Alert(inSession and ((swPDH and PDH_dm > 0) or (swONH and ONH_dm > 0)),
    "FireLines: A+ SHORT — liquidity sweep at a FireLine", Alert.BAR, Sound.Bell);
Alert(inSession and ((swPDL and PDL_dm > 0) or (swONL and ONL_dm > 0)),
    "FireLines: A+ LONG — liquidity sweep at a FireLine",  Alert.BAR, Sound.Bell);

# ═══════════════════════════════════════════════════════════════
#  FireLines Approximation for ThinkorSwim
#  Inspired by Rob Tovell's FireLines indicator (TradingView)
#
#  COMPONENTS:
#   • IP / UVL / LVL / Bull-Bear FL 1–3 — Daily pivot framework
#   • W-IP / W-UVL / W-LVL / W-Bull-Bear FL 1–3 — Weekly overlay
#   • DVL     — Dynamic Value Line (15m EMA, cyan)
#   • Open    — Session opening price (magenta dashed)
#   • ⚡ Confluence — Orange cloud when daily + weekly level stack
#
#  VISUAL HIERARCHY:
#   Daily  lines — Curve.FIRM,      weight 2  (solid, prominent)
#   Weekly lines — Curve.LONG_DASH, weight 1  (dashed, secondary)
#   FL3 / Open   — Curve.SHORT_DASH, weight 1 (dotted, extension)
#   Confluence   — Orange cloud ± threshold/2 around stacked level
#
#  TOGGLE INPUTS:
#   showWeeklyLevels = no  → hides all weekly lines, bubbles, labels
#   showConfluence   = no  → disables confluence detection
#   sessionGating    = no  → lines run 24 hrs for Globex trading
# ═══════════════════════════════════════════════════════════════

declare upper;

# ── User Inputs ──────────────────────────────────────────────────
input showIP            = yes;
input showValueZone     = yes;
input showBullLines     = yes;
input showBearLines     = yes;
input showDVL           = yes;
input showOpen          = yes;
input showWeeklyLevels  = yes;
input showCornerLabels  = yes;
input showLineLabels    = yes;
input showConfluence    = yes;
input confluenceThreshold = 5.0;
input dvlLength         = 20;
input dvlAggregation    = AggregationPeriod.FIFTEEN_MIN;
input dvlType           = AverageType.EXPONENTIAL;
input sessionGating     = yes;
input sessionStartHHMM  = 0830;
input sessionEndHHMM    = 1500;

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

# ── Dynamic Value Line ───────────────────────────────────────────
def dvl = MovingAverage(dvlType, close(period = dvlAggregation), dvlLength);

# ── Session Gating ───────────────────────────────────────────────
def inSession = if sessionGating
                then SecondsFromTime(sessionStartHHMM) >= 0 and SecondsTillTime(sessionEndHHMM) >= 0
                else yes;

def lastInSession = inSession
                and BarNumber() == HighestAll(if inSession then BarNumber() else 0);

def lastBar = BarNumber() == HighestAll(BarNumber());

# ── Session Open ─────────────────────────────────────────────────
def sessionOpen = if SecondsFromTime(sessionStartHHMM) >= 0
                     and SecondsFromTime(sessionStartHHMM)[1] < 0
                 then open
                 else sessionOpen[1];

def openAboveBFL3  = sessionOpen > bFL3;
def openAboveBFL2  = sessionOpen > bFL2  and sessionOpen <= bFL3;
def openAboveBFL1  = sessionOpen > bFL1  and sessionOpen <= bFL2;
def openAboveUVL   = sessionOpen > UVL   and sessionOpen <= bFL1;
def openInValue    = sessionOpen >= LVL  and sessionOpen <= UVL;
def openBelowLVL   = sessionOpen < LVL   and sessionOpen >= beFL1;
def openBelowBEFL1 = sessionOpen < beFL1 and sessionOpen >= beFL2;
def openBelowBEFL2 = sessionOpen < beFL2 and sessionOpen >= beFL3;
def openBelowBEFL3 = sessionOpen < beFL3;

# ════════════════════════════════════════════════════════════════
#  CONFLUENCE DETECTION
#  Flags any daily FL level that stacks within confluenceThreshold
#  points of any weekly FL level. Works even if showWeeklyLevels=no.
# ════════════════════════════════════════════════════════════════

def _c = confluenceThreshold;

def IP_conf = showConfluence and (
    AbsValue(IP - wIP)    <= _c or AbsValue(IP - wUVL)   <= _c or AbsValue(IP - wLVL)   <= _c or
    AbsValue(IP - wBFL1)  <= _c or AbsValue(IP - wBFL2)  <= _c or AbsValue(IP - wBFL3)  <= _c or
    AbsValue(IP - wBEFL1) <= _c or AbsValue(IP - wBEFL2) <= _c or AbsValue(IP - wBEFL3) <= _c);

def UVL_conf = showConfluence and (
    AbsValue(UVL - wIP)    <= _c or AbsValue(UVL - wUVL)   <= _c or AbsValue(UVL - wLVL)   <= _c or
    AbsValue(UVL - wBFL1)  <= _c or AbsValue(UVL - wBFL2)  <= _c or AbsValue(UVL - wBFL3)  <= _c or
    AbsValue(UVL - wBEFL1) <= _c or AbsValue(UVL - wBEFL2) <= _c or AbsValue(UVL - wBEFL3) <= _c);

def LVL_conf = showConfluence and (
    AbsValue(LVL - wIP)    <= _c or AbsValue(LVL - wUVL)   <= _c or AbsValue(LVL - wLVL)   <= _c or
    AbsValue(LVL - wBFL1)  <= _c or AbsValue(LVL - wBFL2)  <= _c or AbsValue(LVL - wBFL3)  <= _c or
    AbsValue(LVL - wBEFL1) <= _c or AbsValue(LVL - wBEFL2) <= _c or AbsValue(LVL - wBEFL3) <= _c);

def bFL1_conf = showConfluence and (
    AbsValue(bFL1 - wIP)    <= _c or AbsValue(bFL1 - wUVL)   <= _c or AbsValue(bFL1 - wLVL)   <= _c or
    AbsValue(bFL1 - wBFL1)  <= _c or AbsValue(bFL1 - wBFL2)  <= _c or AbsValue(bFL1 - wBFL3)  <= _c or
    AbsValue(bFL1 - wBEFL1) <= _c or AbsValue(bFL1 - wBEFL2) <= _c or AbsValue(bFL1 - wBEFL3) <= _c);

def bFL2_conf = showConfluence and (
    AbsValue(bFL2 - wIP)    <= _c or AbsValue(bFL2 - wUVL)   <= _c or AbsValue(bFL2 - wLVL)   <= _c or
    AbsValue(bFL2 - wBFL1)  <= _c or AbsValue(bFL2 - wBFL2)  <= _c or AbsValue(bFL2 - wBFL3)  <= _c or
    AbsValue(bFL2 - wBEFL1) <= _c or AbsValue(bFL2 - wBEFL2) <= _c or AbsValue(bFL2 - wBEFL3) <= _c);

def bFL3_conf = showConfluence and (
    AbsValue(bFL3 - wIP)    <= _c or AbsValue(bFL3 - wUVL)   <= _c or AbsValue(bFL3 - wLVL)   <= _c or
    AbsValue(bFL3 - wBFL1)  <= _c or AbsValue(bFL3 - wBFL2)  <= _c or AbsValue(bFL3 - wBFL3)  <= _c or
    AbsValue(bFL3 - wBEFL1) <= _c or AbsValue(bFL3 - wBEFL2) <= _c or AbsValue(bFL3 - wBEFL3) <= _c);

def beFL1_conf = showConfluence and (
    AbsValue(beFL1 - wIP)    <= _c or AbsValue(beFL1 - wUVL)   <= _c or AbsValue(beFL1 - wLVL)   <= _c or
    AbsValue(beFL1 - wBFL1)  <= _c or AbsValue(beFL1 - wBFL2)  <= _c or AbsValue(beFL1 - wBFL3)  <= _c or
    AbsValue(beFL1 - wBEFL1) <= _c or AbsValue(beFL1 - wBEFL2) <= _c or AbsValue(beFL1 - wBEFL3) <= _c);

def beFL2_conf = showConfluence and (
    AbsValue(beFL2 - wIP)    <= _c or AbsValue(beFL2 - wUVL)   <= _c or AbsValue(beFL2 - wLVL)   <= _c or
    AbsValue(beFL2 - wBFL1)  <= _c or AbsValue(beFL2 - wBFL2)  <= _c or AbsValue(beFL2 - wBFL3)  <= _c or
    AbsValue(beFL2 - wBEFL1) <= _c or AbsValue(beFL2 - wBEFL2) <= _c or AbsValue(beFL2 - wBEFL3) <= _c);

def beFL3_conf = showConfluence and (
    AbsValue(beFL3 - wIP)    <= _c or AbsValue(beFL3 - wUVL)   <= _c or AbsValue(beFL3 - wLVL)   <= _c or
    AbsValue(beFL3 - wBFL1)  <= _c or AbsValue(beFL3 - wBFL2)  <= _c or AbsValue(beFL3 - wBFL3)  <= _c or
    AbsValue(beFL3 - wBEFL1) <= _c or AbsValue(beFL3 - wBEFL2) <= _c or AbsValue(beFL3 - wBEFL3) <= _c);

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

AddCloud(cIP_hi,    cIP_lo,    Color.ORANGE, Color.ORANGE);
AddCloud(cUVL_hi,   cUVL_lo,   Color.ORANGE, Color.ORANGE);
AddCloud(cLVL_hi,   cLVL_lo,   Color.ORANGE, Color.ORANGE);
AddCloud(cBFL1_hi,  cBFL1_lo,  Color.ORANGE, Color.ORANGE);
AddCloud(cBFL2_hi,  cBFL2_lo,  Color.ORANGE, Color.ORANGE);
AddCloud(cBFL3_hi,  cBFL3_lo,  Color.ORANGE, Color.ORANGE);
AddCloud(cBEFL1_hi, cBEFL1_lo, Color.ORANGE, Color.ORANGE);
AddCloud(cBEFL2_hi, cBEFL2_lo, Color.ORANGE, Color.ORANGE);
AddCloud(cBEFL3_hi, cBEFL3_lo, Color.ORANGE, Color.ORANGE);

# ════════════════════════════════════════════════════════════════
#  DAILY PLOTS  (Curve.FIRM, weight 2 — prominent)
# ════════════════════════════════════════════════════════════════

plot pIP = if showIP and inSession then IP else Double.NaN;
pIP.SetDefaultColor(Color.WHITE);
pIP.SetStyle(Curve.SHORT_DASH);
pIP.SetLineWeight(2);

plot pUVL = if showValueZone and inSession then UVL else Double.NaN;
pUVL.SetDefaultColor(Color.YELLOW);
pUVL.SetStyle(Curve.FIRM);
pUVL.SetLineWeight(2);

plot pLVL = if showValueZone and inSession then LVL else Double.NaN;
pLVL.SetDefaultColor(Color.YELLOW);
pLVL.SetStyle(Curve.FIRM);
pLVL.SetLineWeight(2);

plot pBFL1 = if showBullLines and inSession then bFL1 else Double.NaN;
pBFL1.SetDefaultColor(Color.GREEN);
pBFL1.SetStyle(Curve.FIRM);
pBFL1.SetLineWeight(2);

plot pBFL2 = if showBullLines and inSession then bFL2 else Double.NaN;
pBFL2.SetDefaultColor(Color.GREEN);
pBFL2.SetStyle(Curve.FIRM);
pBFL2.SetLineWeight(1);

plot pBFL3 = if showBullLines and inSession then bFL3 else Double.NaN;
pBFL3.SetDefaultColor(Color.GREEN);
pBFL3.SetStyle(Curve.SHORT_DASH);
pBFL3.SetLineWeight(1);

plot pBEFL1 = if showBearLines and inSession then beFL1 else Double.NaN;
pBEFL1.SetDefaultColor(Color.RED);
pBEFL1.SetStyle(Curve.FIRM);
pBEFL1.SetLineWeight(2);

plot pBEFL2 = if showBearLines and inSession then beFL2 else Double.NaN;
pBEFL2.SetDefaultColor(Color.RED);
pBEFL2.SetStyle(Curve.FIRM);
pBEFL2.SetLineWeight(1);

plot pBEFL3 = if showBearLines and inSession then beFL3 else Double.NaN;
pBEFL3.SetDefaultColor(Color.RED);
pBEFL3.SetStyle(Curve.SHORT_DASH);
pBEFL3.SetLineWeight(1);

plot pDVL = if showDVL and inSession then dvl else Double.NaN;
pDVL.SetDefaultColor(Color.CYAN);
pDVL.SetStyle(Curve.FIRM);
pDVL.SetLineWeight(2);

plot pOpen = if showOpen and inSession then sessionOpen else Double.NaN;
pOpen.SetDefaultColor(Color.MAGENTA);
pOpen.SetStyle(Curve.SHORT_DASH);
pOpen.SetLineWeight(1);

# ════════════════════════════════════════════════════════════════
#  WEEKLY PLOTS  (Curve.LONG_DASH, weight 1 — secondary layer)
# ════════════════════════════════════════════════════════════════

plot pWIP = if showWeeklyLevels then wIP else Double.NaN;
pWIP.SetDefaultColor(Color.WHITE);
pWIP.SetStyle(Curve.LONG_DASH);
pWIP.SetLineWeight(1);

plot pWUVL = if showWeeklyLevels then wUVL else Double.NaN;
pWUVL.SetDefaultColor(Color.YELLOW);
pWUVL.SetStyle(Curve.LONG_DASH);
pWUVL.SetLineWeight(1);

plot pWLVL = if showWeeklyLevels then wLVL else Double.NaN;
pWLVL.SetDefaultColor(Color.YELLOW);
pWLVL.SetStyle(Curve.LONG_DASH);
pWLVL.SetLineWeight(1);

plot pWBFL1 = if showWeeklyLevels and showBullLines then wBFL1 else Double.NaN;
pWBFL1.SetDefaultColor(Color.GREEN);
pWBFL1.SetStyle(Curve.LONG_DASH);
pWBFL1.SetLineWeight(1);

plot pWBFL2 = if showWeeklyLevels and showBullLines then wBFL2 else Double.NaN;
pWBFL2.SetDefaultColor(Color.GREEN);
pWBFL2.SetStyle(Curve.LONG_DASH);
pWBFL2.SetLineWeight(1);

plot pWBFL3 = if showWeeklyLevels and showBullLines then wBFL3 else Double.NaN;
pWBFL3.SetDefaultColor(Color.GREEN);
pWBFL3.SetStyle(Curve.LONG_DASH);
pWBFL3.SetLineWeight(1);

plot pWBEFL1 = if showWeeklyLevels and showBearLines then wBEFL1 else Double.NaN;
pWBEFL1.SetDefaultColor(Color.RED);
pWBEFL1.SetStyle(Curve.LONG_DASH);
pWBEFL1.SetLineWeight(1);

plot pWBEFL2 = if showWeeklyLevels and showBearLines then wBEFL2 else Double.NaN;
pWBEFL2.SetDefaultColor(Color.RED);
pWBEFL2.SetStyle(Curve.LONG_DASH);
pWBEFL2.SetLineWeight(1);

plot pWBEFL3 = if showWeeklyLevels and showBearLines then wBEFL3 else Double.NaN;
pWBEFL3.SetDefaultColor(Color.RED);
pWBEFL3.SetStyle(Curve.LONG_DASH);
pWBEFL3.SetLineWeight(1);

# ════════════════════════════════════════════════════════════════
#  DAILY LINE LABELS  (orange + ⚡ when in confluence)
# ════════════════════════════════════════════════════════════════
AddChartBubble(showLineLabels and showBullLines  and lastInSession, bFL3,
    (if bFL3_conf  then "⚡ " else "") + "B-FL3: "  + Round(bFL3,        2),
    if bFL3_conf  then Color.ORANGE else Color.GREEN, yes);
AddChartBubble(showLineLabels and showBullLines  and lastInSession, bFL2,
    (if bFL2_conf  then "⚡ " else "") + "B-FL2: "  + Round(bFL2,        2),
    if bFL2_conf  then Color.ORANGE else Color.GREEN, yes);
AddChartBubble(showLineLabels and showBullLines  and lastInSession, bFL1,
    (if bFL1_conf  then "⚡ " else "") + "B-FL1: "  + Round(bFL1,        2),
    if bFL1_conf  then Color.ORANGE else Color.GREEN, yes);
AddChartBubble(showLineLabels and showValueZone  and lastInSession, UVL,
    (if UVL_conf   then "⚡ " else "") + "UVL: "    + Round(UVL,         2),
    if UVL_conf   then Color.ORANGE else Color.YELLOW, yes);
AddChartBubble(showLineLabels and showValueZone  and lastInSession, LVL,
    (if LVL_conf   then "⚡ " else "") + "LVL: "    + Round(LVL,         2),
    if LVL_conf   then Color.ORANGE else Color.YELLOW, no);
AddChartBubble(showLineLabels and showIP         and lastInSession, IP,
    (if IP_conf    then "⚡ " else "") + "IP: "     + Round(IP,          2),
    if IP_conf    then Color.ORANGE else Color.WHITE, yes);
AddChartBubble(showLineLabels and showBearLines  and lastInSession, beFL1,
    (if beFL1_conf then "⚡ " else "") + "Be-FL1: " + Round(beFL1,       2),
    if beFL1_conf then Color.ORANGE else Color.RED, no);
AddChartBubble(showLineLabels and showBearLines  and lastInSession, beFL2,
    (if beFL2_conf then "⚡ " else "") + "Be-FL2: " + Round(beFL2,       2),
    if beFL2_conf then Color.ORANGE else Color.RED, no);
AddChartBubble(showLineLabels and showBearLines  and lastInSession, beFL3,
    (if beFL3_conf then "⚡ " else "") + "Be-FL3: " + Round(beFL3,       2),
    if beFL3_conf then Color.ORANGE else Color.RED, no);
AddChartBubble(showLineLabels and showDVL        and lastInSession, dvl,         "DVL: "    + Round(dvl,         2),
Color.CYAN,    yes);
AddChartBubble(showLineLabels and showOpen       and lastInSession, sessionOpen, "Open: "   + Round(sessionOpen, 2),
Color.MAGENTA, yes);

# ════════════════════════════════════════════════════════════════
#  WEEKLY LINE LABELS  (W- prefix, pin to rightmost bar)
# ════════════════════════════════════════════════════════════════
AddChartBubble(showLineLabels and showWeeklyLevels and showBullLines and lastBar, wBFL3,  "W-B-FL3: "  + Round(wBFL3,  2), Color.GREEN,  yes);
AddChartBubble(showLineLabels and showWeeklyLevels and showBullLines and lastBar, wBFL2,  "W-B-FL2: "  + Round(wBFL2,  2), Color.GREEN,  yes);
AddChartBubble(showLineLabels and showWeeklyLevels and showBullLines and lastBar, wBFL1,  "W-B-FL1: "  + Round(wBFL1,  2), Color.GREEN,  yes);
AddChartBubble(showLineLabels and showWeeklyLevels                   and lastBar, wUVL,   "W-UVL: "    + Round(wUVL,   2), Color.YELLOW, yes);
AddChartBubble(showLineLabels and showWeeklyLevels                   and lastBar, wIP,    "W-IP: "     + Round(wIP,    2), Color.WHITE,  yes);
AddChartBubble(showLineLabels and showWeeklyLevels                   and lastBar, wLVL,   "W-LVL: "    + Round(wLVL,   2), Color.YELLOW, no);
AddChartBubble(showLineLabels and showWeeklyLevels and showBearLines and lastBar, wBEFL1, "W-Be-FL1: " + Round(wBEFL1, 2), Color.RED,    no);
AddChartBubble(showLineLabels and showWeeklyLevels and showBearLines and lastBar, wBEFL2, "W-Be-FL2: " + Round(wBEFL2, 2), Color.RED,    no);
AddChartBubble(showLineLabels and showWeeklyLevels and showBearLines and lastBar, wBEFL3, "W-Be-FL3: " + Round(wBEFL3, 2), Color.RED,    no);

# ════════════════════════════════════════════════════════════════
#  CORNER LABELS
# ════════════════════════════════════════════════════════════════
AddLabel(showCornerLabels,                                "IP: "      + Round(IP,    2), Color.WHITE);
AddLabel(showCornerLabels and showValueZone,              "UVL: "     + Round(UVL,   2), Color.YELLOW);
AddLabel(showCornerLabels and showValueZone,              "LVL: "     + Round(LVL,   2), Color.YELLOW);
AddLabel(showCornerLabels and showBullLines,              "B-FL1: "   + Round(bFL1,  2), Color.GREEN);
AddLabel(showCornerLabels and showBullLines,              "B-FL2: "   + Round(bFL2,  2), Color.GREEN);
AddLabel(showCornerLabels and showBullLines,              "B-FL3: "   + Round(bFL3,  2), Color.GREEN);
AddLabel(showCornerLabels and showBearLines,              "Be-FL1: "  + Round(beFL1, 2), Color.RED);
AddLabel(showCornerLabels and showBearLines,              "Be-FL2: "  + Round(beFL2, 2), Color.RED);
AddLabel(showCornerLabels and showBearLines,              "Be-FL3: "  + Round(beFL3, 2), Color.RED);
AddLabel(showCornerLabels and showDVL,                   "DVL: "     + Round(dvl,   2), Color.CYAN);
AddLabel(showCornerLabels and showWeeklyLevels,          "W-IP: "    + Round(wIP,   2), Color.WHITE);
AddLabel(showCornerLabels and showWeeklyLevels,          "W-UVL: "   + Round(wUVL,  2), Color.YELLOW);
AddLabel(showCornerLabels and showWeeklyLevels,          "W-LVL: "   + Round(wLVL,  2), Color.YELLOW);
AddLabel(showCornerLabels and showWeeklyLevels and showBullLines, "W-B-FL1: "  + Round(wBFL1,  2), Color.GREEN);
AddLabel(showCornerLabels and showWeeklyLevels and showBullLines, "W-B-FL2: "  + Round(wBFL2,  2), Color.GREEN);
AddLabel(showCornerLabels and showWeeklyLevels and showBullLines, "W-B-FL3: "  + Round(wBFL3,  2), Color.GREEN);
AddLabel(showCornerLabels and showWeeklyLevels and showBearLines, "W-Be-FL1: " + Round(wBEFL1, 2), Color.RED);
AddLabel(showCornerLabels and showWeeklyLevels and showBearLines, "W-Be-FL2: " + Round(wBEFL2, 2), Color.RED);
AddLabel(showCornerLabels and showWeeklyLevels and showBearLines, "W-Be-FL3: " + Round(wBEFL3, 2), Color.RED);

AddLabel(showCornerLabels and showOpen,
    "Open: " + (if openAboveBFL3  then "above B-FL3"
           else if openAboveBFL2  then "B-FL2 to B-FL3"
           else if openAboveBFL1  then "B-FL1 to B-FL2"
           else if openAboveUVL   then "above UVL"
           else if openInValue    then "in value"
           else if openBelowLVL   then "below LVL"
           else if openBelowBEFL1 then "Be-FL1 to Be-FL2"
           else if openBelowBEFL2 then "Be-FL2 to Be-FL3"
           else                        "below Be-FL3"),
    if openAboveBFL3 or openAboveBFL2 or openAboveBFL1 or openAboveUVL then Color.GREEN
    else if openInValue then Color.YELLOW
    else Color.RED);

# ════════════════════════════════════════════════════════════════
#  CONFLUENCE CORNER LABELS
#  Summary count + one line per confluent daily level showing the
#  weekly level it stacks with (first match wins).
# ════════════════════════════════════════════════════════════════
def confCount = IP_conf + UVL_conf + LVL_conf + bFL1_conf + bFL2_conf + bFL3_conf +
                beFL1_conf + beFL2_conf + beFL3_conf;
AddLabel(showCornerLabels and showConfluence and confCount > 0,
    "⚡ " + confCount + (if confCount == 1 then " confluence" else " confluences"),
    Color.ORANGE);

AddLabel(showCornerLabels and showConfluence and IP_conf,
    "⚡ IP ↔ " + (if      AbsValue(IP - wIP)    <= _c then "W-IP"
                 else if AbsValue(IP - wUVL)   <= _c then "W-UVL"
                 else if AbsValue(IP - wLVL)   <= _c then "W-LVL"
                 else if AbsValue(IP - wBFL1)  <= _c then "W-B-FL1"
                 else if AbsValue(IP - wBFL2)  <= _c then "W-B-FL2"
                 else if AbsValue(IP - wBFL3)  <= _c then "W-B-FL3"
                 else if AbsValue(IP - wBEFL1) <= _c then "W-Be-FL1"
                 else if AbsValue(IP - wBEFL2) <= _c then "W-Be-FL2"
                 else                                     "W-Be-FL3"),
    Color.ORANGE);

AddLabel(showCornerLabels and showConfluence and UVL_conf,
    "⚡ UVL ↔ " + (if      AbsValue(UVL - wIP)    <= _c then "W-IP"
                  else if AbsValue(UVL - wUVL)   <= _c then "W-UVL"
                  else if AbsValue(UVL - wLVL)   <= _c then "W-LVL"
                  else if AbsValue(UVL - wBFL1)  <= _c then "W-B-FL1"
                  else if AbsValue(UVL - wBFL2)  <= _c then "W-B-FL2"
                  else if AbsValue(UVL - wBFL3)  <= _c then "W-B-FL3"
                  else if AbsValue(UVL - wBEFL1) <= _c then "W-Be-FL1"
                  else if AbsValue(UVL - wBEFL2) <= _c then "W-Be-FL2"
                  else                                      "W-Be-FL3"),
    Color.ORANGE);

AddLabel(showCornerLabels and showConfluence and LVL_conf,
    "⚡ LVL ↔ " + (if      AbsValue(LVL - wIP)    <= _c then "W-IP"
                  else if AbsValue(LVL - wUVL)   <= _c then "W-UVL"
                  else if AbsValue(LVL - wLVL)   <= _c then "W-LVL"
                  else if AbsValue(LVL - wBFL1)  <= _c then "W-B-FL1"
                  else if AbsValue(LVL - wBFL2)  <= _c then "W-B-FL2"
                  else if AbsValue(LVL - wBFL3)  <= _c then "W-B-FL3"
                  else if AbsValue(LVL - wBEFL1) <= _c then "W-Be-FL1"
                  else if AbsValue(LVL - wBEFL2) <= _c then "W-Be-FL2"
                  else                                      "W-Be-FL3"),
    Color.ORANGE);

AddLabel(showCornerLabels and showConfluence and bFL1_conf,
    "⚡ B-FL1 ↔ " + (if      AbsValue(bFL1 - wIP)    <= _c then "W-IP"
                    else if AbsValue(bFL1 - wUVL)   <= _c then "W-UVL"
                    else if AbsValue(bFL1 - wLVL)   <= _c then "W-LVL"
                    else if AbsValue(bFL1 - wBFL1)  <= _c then "W-B-FL1"
                    else if AbsValue(bFL1 - wBFL2)  <= _c then "W-B-FL2"
                    else if AbsValue(bFL1 - wBFL3)  <= _c then "W-B-FL3"
                    else if AbsValue(bFL1 - wBEFL1) <= _c then "W-Be-FL1"
                    else if AbsValue(bFL1 - wBEFL2) <= _c then "W-Be-FL2"
                    else                                       "W-Be-FL3"),
    Color.ORANGE);

AddLabel(showCornerLabels and showConfluence and bFL2_conf,
    "⚡ B-FL2 ↔ " + (if      AbsValue(bFL2 - wIP)    <= _c then "W-IP"
                    else if AbsValue(bFL2 - wUVL)   <= _c then "W-UVL"
                    else if AbsValue(bFL2 - wLVL)   <= _c then "W-LVL"
                    else if AbsValue(bFL2 - wBFL1)  <= _c then "W-B-FL1"
                    else if AbsValue(bFL2 - wBFL2)  <= _c then "W-B-FL2"
                    else if AbsValue(bFL2 - wBFL3)  <= _c then "W-B-FL3"
                    else if AbsValue(bFL2 - wBEFL1) <= _c then "W-Be-FL1"
                    else if AbsValue(bFL2 - wBEFL2) <= _c then "W-Be-FL2"
                    else                                       "W-Be-FL3"),
    Color.ORANGE);

AddLabel(showCornerLabels and showConfluence and bFL3_conf,
    "⚡ B-FL3 ↔ " + (if      AbsValue(bFL3 - wIP)    <= _c then "W-IP"
                    else if AbsValue(bFL3 - wUVL)   <= _c then "W-UVL"
                    else if AbsValue(bFL3 - wLVL)   <= _c then "W-LVL"
                    else if AbsValue(bFL3 - wBFL1)  <= _c then "W-B-FL1"
                    else if AbsValue(bFL3 - wBFL2)  <= _c then "W-B-FL2"
                    else if AbsValue(bFL3 - wBFL3)  <= _c then "W-B-FL3"
                    else if AbsValue(bFL3 - wBEFL1) <= _c then "W-Be-FL1"
                    else if AbsValue(bFL3 - wBEFL2) <= _c then "W-Be-FL2"
                    else                                       "W-Be-FL3"),
    Color.ORANGE);

AddLabel(showCornerLabels and showConfluence and beFL1_conf,
    "⚡ Be-FL1 ↔ " + (if      AbsValue(beFL1 - wIP)    <= _c then "W-IP"
                     else if AbsValue(beFL1 - wUVL)   <= _c then "W-UVL"
                     else if AbsValue(beFL1 - wLVL)   <= _c then "W-LVL"
                     else if AbsValue(beFL1 - wBFL1)  <= _c then "W-B-FL1"
                     else if AbsValue(beFL1 - wBFL2)  <= _c then "W-B-FL2"
                     else if AbsValue(beFL1 - wBFL3)  <= _c then "W-B-FL3"
                     else if AbsValue(beFL1 - wBEFL1) <= _c then "W-Be-FL1"
                     else if AbsValue(beFL1 - wBEFL2) <= _c then "W-Be-FL2"
                     else                                        "W-Be-FL3"),
    Color.ORANGE);

AddLabel(showCornerLabels and showConfluence and beFL2_conf,
    "⚡ Be-FL2 ↔ " + (if      AbsValue(beFL2 - wIP)    <= _c then "W-IP"
                     else if AbsValue(beFL2 - wUVL)   <= _c then "W-UVL"
                     else if AbsValue(beFL2 - wLVL)   <= _c then "W-LVL"
                     else if AbsValue(beFL2 - wBFL1)  <= _c then "W-B-FL1"
                     else if AbsValue(beFL2 - wBFL2)  <= _c then "W-B-FL2"
                     else if AbsValue(beFL2 - wBFL3)  <= _c then "W-B-FL3"
                     else if AbsValue(beFL2 - wBEFL1) <= _c then "W-Be-FL1"
                     else if AbsValue(beFL2 - wBEFL2) <= _c then "W-Be-FL2"
                     else                                        "W-Be-FL3"),
    Color.ORANGE);

AddLabel(showCornerLabels and showConfluence and beFL3_conf,
    "⚡ Be-FL3 ↔ " + (if      AbsValue(beFL3 - wIP)    <= _c then "W-IP"
                     else if AbsValue(beFL3 - wUVL)   <= _c then "W-UVL"
                     else if AbsValue(beFL3 - wLVL)   <= _c then "W-LVL"
                     else if AbsValue(beFL3 - wBFL1)  <= _c then "W-B-FL1"
                     else if AbsValue(beFL3 - wBFL2)  <= _c then "W-B-FL2"
                     else if AbsValue(beFL3 - wBFL3)  <= _c then "W-B-FL3"
                     else if AbsValue(beFL3 - wBEFL1) <= _c then "W-Be-FL1"
                     else if AbsValue(beFL3 - wBEFL2) <= _c then "W-Be-FL2"
                     else                                        "W-Be-FL3"),
    Color.ORANGE);

# ════════════════════════════════════════════════════════════════
#  ALERTS
# ════════════════════════════════════════════════════════════════
Alert(inSession and close crosses above IP,  "FireLines: Above IP — bull bias",   Alert.BAR, Sound.Ding);
Alert(inSession and close crosses below IP,  "FireLines: Below IP — bear bias",   Alert.BAR, Sound.Ring);
Alert(inSession and close crosses above dvl, "FireLines: Above DVL — trend up",   Alert.BAR, Sound.Bell);
Alert(inSession and close crosses below dvl, "FireLines: Below DVL — trend down", Alert.BAR, Sound.Bell);

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

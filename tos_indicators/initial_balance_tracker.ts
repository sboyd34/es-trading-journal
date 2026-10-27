# InitialBalanceTracker v2
# Tracks the Initial Balance (first 60 min of RTH) high/low and reports it
# via labels only -- no chart plots -- then compares the IB range to the
# average RTH range to flag likely day type.
#
# Standalone on purpose -- kept separate from ATRRiskSizer so IB tracking
# never touches the code that governs stop/size on live trades.
#
# ── v2: the denominator was wrong, and wrong in a way that never showed ──
#
# v1 copied the hand-rolled ATR straight out of ATRRiskSizer, with a comment
# justifying it as "kept identical on purpose so both studies are reading the
# same number." That is exactly backwards. These two studies MUST NOT read
# the same number:
#
#   ATRRiskSizer needs a CHART-BAR ATR. It sizes a stop on the execution
#   timeframe, so a 14-bar 5m ATR (~2.5 pts on ES) is the correct input, and
#   its own comments reason in those units ("ATR 1.2 at divisor 2.0").
#
#   A day-type read needs a SESSION-SCALE denominator. Dividing a 60-minute
#   IB (~18 pts) by a 5m ATR (~2.5 pts) yields 7.2, not 0.45 -- so ibRatio
#   cleared v1's rotationThreshold of 0.8 by 2-9x on every intraday chart.
#   "ROTATION LIKELY" printed every single session; EXPANSION and NEUTRAL
#   were unreachable code. The label stayed plausible the entire time, which
#   is why staring at the chart would never have surfaced it. The fault was
#   dimensional (RTH minutes over 5-minute bars), not syntactic -- it passed
#   every check in the gotchas file and still answered the same thing daily.
#
# Why average RTH range and not a daily ATR: with Extended Hours on, the TOS
# daily candle for /ES spans the full Globex session (17:00->16:00), and ES
# Globex range runs ~1.3-1.6x the RTH range. Dividing an RTH-only IB by a
# 24-hour denominator deflates the ratio 30-40% and lands in the mirror image
# of the v1 bug -- "EXPANSION LIKELY" every day instead. The IB is an RTH
# construct and the question it answers ("is there room left in the session")
# is an RTH question, so the denominator is the average RTH range.
#
# Bonus from that choice: no secondary aggregation anywhere in this study.
# No HTF series, no HTF [1] offsets, so the entire Liquidity_Map_v3 class of
# bug is unreachable rather than merely avoided.
#
# Thresholds are the Market Profile thirds pulled in slightly, NOT backtested
# cutoffs. Canon measures IB against the day's OWN realized range, which is
# retrospective and bounded at 1.0; this divides by a trailing average, so the
# distribution is wider and can exceed 1.0 on an outlier. The labels print IB
# points, the average range, the ratio, and -- at the close -- the realized
# range, so journaling the predicted/actual pair is free. Trust your own read
# over the EXPANSION/ROTATION flag until a few weeks of that data exists.
#
# The locked IB label stays visible past 09:30 and through the evening
# Globex session -- the most recent completed IB is worth referencing
# overnight -- and self-clears after midnight, when SecondsTillTime(nyIBEnd)
# flips positive again. v2 shipped that carry UNLABELED and called it
# cosmetic; it was not. See the ibYMD block below: the label now stamps
# the session date it measured, so a Friday IB can never pass for a live
# one on a Sunday-evening chart.

# ── THESE FOUR ARE NEW YORK (EASTERN) CLOCK TIMES ───────────────────
# Not Central, and NOT the chart's display timezone. That second claim was
# the long-running bug in this file, and it was wrong twice over.
#
# MEASURED on this install, 10/26/26, chart axis confirmed Central:
#
#   SecondsFromTime(0830) fires when the chart reads 07:30 CT.
#
# Three independent confirmations, all agreeing on a one-hour lead:
#   - IB  with 0830/0930 printed 17.25 pts = exactly 07:30-08:30 CT
#   - RTH with 0830/1500 printed 64.00 pts = exactly 07:30-14:00 CT
#   - a third-party study's RTH label shifted by the same hour, while its
#     Globex-anchored DayR label was correct -- so the offset is platform-
#     wide and hits wall-clock windows only, not this study's logic.
#
# The system timezone is CST and the chart axis is Central (verified by
# matching the 3:45 PM bar's full OHLC against known CT bars -- all four
# values matched 15:45 CT, none matched 14:45 CT). The chart renderer and
# the script engine are reading different clocks, and ThinkScript cannot
# read either one back to compensate. So stop trying to: the engine wants
# Eastern, so these inputs are DECLARED in Eastern.
#
# That turns out to be the honest unit anyway. The IB is the first hour of
# the NEW YORK session, and New York opens at 9:30 -- so 0930/1030 is the
# window written in the same numbers anyone would say it out loud in. The
# old 0830 default was a Central translation of an Eastern fact, and the
# translation is what broke.
#
# DO NOT "fix" these back to 0830 to match the Central chart axis. The axis
# is not what SecondsFromTime reads. Verify against the [930-1030] echo on
# the locked label instead: if the bracket and the prices disagree with the
# 08:30-09:30 CT tape, THEN the offset has changed and these need revisiting.
#
# Renamed from ibStart/ibEnd/rthStart/rthEnd deliberately. TOS persists input
# values per applied study instance and re-pasting the source does NOT reset
# them to new file defaults -- three fix attempts appeared to do nothing for
# exactly that reason. A changed input NAME has no persisted value to inherit,
# so the new defaults actually take effect on re-apply.
declare upper;

input nyIBStart  = 0930;   # NY cash open, EASTERN (see block above)
input nyIBEnd    = 1030;   # 60-minute IB. Change both together.

input nyRTHStart = 0930;   # RTH session bounds -- the range denominator
input nyRTHEnd   = 1600;

input rangeLength = 14;   # sessions in the average RTH range (Wilder)

input expansionThreshold = 0.35;  # IB/avgRange below this -> EXPANSION LIKELY
input rotationThreshold  = 0.65;  # IB/avgRange above this -> ROTATION LIKELY

input maxAggregation    = AggregationPeriod.FIFTEEN_MIN;
input showRealizedRange = yes;

# Clamp the input that sits under a division, same as ATRRiskSizer does for
# stopATRDivisor. rangeLength = 0 would divide by zero in the Wilder step,
# and a NaN there poisons every label downstream.
def smoothLen = if rangeLength >= 1 then rangeLength else 14;

# ── Chart-period guard ──────────────────────────────────────────────
# A 60-minute IB is one bar on a 1H chart and meaningless on a daily, where
# the SecondsFromTime() window no longer slices anything. Name the condition
# rather than render a confident ratio built from a single data point.
def aggOK = GetAggregationPeriod() <= maxAggregation;

# ── Initial Balance ─────────────────────────────────────────────────
# Seeded on the first bar of the WINDOW, not on the date roll.
#
# v1 reset on `GetYYYYMMDD() != GetYYYYMMDD()[1]`, reasoning that the
# electronic session rolls the trading date well before nyIBStart. True with
# Extended Hours ON. With ETH OFF the first bar of the chart day IS 08:30, so
# newDay and inIB fired on the same bar, the reset branch won, ibHigh went
# NaN, and the window seeded from the SECOND bar -- discarding the opening
# bar, which is usually where the IB extreme lives. Seeding on the window
# edge is correct with ETH either way, which also retires this study's
# dependence on the ETH toggle.
def inIB   = SecondsFromTime(nyIBStart) >= 0 and SecondsTillTime(nyIBEnd) > 0;
def ibOpen = inIB and !inIB[1];
def ibDone = SecondsTillTime(nyIBEnd) <= 0 and SecondsFromTime(nyIBStart) >= 0;

# CompoundValue-seeded rather than NaN-initialised. Every branch below is
# self-referential, so a NaN arriving on bar 1 could never be flushed back
# out -- the ratio would stay NaN and TOS would silently render the whole
# study blank. Readiness is tracked by COUNTING windows, never by IsNaN on a
# recursive def, which zero-inits and so can never hold NaN to test for.
def ibHigh = CompoundValue(1,
                 if ibOpen then high
                 else if inIB then Max(ibHigh[1], high)
                 else ibHigh[1], high);

def ibLow = CompoundValue(1,
                if ibOpen then low
                else if inIB then Min(ibLow[1], low)
                else ibLow[1], low);

def ibCount = CompoundValue(1, if ibOpen then ibCount[1] + 1 else ibCount[1], 0);

def ibReady  = ibCount >= 1;
def ibLocked = ibReady and ibDone;
def ibRange  = ibHigh - ibLow;

# ── Which session does that IB belong to? ───────────────────────────
# ibDone is `past 09:30 and past 08:30`, and SecondsFromTime is
# CALENDAR-day relative (Liquidity_Map_v4:278 has to write the overnight
# window as an `or` for exactly this reason). So ibDone is true on every
# bar after 09:30 of every calendar day -- through the 17:00 Globex roll,
# past midnight, all weekend, holidays included. ibHigh/ibLow carry
# forward untouched across all of it.
#
# That carry is intentional and still useful, but v2 shipped it unlabeled:
# on a Sunday-evening chart a Friday IB rendered identically to a live
# one, beside live price. The values were never malformed -- they were
# unattributed, which is indistinguishable from wrong. Latch the date at
# ibOpen so the label always names the session it measured.
#
# GetYYYYMMDD() is the only date built-in proven in a third-party study
# on this install (supply_demand_zones_v2:335, ES_RTH..CONFLUENCE:98), so
# MM/DD is derived from it with Floor and subtraction. GetMonth() and
# GetDayOfMonth() appear in zero third-party files here, which per the
# gotchas process lesson makes them unverified, not available.
def ibYMD = CompoundValue(1,
                if ibOpen then GetYYYYMMDD() else ibYMD[1], GetYYYYMMDD());

def ibMMDD  = ibYMD - Floor(ibYMD / 10000) * 10000;
def ibMonth = Floor(ibMMDD / 100);
def ibDay   = ibMMDD - ibMonth * 100;

# ── Average RTH range: the denominator ──────────────────────────────
def inRTH   = SecondsFromTime(nyRTHStart) >= 0 and SecondsTillTime(nyRTHEnd) > 0;
def rthOpen = inRTH and !inRTH[1];
def rthDone = SecondsTillTime(nyRTHEnd) <= 0 and SecondsFromTime(nyRTHStart) >= 0;

def rthHigh = CompoundValue(1,
                  if rthOpen then high
                  else if inRTH then Max(rthHigh[1], high)
                  else rthHigh[1], high);

def rthLow = CompoundValue(1,
                 if rthOpen then low
                 else if inRTH then Min(rthLow[1], low)
                 else rthLow[1], low);

# The completed prior session's range, latched one bar into the new session.
# rthHigh/rthLow only advance inside RTH and carry forward outside it, so at
# the rthOpen bar rthHigh[1] is the prior session's final high whether
# Extended Hours is ON (previous bar is an overnight bar holding the carried
# value) or OFF (previous bar is the prior 15:00 close). One formulation,
# both chart modes -- same reason the IB now seeds on the window edge.
def lastRange = CompoundValue(1,
                    if rthOpen then rthHigh[1] - rthLow[1] else lastRange[1], 0);

def sessCount = CompoundValue(1,
                    if rthOpen then sessCount[1] + 1 else sessCount[1], 0);

# sessCount ticks at each RTH open, and the first latch lands at the SECOND
# open, so completed-and-measured sessions = count - 1.
def samples = Max(sessCount - 1, 0);

# Wilder smoothing advanced ONCE PER SESSION ROLL. Average(lastRange, 14)
# would average 14 CHART bars -- 70 minutes on a 5m chart, not 14 sessions.
# This is the Liquidity_Map_v4 pattern, and the bug it sidesteps is the one
# that made v3's "ATR" silently read as "today's range so far."
def avgRange = CompoundValue(1,
                   if samples <= 1 then lastRange
                   else if rthOpen then
                       (avgRange[1] * (smoothLen - 1) + lastRange) / smoothLen
                   else avgRange[1], 0);

def rangeOK  = samples >= 3 and avgRange > 0;
def fullWarm = samples >= smoothLen;

def ibRatio = if ibLocked and rangeOK then ibRange / avgRange else Double.NaN;
def ratioOK = ibLocked and rangeOK and !IsNaN(ibRatio);

# ── Labels ──────────────────────────────────────────────────────────
# One label, one CONSTANT colour, with the branch pushed into each label's
# visibility flag. A branched expression in the colour slot resolves to
# unset=black and renders unreadable text; a deep if/else cascade in the
# text slot renders nothing at all. Both fail without a compile error.
AddLabel(!aggOK,
    "  IB TRACKER OFF - chart period too coarse; use 15m or faster  ",
    Color.ORANGE);

# The window is echoed on this label on purpose, and the echo is what finally
# caught the bug. SecondsFromTime() does NOT resolve HHMM against the chart's
# display timezone -- that was gotchas #2 and it is wrong on this install. The
# chart axis is Central while the engine resolves Eastern, so 0830 silently
# sliced 07:30-08:30 CT, the hour BEFORE the cash open, and rendered a
# perfectly plausible ~17 pt IB from it. On 2026-10-26 the label read
# 7675.50-7692.75 when the real first NY hour was 7677.00-7719.50 (42.5 pts),
# and the RTH inputs were off by the same hour, so the ratio was wrong in BOTH
# terms -- 17/80 instead of 42.5/80, which inverts the day-type call.
#
# An unattributed price is indistinguishable from a correct one. Echoing the
# window turns "the number looks wrong" into "the number is right about the
# wrong hour," which is a one-glance diagnosis instead of a tape scan.
#
# Printing raw HHMM is deliberate: AsTime() appears in zero third-party
# studies on this install, so it is unverified, not available. 930 is uglier
# than 9:30 and cannot fail.
AddLabel(aggOK and inIB,
    "  IB FORMING " + Round(nyIBStart, 0) + "-" + Round(nyIBEnd, 0) +
    " NY  ", Color.YELLOW);

# The window is echoed HERE too, not only on the forming label above.
#
# The forming label is gated on `inIB`, so it vanishes the moment the IB
# closes -- which means from 09:30 until midnight, the only label on the
# chart is this one, and it reported two prices with no statement of what
# window produced them. That is the same unattributed-value defect the date
# stamp was added to fix, one field short: the label named its SESSION but
# not its WINDOW, so the engine's 07:30-08:30 CT slice rendered as
# "IB 10/26 7675.50-7692.75" -- correct-looking, correctly dated, and an
# hour early. Costly in practice: it took a yfinance scan of the real tape
# to recover a fact the label already had in hand and declined to print.
#
# Reads: IB 10/26 [930-1030] 7677.00-7719.50 (43 pts)
# The bracketed pair is the raw HHMM this study was HANDED, in NY/Eastern.
# It is the first thing to read when a price looks wrong: a stale bracket
# means TOS kept a persisted input and the new default never landed, which
# is a different problem than a miscomputed window and has a different fix.
#
# AsText() for the two price LEVELS only -- they are genuinely fractional
# (quarter-point ticks), which is the one case AsText is right for. Every
# other number here concatenates Round(x, 0): AsText always prints two
# decimals, so it can never render a clean whole number, and there is no
# NumberFormat.NO_DECIMALS to ask for one. Each concatenation also leads
# with a string literal, so the first + is never ambiguous with arithmetic.
AddLabel(aggOK and ibLocked,
    "  IB " + Round(ibMonth, 0) + "/" + Round(ibDay, 0) +
    " [" + Round(nyIBStart, 0) + "-" + Round(nyIBEnd, 0) + "]  " +
    AsText(ibLow) + "-" + AsText(ibHigh) +
    " (" + Round(ibRange, 0) + " pts)  ",
    Color.WHITE);

AddLabel(aggOK and ratioOK,
    "  RTH avg " + Round(avgRange, 0) + " pts over " + Round(samples, 0) +
    " sess | IB/RNG " + Round(ibRatio * 100, 0) + "%  ",
    Color.GRAY);

# Two honesty labels. The denominator is built from chart bars, so a short
# chart range starves it -- and unlike an HTF NaN, that cause is nameable.
AddLabel(aggOK and ibLocked and !rangeOK,
    "  NO DAY-TYPE READ - need 3+ prior RTH sessions loaded  ",
    Color.ORANGE);

AddLabel(aggOK and ratioOK and !fullWarm,
    "  AVG WARMING UP - " + Round(samples, 0) + " of " +
    Round(smoothLen, 0) + " sessions  ",
    Color.ORANGE);

AddLabel(aggOK and ratioOK and ibRatio <= expansionThreshold,
    "  EXPANSION LIKELY  ", Color.GREEN);

AddLabel(aggOK and ratioOK and ibRatio >= rotationThreshold,
    "  ROTATION LIKELY  ", Color.RED);

AddLabel(aggOK and ratioOK and ibRatio > expansionThreshold
         and ibRatio < rotationThreshold,
    "  NEUTRAL  ", Color.GRAY);

# The journal pair: what the IB implied, and what the session actually did.
# Shown from the RTH close so the realized number is final, not developing.
def realized = rthHigh - rthLow;

AddLabel(showRealizedRange and aggOK and rthDone and ibLocked and realized > 0,
    "  REALIZED " + Round(realized, 0) + " pts | IB was " +
    Round(ibRange / realized * 100, 0) + "% of it  ",
    Color.CYAN);

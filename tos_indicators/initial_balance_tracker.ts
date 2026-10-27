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
# overnight -- and self-clears after midnight, when SecondsFromTime(ibEndCT)
# flips positive again. v2 shipped that carry UNLABELED and called it
# cosmetic; it was not. See the ibYMD block below: the label now stamps
# the session date it measured, so a Friday IB can never pass for a live
# one on a Sunday-evening chart.

# ── EVERY TIME IN THIS STUDY IS CENTRAL ─────────────────────────────
# You type Central, you read Central, the labels print Central. The one-hour
# correction this install needs lives in exactly one place -- engineOffsetHours
# -- and nothing else in the file knows about it.
#
# THE PROBLEM. SecondsFromTime() does NOT resolve HHMM against the chart's
# display timezone. That was the old claim in this file (and in the gotchas
# notes) and it is false on this install. Measured 10/26/26:
#
#   SecondsFromTime(0830) returns 0 when the chart reads 07:30 CT.
#
# Three independent confirmations of the one-hour lead:
#   - IB  with 0830/0930 printed 17.25 pts = exactly 07:30-08:30 CT
#   - RTH with 0830/1500 printed 64.00 pts = exactly 07:30-14:00 CT
#   - a third-party study's wall-clock RTH label shifted by the same hour
#     while its Globex-anchored DayR label stayed correct -- so the offset is
#     platform-wide, hits wall-clock windows only, and is not our bug.
#
# The system timezone is CST and the chart axis is provably Central (the
# 3:45 PM bar's full OHLC matched 15:45 CT on all four values and 14:45 CT on
# none). The chart renderer and the script engine are reading different clocks
# and ThinkScript cannot read either one back to compensate for it.
#
# THE FIX, AND WHY IT IS NOT WHAT YOU'D EXPECT. The obvious move is to shift
# the input -- hand SecondsFromTime(0930) and let it land on 08:30 CT. Do not
# do that. SecondsFromTime's parameter has never been proven to accept a
# computed value on this install, and gotchas #6/#8a establish that
# constant-ness is declared PER FUNCTION ("assume constant-required until
# proven otherwise"). Highest/Lowest reject a dynamic length outright, and
# the failure mode for this class of mistake is a SILENTLY BLANK study, which
# is indistinguishable from the save-vs-apply trap.
#
# So the HHMM arguments below stay plain `input` literals -- the exact form
# proven to work -- and the correction moves to the OTHER side of the
# comparison. SecondsFromTime returns seconds elapsed since its argument, so
# "08:30 CT" is simply "3600 seconds past the engine's 0830":
#
#   def inIB = SecondsFromTime(ibStartCT) >= shiftSec and ...
#
# shiftSec is a def, but it is only ever compared against a number. No
# constant-ness exposure anywhere.
#
# Both window ends now use SecondsFromTime rather than mixing in
# SecondsTillTime, because SecondsTillTime(t) == -SecondsFromTime(t) and the
# shift has to apply identically to both edges. One function, one sign
# convention, one offset.
#
# Renamed from ibStart/ibEnd/rthStart/rthEnd deliberately. TOS persists input
# values per applied study instance and re-pasting the source does NOT reset
# them to new file defaults -- three fix attempts appeared to do nothing for
# exactly that reason. A changed input NAME has no persisted value to inherit,
# so the new defaults actually take effect on re-apply.
declare upper;

input ibStartCT  = 0830;   # cash open, CENTRAL. The first 60 min of NY.
input ibEndCT    = 0930;   # Change both together.

input rthStartCT = 0830;   # RTH session bounds -- the range denominator
input rthEndCT   = 1500;

# The single knob that absorbs the renderer/engine clock split. 1 is the
# MEASURED value on this install, not a guess. Central and Eastern observe
# DST on the same dates, so the gap is exactly one hour year-round -- this
# does not need seasonal adjustment.
#
# Set to 0 if SecondsFromTime ever starts resolving Central (e.g. a TOS
# update, or a platform timezone setting changing underneath this). The tell
# that it has: flip showWindow = yes, and if the bracket's Central window no
# longer matches the Central prices on the tape, this number is stale.
input engineOffsetHours = 1;

input rangeLength = 14;   # sessions in the average RTH range (Wilder)

input expansionThreshold = 0.35;  # IB/avgRange below this -> EXPANSION LIKELY
input rotationThreshold  = 0.65;  # IB/avgRange above this -> ROTATION LIKELY

input maxAggregation    = AggregationPeriod.FIFTEEN_MIN;
input showRealizedRange = yes;

# Off by default -- the clean label is the one worth staring at all session.
# Flip to yes only when a price looks wrong. It appends the window this study
# was HANDED, in Central, which separates two failures that look identical
# on a clean label: a stale persisted input (bracket reads the old window) from
# a miscomputed range (bracket is right, prices are not). Finding that out the
# hard way took three fix attempts and a scan of the real tape, so the echo
# stays in the file -- just not in the way.
input showWindow        = no;

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
# electronic session rolls the trading date well before ibStartCT. True with
# Extended Hours ON. With ETH OFF the first bar of the chart day IS 08:30, so
# newDay and inIB fired on the same bar, the reset branch won, ibHigh went
# NaN, and the window seeded from the SECOND bar -- discarding the opening
# bar, which is usually where the IB extreme lives. Seeding on the window
# edge is correct with ETH either way, which also retires this study's
# dependence on the ETH toggle.
def shiftSec = engineOffsetHours * 3600;

def inIB   = SecondsFromTime(ibStartCT) >= shiftSec
         and SecondsFromTime(ibEndCT)   <  shiftSec;
def ibOpen = inIB and !inIB[1];

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

# "A window has completed" is `we have seen one AND we are not inside one`.
# Note what is NOT in that sentence: any reference to the clock.
#
# v2 wrote this as `ibReady and ibDone`, where ibDone was
# `SecondsFromTime(ibEndCT) >= shiftSec and SecondsFromTime(ibStartCT) >=
# shiftSec`. SecondsFromTime is CALENDAR-day relative (Liquidity_Map_v4:278
# has to write the overnight window as an `or` for exactly this reason), so
# BOTH terms went negative at the engine's midnight and ibDone stayed false
# until 09:30 the next morning -- a 10.5-hour hole covering all of Globex.
#
# MEASURED 10/27/26 08:27 CT: the study rendered ZERO labels. Every
# AddLabel here is gated on inIB, ibLocked, ratioOK, rthDone or !aggOK, and
# all five were false at once, which on screen is indistinguishable from a
# study that failed to load. That measurement also disproves the v2 comment
# claiming ibDone survived "past midnight, all weekend" -- it does not.
#
# !inIB has no such hole, and it makes inIB and ibLocked mutually exclusive
# by construction rather than by flag discipline (gotcha #3).
def ibLocked = ibReady and !inIB;
def ibRange  = ibHigh - ibLow;

# ── Which session does that IB belong to? ───────────────────────────
# ibHigh/ibLow carry forward untouched through the 17:00 Globex roll, past
# midnight, all weekend, holidays included. Gating on !inIB is what finally
# lets that carry render instead of blanking overnight.
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
def inRTH   = SecondsFromTime(rthStartCT) >= shiftSec
          and SecondsFromTime(rthEndCT)   <  shiftSec;
def rthOpen = inRTH and !inRTH[1];
def rthDone = SecondsFromTime(rthEndCT)   >= shiftSec
          and SecondsFromTime(rthStartCT) >= shiftSec;

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
#
# Two AddLabel calls with mutually exclusive flags, NOT one call with an
# if/else in the text slot. A branched text expression renders as nothing at
# all and does it without a compile error -- same reason the day-type flags
# below are three separate labels instead of one cascade.
AddLabel(aggOK and inIB and !showWindow,
    "  IB FORMING  ", Color.YELLOW);

AddLabel(aggOK and inIB and showWindow,
    "  IB FORMING " + Round(ibStartCT, 0) + "-" + Round(ibEndCT, 0) +
    " CT  ", Color.YELLOW);

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
# Reads: IB 10/26  7677.00-7719.50 (43 pts)
# ...and with showWindow = yes, the window is spliced in:
#         IB 10/26 [830-930] 7677.00-7719.50 (43 pts)
#
# The DATE stamp is unconditional and stays that way. It is not decoration:
# this label survives past the IB close and through the evening Globex
# session, so without it a Friday IB reads as a live one on a Sunday-evening
# chart. The window echo is optional because a wrong window is rare; the
# stale carry is nightly.
#
# AsText() for the two price LEVELS only -- they are genuinely fractional
# (quarter-point ticks), which is the one case AsText is right for. Every
# other number here concatenates Round(x, 0): AsText always prints two
# decimals, so it can never render a clean whole number, and there is no
# NumberFormat.NO_DECIMALS to ask for one. Each concatenation also leads
# with a string literal, so the first + is never ambiguous with arithmetic.
AddLabel(aggOK and ibLocked and !showWindow,
    "  IB " + Round(ibMonth, 0) + "/" + Round(ibDay, 0) + "  " +
    AsText(ibLow) + "-" + AsText(ibHigh) +
    " (" + Round(ibRange, 0) + " pts)  ",
    Color.WHITE);

AddLabel(aggOK and ibLocked and showWindow,
    "  IB " + Round(ibMonth, 0) + "/" + Round(ibDay, 0) +
    " [" + Round(ibStartCT, 0) + "-" + Round(ibEndCT, 0) + "]  " +
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

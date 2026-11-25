"""Build the ES Trading Journal user handbook (current as of 2026-11-24)."""
import sys
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table,
                                TableStyle, PageBreak, KeepTogether, CondPageBreak)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

OUT = sys.argv[1]
SUP = "/System/Library/Fonts/Supplemental/"
pdfmetrics.registerFont(TTFont("Arial", SUP + "Arial.ttf"))
pdfmetrics.registerFont(TTFont("Arial-Bold", SUP + "Arial Bold.ttf"))
pdfmetrics.registerFont(TTFont("Arial-Italic", SUP + "Arial Italic.ttf"))
pdfmetrics.registerFontFamily("Arial", normal="Arial", bold="Arial-Bold", italic="Arial-Italic", boldItalic="Arial-Bold")

INK = colors.HexColor("#1d2330"); MUTED = colors.HexColor("#5b6475"); ACCENT = colors.HexColor("#b7791f")
RULE = colors.HexColor("#d5dae3"); BAND = colors.HexColor("#f6f4ef")
ss = {
    "title": ParagraphStyle("title", fontName="Arial-Bold", fontSize=30, leading=36, textColor=INK, spaceAfter=10),
    "subtitle": ParagraphStyle("subtitle", fontName="Arial", fontSize=14, leading=20, textColor=MUTED),
    "h1": ParagraphStyle("h1", fontName="Arial-Bold", fontSize=19, leading=24, textColor=INK, spaceAfter=10),
    "h2": ParagraphStyle("h2", fontName="Arial-Bold", fontSize=13.5, leading=18, textColor=ACCENT, spaceBefore=12, spaceAfter=5),
    "h3": ParagraphStyle("h3", fontName="Arial-Bold", fontSize=11, leading=15, textColor=INK, spaceBefore=8, spaceAfter=3),
    "body": ParagraphStyle("body", fontName="Arial", fontSize=10, leading=14.5, textColor=INK, spaceAfter=6),
    "bullet": ParagraphStyle("bullet", fontName="Arial", fontSize=10, leading=14, textColor=INK, leftIndent=14, bulletIndent=3, spaceAfter=2.5),
    "small": ParagraphStyle("small", fontName="Arial", fontSize=8.5, leading=11.5, textColor=MUTED),
    "cell": ParagraphStyle("cell", fontName="Arial", fontSize=8.8, leading=11.6, textColor=INK),
    "cellb": ParagraphStyle("cellb", fontName="Arial-Bold", fontSize=8.8, leading=11.6, textColor=INK),
    "head": ParagraphStyle("head", fontName="Arial-Bold", fontSize=8.8, leading=11.6, textColor=colors.white),
    "callout": ParagraphStyle("callout", fontName="Arial", fontSize=9.6, leading=13.8, textColor=INK,
                              backColor=colors.HexColor("#fbf3e4"), borderPadding=(7, 8, 7, 8), leftIndent=8,
                              rightIndent=8, spaceBefore=6, spaceAfter=10),
    "toc1": ParagraphStyle("toc1", fontName="Arial", fontSize=10.5, leading=17),
}
story = []
P = lambda t, s="body": Paragraph(t, ss[s])
def T(t): story.append(P(t))
def H3(t): story.append(P(t, "h3"))
def H2(t): story.append(CondPageBreak(1.1 * inch)); story.append(P(t, "h2"))
def H1(t, brk=True):
    if brk: story.append(PageBreak())
    p = P(t, "h1"); p.toc = t; story.append(p)
def CALL(t): story.append(P(t, "callout"))
def B(items):
    for it in items: story.append(Paragraph(it, ss["bullet"], bulletText="•"))
    story.append(Spacer(1, 4))
def N(items):
    for i, it in enumerate(items, 1): story.append(Paragraph(it, ss["bullet"], bulletText=f"{i}."))
    story.append(Spacer(1, 4))
def TABLE(rows, widths):
    data = [[Paragraph(c, ss["head"]) for c in rows[0]]] + \
           [[Paragraph(str(c), ss["cellb"] if i == 0 else ss["cell"]) for i, c in enumerate(r)] for r in rows[1:]]
    t = Table(data, colWidths=widths, repeatRows=1)
    st = [("BACKGROUND", (0, 0), (-1, 0), INK), ("VALIGN", (0, 0), (-1, -1), "TOP"),
          ("LINEBELOW", (0, 0), (-1, -1), 0.4, RULE), ("TOPPADDING", (0, 0), (-1, -1), 4),
          ("BOTTOMPADDING", (0, 0), (-1, -1), 4), ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5)]
    st += [("BACKGROUND", (0, i), (-1, i), BAND) for i in range(2, len(data), 2)]
    t.setStyle(TableStyle(st)); story.append(t); story.append(Spacer(1, 8))
W = 6.5 * inch

# ------------------------------------------------------------ cover
story.append(Spacer(1, 1.6 * inch))
story.append(P("ES Trading Journal", "title"))
story.append(P("User Handbook", "subtitle"))
story.append(Spacer(1, 14))
story.append(P("A complete guide to the journal for /ES and /MES on Apex legacy accounts: your trading system, your risk "
               "plan, every page, and how to use the data to trade with more discipline.", "subtitle"))
story.append(Spacer(1, 0.9 * inch))
cov = [["Production", "es-trading-journal.vercel.app"], ["Edition", "24 November 2026 (replaces the May 2026 handbook)"],
       ["Rules source", "lib/trading-system.ts and lib/apex-config.ts: the app's single source of truth"],
       ["Accounts covered", "Apex legacy 25K and 50K (eval and PA)"]]
ct = Table([[P(a, "cellb"), P(b, "cell")] for a, b in cov], colWidths=[1.6 * inch, 4.9 * inch])
ct.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.4, RULE), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
story.append(ct); story.append(Spacer(1, 0.8 * inch))
story.append(P("This handbook describes your own rules and the journal that supports them. It is not financial advice. "
               "Futures trading carries substantial risk, and no journal or rule set guarantees results.", "small"))

story.append(PageBreak()); story.append(P("Contents", "h1"))
toc = TableOfContents(); toc.levelStyles = [ss["toc1"]]; story.append(toc)

# ------------------------------------------------------------ 1 quick start
H1("1. Quick start: the daily loop")
T("The journal is built around one repeating day. Each step feeds the next, and the weekly review closes the loop.")
TABLE([["When", "Where", "What you do"],
       ["Before the open", "Pre-Market", "Read the brief (auto-imported from your trading assistant at 08:15 CT, or generate one), "
        "check headlines and earnings, size the trade with the Position Sizer, and complete the Pre-Session Ritual: read the "
        "15 rules aloud and tick the 4-item Pre-Open Check."],
       ["During the session", "Dashboard, Framework", "Watch the per-account Risk Rules bars, the Tilt Meter, the Session "
        "Timer and the Coaching Inbox. The Framework page is your rulebook if you need it."],
       ["After trading", "Journal", "Import the day's Tradovate CSV into the right Apex account, then annotate each trade "
        "(Five-Word Gate, setup, grade, mood, stop and target, MES legs, ATR at entry). Complete the EOD review."],
       ["Any time", "Coach", "Ask questions about your own results; the coach reads your journal instead of guessing."],
       ["Friday 15:00 CT", "Weekly Review", "The week's AI review generates automatically if you have not made one. Read "
        "the compliance section and set next week's focus."],
       ["Weekly or monthly", "Reports, Trade DNA, Backtest", "Find where your edge lives, test brackets, and check eval "
        "pass odds against your real trade history."]],
      [1.15 * inch, 1.25 * inch, 4.1 * inch])
CALL("<b>The one habit that makes everything else work:</b> grade every trade honestly, including F for off-system trades. "
     "Every report, the coach, the weekly review and the Monte Carlo read those grades. Flattering grades produce "
     "flattering analytics and no improvement.")

# ------------------------------------------------------------ 2 system
H1("2. Your trading system")
H2("Core model: 1H bias, 15m setup, 5m trigger")
TABLE([["Bias", "Definition", "What you may trade"],
       ["Bull", "1H closes above the 21 EMA, the EMA is rising, no chop", "Longs only"],
       ["Bear", "1H closes below the 21 EMA, the EMA is falling, no chop", "Shorts only"],
       ["Neutral", "Repeated crossing, flat EMA, messy structure", "Retests only, or no trade"]],
      [0.9 * inch, 3.4 * inch, 2.2 * inch])
H2("Setup priority (trade in this order)")
N(["<b>15-minute ORB:</b> break, retest, 5m confirmation, enter. The opening range must be at least 30% of the prior day's ATR. Primary setup.",
   "<b>TTM Squeeze</b> fire with pullback continuation: Tier 1 locations by default; Tier 2 needs an extra confirmation candle.",
   "<b>AVWAP Bounce:</b> 1H bias, price respecting AVWAP, 5m confirmation, room to target.",
   "<b>21-EMA Bounce:</b> trend pullback into the 21 EMA on the 15m, with confluence and a 5m confirmation. Never the EMA alone.",
   "<b>FVG Bounce:</b> a location tool with confluence, aligned with the 1H bias and a real trigger.",
   "<b>VAH/VAL Bounce:</b> volume-profile boundary with confluence and room to POC or the opposite value-area edge. Never alone.",
   "<b>Divergence/Trendline Break:</b> an alert only, never standalone; it needs a meaningful level and a 5m trigger."])
T("The journal's setup tags also include <b>A+ Confluence</b>, <b>Fresh Supply/Demand</b>, <b>FireLines Level</b>, "
  "<b>Price Action</b> and <b>No Setup</b>, so every trade can be tagged with what it really was.")
H2("Entries and locations")
B(["<b>Entry sequence:</b> Break, Retest, Confirm, Enter. All four, every time.",
   "<b>Banned entries:</b> anticipation, blind-touch, chasing, entering on a bubble or a squeeze fire alone.",
   "<b>Approved locations:</b> ORH/ORL, VWAP/AVWAP, VAH/VAL, PDH/PDL, overnight high/low, prior swing extremes, fresh "
   "supply/demand with confluence.",
   "<b>Banned locations:</b> POC, mid-value, overlapping candles, obvious chop, signals firing into a nearby major level."])
H2("The Hard Operating Rule")
T("Before every trade you must state all five. Cannot state all five means no trade. The journal's <b>Five-Word Gate</b> "
  "asks these before you annotate a trade.")
N(["<b>Bias</b>: is the 1H direction clear and aligned?", "<b>Setup</b>: which setup is this?",
   "<b>Trigger</b>: what is the exact 5m signal?", "<b>Location</b>: approved location with room to target?",
   "<b>Risk</b>: are the stop and target defined?"])
H2("Grade rubric")
TABLE([["Grade", "Meaning"],
       ["A", "1H bias clear and aligned, correct setup from the priority list, approved location with room, the full "
             "Break-Retest-Confirm-Enter sequence, emotionally flat."],
       ["B", "One minor deviation: a slightly early entry, a Tier 2 location without the extra confirmation candle, or a small size adjustment."],
       ["C", "Any rule violation: POC/mid-value/chop entry, no bias or the wrong direction, a chased extended candle, an entry on "
             "a bubble or fire alone, FOMO or revenge state, a blind-touch trade."],
       ["F", "Off-system: a trade that was not in your plan at all. The journal tracks the damage these do separately."]],
      [0.6 * inch, 5.9 * inch])
CALL("<b>Time of day is context, never a rule.</b> You trade around a work schedule, so entries at any hour are allowed and "
     "time is never a grade deduction. The journal uses session context (Asia, London, NY open, NY lunch 11:00-12:30 is often "
     "thin) only to describe conditions. Session opens with an ORB: Tokyo 19:00, Shanghai 20:30, London 02:00, NY 08:30 CT.")
H2("1-minute refinement")
B(["Only after a proven 5m break with a real close (not a wick), and only for a pullback/retest entry.",
   "Never when: the 1H is mixed or neutral, the OR is sloppy, the 5m break is weak, price is in chop or at POC, you are red "
   "on the day, or you feel urgent, frustrated or FOMO."])

# ------------------------------------------------------------ 3 risk plan
H1("3. Your risk plan")
T("These numbers come from your trading plan for Apex legacy accounts (intraday trailing drawdown, no Apex daily loss "
  "limit, so your daily stop is the only one). They apply to the eval and to the PA until the trail locks.")
TABLE([["", "25K", "50K"],
       ["Trailing drawdown (intraday, counts open profit)", "$1,500", "$2,500"],
       ["Eval profit target / minimum days", "$1,500 / 7 days", "$3,000 / none"],
       ["Per-trade risk (1:2 reward)", "$60 - $75", "$100 - $125"],
       ["Daily profit target: STOP when hit", "+$225", "+$375"],
       ["Daily hard dollar stop: STOP when hit", "-$150", "-$250"],
       ["Loser limit", "<b>Three losers = done</b>", "<b>Three losers = done</b>"],
       ["Breakeven trigger", "Trade up about $100", "Trade up about $150"],
       ["PA trail locks at", "$25,100", "$50,100"]],
      [3.0 * inch, 1.75 * inch, 1.75 * inch])
CALL("<b>The daily stop has two parts: whichever comes first ends the day.</b> Three losing trades, or the hard dollar stop "
     "($150 / $250). Two full-risk losers already reach the dollar stop, so the third loser only comes into play when earlier "
     "losses were smaller than full risk. The loser limit was raised from two to three on 24 November 2026; the dollar stop "
     "did not change. Daily limits cover both sessions: hitting the stop at 2 AM ends the whole trading day.")
H2("Brackets")
TABLE([["Bracket", "Contracts", "Stop", "Target", "Notes"],
       ["/MES (default)", "2 MES", "16 ticks each ($40 total)", "Leg 1 +16t ($20), leg 2 +32t ($40)", "Leg 2's stop moves to breakeven when leg 1 fills. Outcomes: -$40, +$20 or +$60"],
       ["/ES (authorized only)", "1 ES", "8 ticks ($100)", "12 ticks ($150)", "Only when ATR at entry is under 6; at 6 or above, /MES only. Max 1 ES on either account"]],
      [1.15 * inch, 0.8 * inch, 1.25 * inch, 1.5 * inch, 1.8 * inch])
B(["Save both brackets as ATM templates; ticks are never typed during a live setup.",
   "Never trade /MES and /ES at the same time: you are always in one bracket.",
   "On the 25K, one /ES loser uses $100 of the $150 daily stop. That is your deliberate choice, not a violation.",
   "Since 24 November 2026 the daily loss limit and profit target are hard limits in Tradovate. The three-loser rule, the "
   "/ES contract max and the ATR-under-6 gate are <b>not</b> platform-enforced: they rest on you."])
H2("Kill switch rules (no exceptions)")
B(["Hit the daily profit target: stop trading, the day is done. Hit the daily max loss: stop, the day is done.",
   "Three losers or the hard dollar stop: stop trading, the day is done. No re-entries after a max-loss morning.",
   "Never increase size to catch up after a red day. Position size is locked at session start.",
   "Take profit at the fixed target, no runners: the trail counts open profit, so a winner that comes back raises the floor.",
   "A 10-minute cooldown after every loss. Two-strike rule: a setup that fails twice in a row is done for the day.",
   "No trades during FOMC, CPI, NFP or other major scheduled news. Never widen a stop. Never add to a loser.",
   "/ES only when every /ES condition is met; missing any one means /MES.",
   "<b>Post-loss day:</b> after a losing day, trade half base size for the next session (toggle it in Settings)."])

# ------------------------------------------------------------ 4 pre-market
H1("4. Pre-Market")
T("Everything you need before the open, on one page.")
B(["<b>Today's Brief:</b> an AI pre-market brief with market condition, price location, day-type expectation, key levels, "
   "an if/then plan, what not to do, risk level, structural tilt, level map, catalysts, expected range, scenario paths, "
   "volatility regime and playbook fit. Your trading assistant posts the morning brief automatically at 08:15 CT "
   "(<i>Auto-imported</i>); you can add your own observations and regenerate.",
   "<b>Recent Headlines</b> (SPY and the Mag 7, from Polygon) and <b>Upcoming Earnings</b> (next 7 days, BMO/AMC). "
   "Headlines are fed into the brief automatically.",
   "<b>Market State:</b> yesterday's high/low/close, last price, and the opening range (ORH/ORL) once it forms.",
   "<b>Position Sizer:</b> sizes a trade from your plan's per-trade risk for the selected account size.",
   "<b>Bracket Spec</b> and <b>A+ Playbook</b> cards: your brackets and the A+ checklist as a quick reference.",
   "<b>Pre-Session Ritual:</b> the 15 rules, read aloud, then the 4-item Pre-Open Check: rules read out loud, bracket "
   "template loaded and tested, daily targets and limits written down, not trading to recover yesterday's losses. Until "
   "it is done, a weekday banner on the Dashboard reminds you."])

# ------------------------------------------------------------ 5 journal
H1("5. Journal")
H2("Getting trades in: CSV import")
T("Trades arrive by <b>CSV import</b> (Journal, then Import CSV). Drop the Tradovate Performance export and choose which "
  "Apex account the file belongs to: prop-firm exports have no account column, so the journal cannot link trades to an "
  "account on its own. You can import with <i>No account</i> and assign later. Trades are matched by their Tradovate order "
  "id, so re-importing a file does not duplicate trades.")
CALL("<b>Why there is no live sync.</b> The Tradovate sync still exists but is deliberately unscheduled: prop accounts "
     "cannot link through the API, and API fill ids may not match CSV fill ids, so a scheduled sync risked importing every "
     "trade twice. CSV import is the supported path.")
H2("The trade log")
B(["Filter by date range, direction, grade (A, B, C or F off-system), mood and instrument.",
   "P&amp;L is computed in the database from the instrument: ES $50/pt, NQ $20/pt, MES $5/pt, MNQ $2/pt. If a MES trade ever "
   "shows ten times the expected P&amp;L, that is a schema problem, not your trade.",
   "Flags appear automatically: <b>Potential Revenge Trade</b> (entered within 3 minutes of a loss) and <b>News-driven</b> "
   "(a high-impact headline within 15 minutes of entry).",
   "<b>Timeline</b> shows the session's trades in order."])
H2("Annotating a trade")
T("Click <b>Annotate</b>. The <b>Five-Word Gate</b> comes first: Bias, Setup, Trigger, Location, Risk, plus <i>Was this trade "
  "in your plan?</i> (no tags it off-plan) and the historical edge for the chosen setup. Then the form:")
TABLE([["Field", "Why it matters"],
       ["Setup tag, grade, mood", "Drive the setup matrix, Trade DNA, compliance score, tilt meter and emotion charts"],
       ["Stop and target", "Required. Give R-multiples, planned vs actual R:R, and the R distribution in Reports"],
       ["First / second contract hit TP?", "For the /MES bracket: records -$40, +$20 or +$60 outcomes and feeds the Target Hit Rate card"],
       ["ATR at entry", "Checks the /ES rule (under 6) and feeds the weekly review"],
       ["MAE / MFE", "How far the trade went against and for you. Filled automatically where excursion data is available"],
       ["Account", "Which Apex account; drives per-account risk bars and day rules"],
       ["Tags, notes, voice, screenshots", "Free-form context; tags are searchable and appear in AI reviews"]],
      [2.0 * inch, 4.5 * inch])
B(["<b>Narrative:</b> <i>Generate Narrative</i> asks Claude for a coach's review of the trade (timing, excursion, "
   "stop/target, news, mood and criteria) and saves it with the trade.",
   "<b>Charts:</b> upload entry/exit screenshots or use the auto chart with indicator toggles (VWAP, EMA 9/20/21/50).",
   "<b>EOD Scorecard:</b> the end-of-day review. Some trade details stay locked until it is completed, so the review "
   "happens before you move on."])

# ------------------------------------------------------------ 6 dashboard
H1("6. Dashboard")
TABLE([["Card", "What it tells you"],
       ["Stats cards", "Total P&amp;L, today, win rate, total trades, profit factor, streak"],
       ["Risk Rules", "Per Apex account: today's loss against the hard dollar stop and losers against the plan's limit of 3. "
                      "The banner turns to <i>3 LOSERS - Day is done</i> or <i>DAILY LOSS LIMIT HIT - Stop trading</i>"],
       ["Tilt Meter", "Scores emotional risk from contributing factors such as the last 3 trades all being losers"],
       ["Session Timer", "Warns at 90 minutes (wrap up) and 2 hours (fatigue impairs judgement)"],
       ["Coaching Inbox", "Proactive prompts, e.g. <i>3 consecutive losers - pause and verify</i>"],
       ["Discipline Score", "Today's auto-saved score across setup, emotion, prep and grade"],
       ["Off-System Damage", "Month-to-date count and net P&amp;L of F-graded trades: what breaking the system cost"],
       ["Loss Autopsy", "Reversal losses (trades that were green first) vs straight losses, and green given up"],
       ["Target Hit Rate", "How often /MES leg 1 (TP1) and leg 2 (TP2) reach their targets"],
       ["Eval Pass Odds", "The latest Monte Carlo pass probability, with a rerun link"],
       ["Equity, calendar, heatmap", "All-time and weekly equity curves, a 3-month P&amp;L calendar, a session heatmap by CT hour"],
       ["Emotion Breakdown", "Trade count and average P&amp;L by mood"],
       ["Market News", "Live headlines; market-moving events (CEO change, M&amp;A, halts, guidance, regulatory, bankruptcy, split) are pinned with an EVENT badge"],
       ["Banners", "Post-loss day (half size today) and the pending pre-session ritual"]],
      [1.6 * inch, 4.9 * inch])
T("Cards with nothing to show stay hidden, so an empty dashboard area means there is nothing to act on.")

# ------------------------------------------------------------ 7 coach
H1("7. Coach")
T("A chat page where you can ask anything about trading. For questions about <i>your</i> results it uses read-only journal "
  "tools (your trades, grouped statistics, Apex account status, the per-account day-rule check, saved reviews) and cites "
  "them rather than estimating. It coaches against the same system and risk-plan text as the weekly review, and it can "
  "search the web for current events. Web results are treated as data, never instructions, and nothing from your journal "
  "is sent out in a search.")
B(["Good questions: <i>Which setup lost me the most this month?</i>, <i>Did I break any day rules on Tuesday?</i>, "
   "<i>How do my A trades compare with my B trades?</i>",
   "<b>New chat</b> starts fresh. Enter sends; Shift+Enter adds a line."])

# ------------------------------------------------------------ 8 reports
H1("8. Reports")
TABLE([["Section", "Use it to"],
       ["Average P&amp;L by hour (CT)", "See when you trade well, as context, not a rule"],
       ["R-multiple distribution", "Check that winners are bigger than losers (needs stops on trades)"],
       ["MAE vs MFE", "Large MAE on winners means sloppy entries; large MFE on losers means exits that gave back too much"],
       ["Bracket Optimizer", "Expectancy and win rate across stop/target combinations, with the best bracket highlighted"],
       ["Running drawdown", "How deep you have been from peak equity"],
       ["Direction and mood", "Win rate and average P&amp;L for longs vs shorts, and P&amp;L by mood"],
       ["What-If Simulator", "Toggle scenarios (for example, removing a bad habit) and compare actual vs simulated results; "
                             "<i>AI Insight</i> sends the comparison to Claude for a behavioural read"],
       ["Setup Performance Matrix", "Setups ranked by net P&amp;L, with win-rate and average-P&amp;L matrices by time window. "
                                    "Dimmed cells have fewer than 3 trades: do not draw conclusions from them"]],
      [1.9 * inch, 4.6 * inch])

# ------------------------------------------------------------ 9 apex / framework / playbook
H1("9. Apex Tracker, Framework and Playbook")
H2("Apex Tracker")
B(["Add each account with its name, Tradovate account id, size, mode (eval or PA), drawdown type, starting and current balance.",
   "<b>Evaluation status:</b> profit target progress, peak balance, current balance and the trailing floor, with a "
   "<i>PASS READY</i> banner when the target is hit in good standing.",
   "<b>Session and account stats from the journal:</b> trading days, journal P&amp;L, average day, best session, and "
   "payout-qualifying days against the payout rules.",
   "Legacy accounts trail intraday: update the current balance after each session."])
H2("Framework")
T("Your full rulebook as a page: account parameters, position structure, /ES authorization, bracket specifications, daily "
  "limits, session structure, kill switch rules, payout caps by cycle, and a 25K vs 50K side-by-side. Its golden rule: "
  "<i>this is a business; policies are not negotiated in the moment.</i>")
TABLE([["Payouts (legacy PA)", "25K", "50K"],
       ["Minimum balance to request", "$26,600", "$52,600"],
       ["Profit needed before the first payout", "$1,600", "$2,600"],
       ["Qualifying days", "5 days at $100 minimum", "5 days at $200 minimum"],
       ["Payout caps", "$1,000 each, 6 payouts", "$1,500, $2,000, $2,500, $2,500, $3,000, $3,000"],
       ["Most extractable from one PA", "$6,000", "$15,500"],
       ["Consistency", "No single day at or above 30% of profit since the last payout", "Same"]],
      [2.3 * inch, 1.9 * inch, 2.3 * inch])
H2("Playbook")
B(["Each setup has a description, entry criteria, exit criteria and tags, editable on its page.",
   "Open a setup for its analytics: trades, win rate, average P&amp;L, profit factor, an equity curve, trade lifetime "
   "(MFE/MAE, target capture) and every trade tagged with it.",
   "Tag trades with the setup name in the journal and the analytics fill in."])

# ------------------------------------------------------------ 10 weekly / patterns / dna
H1("10. Weekly Review, AI Patterns and Trade DNA")
H2("Weekly Review")
B(["An AI review of the week against your system: week summary, setup breakdown, emotional trends, loss autopsy, top "
   "lessons, next week's focus, and <b>System Compliance</b> (rules followed, rule violations).",
   "Generates automatically on Fridays at 15:00 CT if you have not made one yet; you can also generate it yourself.",
   "<b>Behavior Patterns</b> track discipline, not P&amp;L: ritual done, EOD review done, discipline streak, week-over-week.",
   "The week's off-system (F) trades are listed with their reasons, and a missing market brief is flagged."])
H2("AI Patterns")
T("Claude reads your full history (at least 5 trades) and returns a priority focus, a recommendation, strengths and blind "
  "spots. Re-run it as your sample grows.")
H2("Trade DNA")
T("Where your statistical edge actually lives: best setup, hour (CT), day and mood, with breakdowns by setup, day of week, "
  "time of day, mood vs outcome, grade accuracy and best combinations, for this week, this month, 30 days or all time.")

# ------------------------------------------------------------ 11 backtest
H1("11. Backtest")
TABLE([["Tool", "What it does"],
       ["Blind Engine / Session Log", "Log backtest trades by date with the Five-Word Gate, then compare win rate by setup, "
                                      "P&amp;L by time window and grade breakdown"],
       ["Edge Decay Scorecard", "How each backtested edge is holding up live, worst first: building sample, edge holds, "
                                "slipping, collapsing, or profit leak"],
       ["Backtest vs Live", "Every setup's backtest and live win rate side by side, plus an AI behavioural gap analysis "
                            "explaining why live results differ"],
       ["Apex Eval Simulator", "Monte Carlo pass probability for an evaluation from your real R-multiples over 120 trading "
                               "days: pass, fail, timeout, median days to pass, equity percentiles, and a risk-per-trade "
                               "comparison. Options apply the plan's daily rules (dollar stop, three losers, profit "
                               "target), size trades to the plan, and assume the 8/12 /ES bracket"],
       ["Plan Replay", "Your real trades re-run under the plan's daily rules: the hard dollar stop, the loser limit and the "
                       "profit target. Shows the losses the plan would have avoided and the wins it would have cut"],
       ["Bracket Sweep", "Replays logged trades against hypothetical stop/target brackets using recorded MAE/MFE, as an "
                         "expectancy heatmap with every trade as 1 ES in ticks, against your current live bracket"]],
      [1.7 * inch, 4.8 * inch])
CALL("<b>Read simulations with care.</b> They resample your own history, so they are only as honest as your grades and "
     "only as large as your sample. Small samples and a single market regime can make any number look better or worse than "
     "it is.")

# ------------------------------------------------------------ 12 settings
H1("12. Settings")
TABLE([["Section", "Notes"],
       ["Broker Sync", "Shows the Tradovate connection. Trades come in by CSV import; the scheduled sync is off on purpose (see part 5)"],
       ["Apex Account Type", "Quick-select a preset to fill hard stop, soft stop and default risk"],
       ["Post-Loss Day", "Turn on after a losing day: the Dashboard shows a half-size banner for the session"],
       ["Risk Rules", "Max daily loss, max consecutive losses and default risk. Accounts with a written plan (25K, 50K) "
                      "use the plan instead; these values are the fallback for accounts without one"],
       ["Pre-Session Checklist", "Your reorderable checklist, starting from the system's hard-rule items"],
       ["Session Close Reminder", "A browser notification at 3:15 PM CT"],
       ["MAE/MFE Excursions", "Status of automatic excursion enrichment: enriched, pending or skipped"],
       ["Export / Search", "Download every trade as CSV; search notes, reflections, setup tags and custom tags"]],
      [1.7 * inch, 4.8 * inch])

# ------------------------------------------------------------ 13 improve
H1("13. Using the journal to trade better")
H2("Daily")
B(["Do the ritual before the first trade, every weekday. Skipping it is itself a data point the weekly review counts.",
   "Respect the Risk Rules banner the moment it turns. Three losers or the dollar stop ends the day, whichever comes first.",
   "Annotate the same day, while you remember why you took each trade."])
H2("Weekly")
B(["Read the compliance section before the P&amp;L. A green week with violations is a warning, not a win.",
   "Check Off-System Damage: that is the cost of trades your system never approved.",
   "Write one next-week focus, and only one. Check it against the next review."])
H2("Monthly")
B(["Use Trade DNA and the Setup Matrix to find where your edge is, then trade more of it and less of the rest.",
   "Use the Edge Decay Scorecard to catch a setup that worked in backtest and is fading live.",
   "Rerun Eval Pass Odds after changing risk or brackets, and judge changes by R and drawdown, not by one good week."])
CALL("<b>Judge levels and setups by outcome in R, not by how often price touches them.</b> Touch rates mostly measure how "
     "close a level was to the open. What matters is what happened to your money when you traded it.")

# ------------------------------------------------------------ 14 glossary
H1("14. Glossary")
TABLE([["Term", "Meaning"],
       ["Apex legacy", "Your accounts' rules: intraday trailing drawdown that counts open profit, no Apex daily loss limit"],
       ["ATR at entry", "Volatility when you entered; /ES is allowed only under 6"],
       ["Breakeven trigger", "Profit at which the stop moves to entry (about $100 on 25K, $150 on 50K)"],
       ["Compliance score", "Share of the week's trades that respected the full rules framework"],
       ["Daily hard stop", "The dollar loss that ends the day: $150 (25K), $250 (50K); enforced in Tradovate"],
       ["Loser limit", "Three losing trades end the day; not platform-enforced"],
       ["MAE / MFE", "Maximum adverse / favorable excursion: how far a trade went against / for you"],
       ["Off-system (F)", "A trade outside your plan; tracked separately as off-system damage"],
       ["ORB / OR", "Opening range breakout; the first 15 minutes of a session open"],
       ["PA", "Performance account: the funded stage after passing the evaluation"],
       ["Post-loss day", "The session after a losing day: half base size"],
       ["Profit factor", "Gross wins divided by gross losses; above 1.0 is profitable"],
       ["R / R-multiple", "A result measured in units of the risk taken; +2R made twice the risk"],
       ["Trail lock", "The PA trailing floor stops rising at start + $100 ($25,100 / $50,100)"],
       ["Two-strike rule", "A setup that fails twice in a row is done for the day"]],
      [1.6 * inch, 4.9 * inch])


class Doc(BaseDocTemplate):
    def __init__(self, fn, **kw):
        super().__init__(fn, **kw)
        self.addPageTemplates([PageTemplate(id="p", frames=[Frame(self.leftMargin, self.bottomMargin, self.width, self.height)],
                                            onPage=self.deco)])
    def deco(self, c, doc):
        if doc.page == 1: return
        c.saveState(); c.setFont("Arial", 8); c.setFillColor(MUTED)
        c.drawString(doc.leftMargin, 0.5 * inch, "ES Trading Journal - User Handbook (November 2026)")
        c.drawRightString(doc.leftMargin + doc.width, 0.5 * inch, str(doc.page))
        c.setStrokeColor(RULE); c.setLineWidth(0.5); c.line(doc.leftMargin, 0.62 * inch, doc.leftMargin + doc.width, 0.62 * inch)
        c.restoreState()
    def afterFlowable(self, f):
        if hasattr(f, "toc"): self.notify("TOCEntry", (0, f.toc, self.page))

Doc(OUT, pagesize=letter, leftMargin=inch, rightMargin=inch, topMargin=0.85 * inch, bottomMargin=0.85 * inch,
    title="ES Trading Journal - User Handbook", author="ES Trading Journal").multiBuild(story)
print("built", OUT)

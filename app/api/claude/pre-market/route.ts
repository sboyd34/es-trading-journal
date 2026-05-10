export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { format } from 'date-fns'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { context } = await request.json()

    if (!context || typeof context !== 'string') {
      return NextResponse.json({ error: 'context is required' }, { status: 400 })
    }

    const today = format(new Date(), 'yyyy-MM-dd')

    const systemPrompt = `You are an expert ES (S&P 500 E-mini futures) trading coach with deep knowledge of price action, market structure, and trader psychology. Your job is to help traders create structured, actionable pre-market briefs.

When analyzing the trader's market observations, generate a comprehensive pre-market brief in the following JSON format. Be specific, actionable, and concise. Avoid generic advice.

Return ONLY valid JSON with these exact keys:
{
  "market_condition": "Current market structure and trend (e.g., 'Uptrend with HOD resistance at 5842, overnight gap fill complete')",
  "location": "Where price is relative to key structures (e.g., 'Trading at top of prior day range, just below VWAP')",
  "day_type_expectation": "Expected day type based on context (e.g., 'Rotation day likely — low-conviction trending move. Expect fades at extremes.')",
  "key_levels": "Critical price levels to watch (e.g., '5842 HOD resistance, 5820 VWAP, 5800 major support, 5780 overnight low')",
  "if_then_plan": "2-3 specific if/then trade scenarios (e.g., 'IF price breaks above 5842 with volume THEN long targeting 5860. IF price fails at 5842 and puts in bearish structure THEN short targeting 5820.')",
  "what_not_to_do": "Specific behaviors to avoid today (e.g., 'Do not chase breakouts without confirmation. Do not trade the first 15 minutes. No revenge trades after first loss.')",
  "risk_level": "Recommended risk level: Low | Normal | High — with brief reason"
}`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Today is ${today}. Here are my pre-market observations:\n\n${context}\n\nGenerate my pre-market brief.`,
        },
      ],
    })

    const responseText = message.content[0].type === 'text' ? message.content[0].text : ''

    let brief
    try {
      // Extract JSON from the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON found in response')
      brief = JSON.parse(jsonMatch[0])
    } catch {
      console.error('Failed to parse Claude response:', responseText)
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
    }

    // Save to daily_sessions
    const { data: existingSession } = await supabase
      .from('daily_sessions')
      .select('id')
      .eq('user_id', user.id)
      .eq('date', today)
      .single()

    if (existingSession) {
      await supabase
        .from('daily_sessions')
        .update({ pre_market_brief: brief })
        .eq('id', existingSession.id)
    } else {
      await supabase
        .from('daily_sessions')
        .insert({
          user_id: user.id,
          date: today,
          pre_market_brief: brief,
        })
    }

    return NextResponse.json({ brief })
  } catch (err) {
    console.error('Pre-market Claude error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

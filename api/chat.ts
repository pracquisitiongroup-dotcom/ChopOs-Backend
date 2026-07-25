/**
 * /api/chat
 * ------------------------------------------------------------------
 * "Ask Chop anything" — now business-scoped. Requires a logged-in
 * user; pulls that specific business's memories, training answers,
 * GHL credentials, and live leads — nobody sees another business's data.
 *   1. Checks this business hasn't gone over its monthly $ budget
 *      (enforced in real dollars, but surfaced to the frontend as a
 *      TOKEN count so raw cost/margin is never exposed to the owner)
 *   2. Pulls what's known about the business (memories, training,
 *      live GHL leads)
 *   3. Sends the conversation to Claude
 *   4. Logs both sides — including real token usage — to chat_messages
 *
 * Body: { "message": "who should I call today?", "history"?: [...] }
 * Response: { reply, tokensUsedThisMonth, monthlyTokenLimit }
 * — no dollar figures are ever returned to the frontend.
 *
 * Env vars needed:
 *   ANTHROPIC_API_KEY        (from console.anthropic.com)
 *   MONTHLY_SPEND_LIMIT_USD  (optional, defaults to 10)
 *   SONNET_INPUT_COST_PER_MTOK / SONNET_OUTPUT_COST_PER_MTOK (optional)
 * ------------------------------------------------------------------
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase } from "../lib/supabase";
import { getAuthedBusiness } from "../lib/auth";
import { fetchGhlLeads } from "../adapters/ghl";

const CLAUDE_MODEL = "claude-sonnet-5";

const INPUT_COST_PER_TOKEN = Number(process.env.SONNET_INPUT_COST_PER_MTOK || 2) / 1_000_000;
const OUTPUT_COST_PER_TOKEN = Number(process.env.SONNET_OUTPUT_COST_PER_MTOK || 10) / 1_000_000;
const DEFAULT_MONTHLY_SPEND_LIMIT_USD = 10;

const DISPLAY_TOKEN_WEIGHT = OUTPUT_COST_PER_TOKEN / INPUT_COST_PER_TOKEN;
function toDisplayTokens(inputTokens: number, outputTokens: number): number {
  return Math.round(inputTokens + outputTokens * DISPLAY_TOKEN_WEIGHT);
}

async function getMonthlyUsage(businessId: string): Promise<{ spendUsd: number; displayTokens: number }> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("chat_messages")
    .select("input_tokens, output_tokens")
    .eq("business_id", businessId)
    .gte("created_at", startOfMonth.toISOString());

  if (error) {
    console.warn("[/api/chat] usage lookup failed, allowing request:", error);
    return { spendUsd: 0, displayTokens: 0 };
  }
  const totals = (data || []).reduce(
    (acc, row) => ({
      inputTokens: acc.inputTokens + (row.input_tokens || 0),
      outputTokens: acc.outputTokens + (row.output_tokens || 0),
    }),
    { inputTokens: 0, outputTokens: 0 }
  );
  return {
    spendUsd: totals.inputTokens * INPUT_COST_PER_TOKEN + totals.outputTokens * OUTPUT_COST_PER_TOKEN,
    displayTokens: toDisplayTokens(totals.inputTokens, totals.outputTokens),
  };
}

async function buildContext(businessId: string): Promise<string> {
  const [{ data: memories }, { data: trainingRows }, { data: business }] = await Promise.all([
    supabase.from("memories").select("text, category, pinned").eq("business_id", businessId).order("pinned", { ascending: false }),
    supabase.from("training_answers").select("step, field_key, value").eq("business_id", businessId),
    supabase.from("businesses").select("ghl_private_token, ghl_location_id").eq("id", businessId).single(),
  ]);

  const memoryLines = (memories || [])
    .map((m) => `- ${m.pinned ? "[pinned] " : ""}${m.text} (${m.category})`)
    .join("\n");

  const trainingLines = (trainingRows || [])
    .filter((r) => r.value)
    .map((r) => `- ${r.field_key}: ${r.value}`)
    .join("\n");

  let leadsSummary = "No live CRM data available right now.";
  try {
    if (business?.ghl_private_token && business?.ghl_location_id) {
      const leads = await fetchGhlLeads(
        { privateToken: business.ghl_private_token, locationId: business.ghl_location_id },
        { limit: 30 }
      );
      leadsSummary = leads
        .slice(0, 15)
        .map((l) => `- ${l.name} · status: ${l.status} · value: ${l.estimatedValue ?? "unknown"}`)
        .join("\n");
    }
  } catch (e) {
    console.warn("[/api/chat] could not fetch live leads for context:", e);
  }

  return [
    "You are Chop, the AI business operator inside ChopOS, embedded in this specific business's dashboard.",
    "Speak like a confident, proactive operations manager: be direct, recommend concrete next actions, and reference the real data below rather than generic advice.",
    "",
    "## What you know about this business (Train Chop answers)",
    trainingLines || "(nothing recorded yet)",
    "",
    "## Things this business has told Chop to remember",
    memoryLines || "(no memories saved yet)",
    "",
    "## A snapshot of current leads from their CRM",
    leadsSummary,
  ].join("\n");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const auth = await getAuthedBusiness(req);
    if (!auth) return res.status(401).json({ error: "Not authenticated" });
    const businessId = auth.businessId;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing ANTHROPIC_API_KEY environment variable" });
    }

    const { message, history } = req.body || {};
    if (!message) {
      return res.status(400).json({ error: "Body must include message" });
    }

    const monthlyLimitUsd = Number(process.env.MONTHLY_SPEND_LIMIT_USD) || DEFAULT_MONTHLY_SPEND_LIMIT_USD;
    const monthlyTokenLimit = Math.round(monthlyLimitUsd / INPUT_COST_PER_TOKEN);
    const usage = await getMonthlyUsage(businessId);
    if (usage.spendUsd >= monthlyLimitUsd) {
      return res.status(200).json({
        reply: "Chop has used up its AI tokens for this month. Usage resets at the start of next month, or you can upgrade for more.",
        quotaExceeded: true,
        tokensUsedThisMonth: usage.displayTokens,
        monthlyTokenLimit,
      });
    }

    const systemPrompt = await buildContext(businessId);
    const messages = [...(Array.isArray(history) ? history : []), { role: "user", content: message }];

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 800, system: systemPrompt, messages }),
    });

    if (!claudeRes.ok) {
      const body = await claudeRes.text();
      throw new Error(`Claude API failed (${claudeRes.status}): ${body}`);
    }

    const claudeData = await claudeRes.json();
    const reply = (claudeData.content || [])
      .filter((block: any) => block.type === "text")
      .map((block: any) => block.text)
      .join("\n");

    const inputTokens = claudeData.usage?.input_tokens || 0;
    const outputTokens = claudeData.usage?.output_tokens || 0;

    supabase
      .from("chat_messages")
      .insert([
        { business_id: businessId, role: "user", content: message, input_tokens: inputTokens, output_tokens: 0 },
        { business_id: businessId, role: "assistant", content: reply, input_tokens: 0, output_tokens: outputTokens },
      ])
      .then(({ error }) => {
        if (error) console.warn("[/api/chat] failed to log messages:", error);
      });

    return res.status(200).json({
      reply,
      tokensUsedThisMonth: usage.displayTokens + toDisplayTokens(inputTokens, outputTokens),
      monthlyTokenLimit,
    });
  } catch (err: any) {
    console.error("[/api/chat] error:", err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
}

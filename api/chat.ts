/**
 * /api/chat
 * ------------------------------------------------------------------
 * This is what makes "Ask Chop anything" real instead of a canned
 * demo conversation. It:
 *   1. Checks this business hasn't used up its monthly token allowance
 *   2. Pulls what's actually known about the business (pinned
 *      memories, Train Chop answers, a snapshot of live GHL leads)
 *   3. Builds a system prompt out of that context
 *   4. Sends the conversation to Claude
 *   5. Logs both sides — INCLUDING real token usage — to chat_messages
 *
 * Body: { "message": "who should I call today?", "history"?: [...] }
 * Env vars needed:
 *   ANTHROPIC_API_KEY   (from console.anthropic.com)
 *   MONTHLY_TOKEN_LIMIT (optional, defaults to 300000 — total input+output
 *                        tokens allowed per business per calendar month)
 * ------------------------------------------------------------------
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase, DEFAULT_BUSINESS_ID } from "../lib/supabase";
import { fetchGhlLeads } from "../adapters/ghl";

const CLAUDE_MODEL = "claude-sonnet-5";
const DEFAULT_MONTHLY_LIMIT = 300000; // total tokens (input+output combined)

async function getMonthlyUsage(): Promise<number> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("chat_messages")
    .select("input_tokens, output_tokens")
    .eq("business_id", DEFAULT_BUSINESS_ID)
    .gte("created_at", startOfMonth.toISOString());

  if (error) {
    console.warn("[/api/chat] usage lookup failed, allowing request:", error);
    return 0;
  }
  return (data || []).reduce(
    (sum, row) => sum + (row.input_tokens || 0) + (row.output_tokens || 0),
    0
  );
}

async function buildContext(): Promise<string> {
  const [{ data: memories }, { data: trainingRows }] = await Promise.all([
    supabase
      .from("memories")
      .select("text, category, pinned")
      .eq("business_id", DEFAULT_BUSINESS_ID)
      .order("pinned", { ascending: false }),
    supabase
      .from("training_answers")
      .select("step, field_key, value")
      .eq("business_id", DEFAULT_BUSINESS_ID),
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
    const privateToken = process.env.GHL_PRIVATE_TOKEN;
    const locationId = process.env.GHL_LOCATION_ID;
    if (privateToken && locationId) {
      const leads = await fetchGhlLeads({ privateToken, locationId }, { limit: 30 });
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing ANTHROPIC_API_KEY environment variable" });
    }

    const { message, history } = req.body || {};
    if (!message) {
      return res.status(400).json({ error: "Body must include message" });
    }

    // ---- Quota check — stops one business's usage from becoming an open-ended bill ----
    const monthlyLimit = Number(process.env.MONTHLY_TOKEN_LIMIT) || DEFAULT_MONTHLY_LIMIT;
    const usedThisMonth = await getMonthlyUsage();
    if (usedThisMonth >= monthlyLimit) {
      return res.status(200).json({
        reply:
          "Chop has used up its AI allowance for this month. Usage resets at the start of next month, or you can upgrade for more.",
        quotaExceeded: true,
        usedThisMonth,
        monthlyLimit,
      });
    }

    const systemPrompt = await buildContext();

    const messages = [
      ...(Array.isArray(history) ? history : []),
      { role: "user", content: message },
    ];

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 800,
        system: systemPrompt,
        messages,
      }),
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

    // Log both sides with real token usage — best-effort, don't fail the request if this errors
    supabase
      .from("chat_messages")
      .insert([
        { business_id: DEFAULT_BUSINESS_ID, role: "user", content: message, input_tokens: inputTokens, output_tokens: 0 },
        { business_id: DEFAULT_BUSINESS_ID, role: "assistant", content: reply, input_tokens: 0, output_tokens: outputTokens },
      ])
      .then(({ error }) => {
        if (error) console.warn("[/api/chat] failed to log messages:", error);
      });

    return res.status(200).json({
      reply,
      usedThisMonth: usedThisMonth + inputTokens + outputTokens,
      monthlyLimit,
    });
  } catch (err: any) {
    console.error("[/api/chat] error:", err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
}

/**
 * /api/chat
 * ------------------------------------------------------------------
 * This is what makes "Ask Chop anything" real instead of a canned
 * demo conversation. It:
 *   1. Pulls what's actually known about the business (pinned
 *      memories, Train Chop answers, a snapshot of live GHL leads)
 *   2. Builds a system prompt out of that context
 *   3. Sends the conversation to Claude
 *   4. Logs both sides to chat_messages for history
 *
 * Body: { "message": "who should I call today?", "history"?: [...] }
 * Env vars needed:
 *   ANTHROPIC_API_KEY   (from console.anthropic.com)
 * ------------------------------------------------------------------
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase, DEFAULT_BUSINESS_ID } from "../lib/supabase";
import { fetchGhlLeads } from "../adapters/ghl";

const CLAUDE_MODEL = "claude-sonnet-5";

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

    // Log both sides — best-effort, don't fail the request if this errors
    supabase
      .from("chat_messages")
      .insert([
        { business_id: DEFAULT_BUSINESS_ID, role: "user", content: message },
        { business_id: DEFAULT_BUSINESS_ID, role: "assistant", content: reply },
      ])
      .then(({ error }) => {
        if (error) console.warn("[/api/chat] failed to log messages:", error);
      });

    return res.status(200).json({ reply });
  } catch (err: any) {
    console.error("[/api/chat] error:", err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
}

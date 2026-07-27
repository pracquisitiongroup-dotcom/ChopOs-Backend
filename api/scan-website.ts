/**
 * POST /api/scan-website
 * ------------------------------------------------------------------
 * The optional "Scan my website" enhancement in Train Chop. Fetches
 * the business's website, extracts its visible text, and asks Claude
 * to pull out a few Train Chop fields as SUGGESTIONS — never saved
 * automatically. The owner reviews and applies them manually.
 *
 * Body: { "url": "pracquisitiongroup.com" }
 * Response: { suggestions: { servicesOffered, whatMakesDifferent,
 *              whyCustomersChoose, idealCustomer } }
 *
 * Costs one Claude API call per scan — needs ANTHROPIC_API_KEY funded
 * with credits to actually run (same requirement as /api/chat). Until
 * then this returns a clear "credits needed" error instead of crashing.
 * ------------------------------------------------------------------
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAuthedBusiness } from "../lib/auth";

const CLAUDE_MODEL = "claude-sonnet-5";

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * Crude but dependency-free HTML-to-text extraction. Not perfect on
 * heavily JS-rendered sites, but works fine for the typical small-
 * business marketing site (mostly static HTML).
 */
function extractVisibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000); // keep the Claude call cheap — don't send the whole site
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

    const { url } = req.body || {};
    if (!url || !url.trim()) {
      return res.status(400).json({ error: "Body must include url" });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing ANTHROPIC_API_KEY environment variable" });
    }

    // ---- Fetch the site (free — no AI involved in this part) ----
    const targetUrl = normalizeUrl(url);
    let pageText: string;
    try {
      const siteRes = await fetch(targetUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ChopOSBot/1.0)" },
        signal: AbortSignal.timeout(8000),
      });
      if (!siteRes.ok) throw new Error(`Site responded with ${siteRes.status}`);
      const html = await siteRes.text();
      pageText = extractVisibleText(html);
      if (!pageText) throw new Error("Could not find any readable text on that page");
    } catch (fetchErr: any) {
      return res.status(400).json({
        error: "Could not read that website: " + (fetchErr.message || "unknown error"),
      });
    }

    // ---- Extract structured suggestions (the part that costs a Claude call) ----
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 500,
        system:
          "You extract structured business info from raw website text for a service business onboarding form. " +
          "Respond with ONLY a JSON object, no other text, with exactly these keys: " +
          "servicesOffered (short comma-separated list), whatMakesDifferent (1-2 sentences), " +
          "whyCustomersChoose (1-2 sentences), idealCustomer (1 sentence). " +
          "If the text doesn't give you enough to answer a field confidently, use an empty string for that field rather than guessing.",
        messages: [{ role: "user", content: `Website text:\n\n${pageText}` }],
      }),
    });

    if (!claudeRes.ok) {
      const body = await claudeRes.text();
      throw new Error(`Claude API failed (${claudeRes.status}): ${body}`);
    }

    const claudeData = await claudeRes.json();
    const rawText = (claudeData.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");

    let suggestions;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      suggestions = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    } catch {
      throw new Error("Chop couldn't parse a clean answer from your website — try again or fill these in manually");
    }

    return res.status(200).json({ suggestions });
  } catch (err: any) {
    console.error("[/api/scan-website] error:", err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
}

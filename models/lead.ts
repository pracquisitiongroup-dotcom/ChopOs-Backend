/**
 * GET /api/leads
 * ------------------------------------------------------------------
 * This is what your ChopOS frontend calls. It never talks to GHL
 * directly (the private token must never reach the browser).
 *
 * Deploy target: Vercel serverless function.
 * Env vars needed (set in Vercel project settings, not in code):
 *   GHL_PRIVATE_TOKEN
 *   GHL_LOCATION_ID
 *   ALLOWED_ORIGIN   (e.g. https://funny-lolly-416bc5.netlify.app)
 * ------------------------------------------------------------------
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchGhlLeads } from "../adapters/ghl";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Frontend (Netlify) and backend (Vercel) live on different domains,
  // so the browser blocks the request unless we explicitly allow it here.
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    const privateToken = process.env.GHL_PRIVATE_TOKEN;
    const locationId = process.env.GHL_LOCATION_ID;

    if (!privateToken || !locationId) {
      return res.status(500).json({
        error: "Missing GHL_PRIVATE_TOKEN or GHL_LOCATION_ID environment variables",
      });
    }

    // ---- Today: single CRM, hardcoded. ----
    // ---- Tomorrow: look up which CRM this business connected via
    //      ChopLink, and call that adapter instead. Same return shape
    //      either way, so the frontend and the AI never need to know. ----
    const leads = await fetchGhlLeads({ privateToken, locationId }, { limit: 100 });

    return res.status(200).json({ leads });
  } catch (err: any) {
    console.error("[/api/leads] error:", err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
}


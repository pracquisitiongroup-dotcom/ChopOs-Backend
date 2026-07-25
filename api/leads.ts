/**
 * GET /api/leads
 * ------------------------------------------------------------------
 * This is what your ChopOS frontend calls. It never talks to GHL
 * directly (the private token must never reach the browser).
 * ------------------------------------------------------------------
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchGhlLeads } from "../adapters/ghl";

export default async function handler(req: VercelRequest, res: VercelResponse) {
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

    const leads = await fetchGhlLeads({ privateToken, locationId }, { limit: 100 });

    return res.status(200).json({ leads });
  } catch (err: any) {
    console.error("[/api/leads] error:", err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
}

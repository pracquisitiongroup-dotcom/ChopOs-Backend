/**
 * GET /api/opportunities
 * ------------------------------------------------------------------
 * Backs the Revenue page. Same pattern as /api/leads: requires a
 * logged-in user, pulls that business's GHL credentials from the
 * database, and returns opportunities in the canonical shape.
 * ------------------------------------------------------------------
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchGhlOpportunities } from "../adapters/ghl";
import { getAuthedBusiness } from "../lib/auth";
import { supabase } from "../lib/supabase";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const auth = await getAuthedBusiness(req);
    if (!auth) return res.status(401).json({ error: "Not authenticated" });

    const { data: business, error: bizError } = await supabase
      .from("businesses")
      .select("ghl_private_token, ghl_location_id")
      .eq("id", auth.businessId)
      .single();

    if (bizError || !business?.ghl_private_token || !business?.ghl_location_id) {
      return res.status(500).json({
        error: "This business hasn't connected a CRM yet (missing GHL credentials).",
      });
    }

    const opportunities = await fetchGhlOpportunities(
      { privateToken: business.ghl_private_token, locationId: business.ghl_location_id },
      { limit: 100 }
    );

    return res.status(200).json({ opportunities });
  } catch (err: any) {
    console.error("[/api/opportunities] error:", err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
}

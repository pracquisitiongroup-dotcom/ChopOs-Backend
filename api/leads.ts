/**
 * GET /api/leads
 * ------------------------------------------------------------------
 * This is what your ChopOS frontend calls. It never talks to GHL
 * directly (the private token must never reach the browser).
 *
 * Now business-scoped: requires a logged-in user (Authorization: Bearer
 * <supabase session token>), and pulls that specific business's GHL
 * credentials from the database instead of a shared env var — so each
 * business's data stays separate.
 *
 * Env vars needed:
 *   ALLOWED_ORIGIN   (e.g. https://funny-lolly-416bc5.netlify.app)
 * ------------------------------------------------------------------
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchGhlLeads } from "../adapters/ghl";
import { getAuthedBusiness } from "../lib/auth";
import { supabase } from "../lib/supabase";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    const auth = await getAuthedBusiness(req);
    if (!auth) {
      return res.status(401).json({ error: "Not authenticated" });
    }

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

    // ---- Today: single CRM, hardcoded to GHL. ----
    // ---- Tomorrow: look up which CRM this business connected via
    //      ChopLink, and call that adapter instead. Same return shape
    //      either way, so the frontend and the AI never need to know. ----
    const leads = await fetchGhlLeads(
      { privateToken: business.ghl_private_token, locationId: business.ghl_location_id },
      { limit: 100 }
    );

    return res.status(200).json({ leads });
  } catch (err: any) {
    console.error("[/api/leads] error:", err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
}

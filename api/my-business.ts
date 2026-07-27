/**
 * GET /api/my-business
 * ------------------------------------------------------------------
 * Called right after login to decide what to show next:
 *   - { business: null }       -> new account, show the business-info step
 *   - { business: {...} }      -> existing account, go straight into the app
 * ------------------------------------------------------------------
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase } from "../lib/supabase";
import { getAuthedBusiness } from "../lib/auth";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const auth = await getAuthedBusiness(req);
    if (!auth) {
      // Logged in, but no business_members row yet — this is the normal
      // state for someone who just signed up.
      return res.status(200).json({ business: null });
    }

    const { data: business, error } = await supabase
      .from("businesses")
      .select("id, name, industry, phone, website, service_areas, ghl_private_token, ghl_location_id")
      .eq("id", auth.businessId)
      .single();

    if (error || !business) {
      return res.status(200).json({ business: null });
    }

    // Never send the actual token to the frontend — only whether one exists.
    const { ghl_private_token, ghl_location_id, ...safeBusiness } = business;
    return res.status(200).json({
      business: { ...safeBusiness, ghlConnected: !!(ghl_private_token && ghl_location_id) },
    });
  } catch (err: any) {
    console.error("[/api/my-business] error:", err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
}

/**
 * POST /api/connect-ghl
 * ------------------------------------------------------------------
 * Lets a logged-in business owner connect their own GoHighLevel
 * account by pasting their Private Integration Token + Location ID —
 * the self-serve replacement for the manual SQL insert that used to
 * be the only way to get a business's GHL credentials into the database.
 *
 * Body: { "privateToken": "pit-...", "locationId": "..." }
 *
 * Does a real test call to GHL before saving, so a bad/expired token
 * gets caught immediately instead of silently failing the first time
 * someone tries to load their Customers page.
 * ------------------------------------------------------------------
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase } from "../lib/supabase";
import { getAuthedBusiness } from "../lib/auth";
import { fetchGhlLeads } from "../adapters/ghl";

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

    const { privateToken, locationId } = req.body || {};
    if (!privateToken || !locationId) {
      return res.status(400).json({ error: "Both privateToken and locationId are required" });
    }

    // Test the credentials for real before saving them — catches a bad
    // token/location immediately instead of a confusing failure later
    // on the Customers page.
    try {
      await fetchGhlLeads({ privateToken, locationId }, { limit: 1 });
    } catch (testErr: any) {
      return res.status(400).json({
        error: "Could not verify these credentials with GoHighLevel: " + (testErr.message || "unknown error"),
      });
    }

    const { error: updateError } = await supabase
      .from("businesses")
      .update({ ghl_private_token: privateToken, ghl_location_id: locationId })
      .eq("id", auth.businessId);

    if (updateError) throw updateError;

    return res.status(200).json({ connected: true });
  } catch (err: any) {
    console.error("[/api/connect-ghl] error:", err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
}

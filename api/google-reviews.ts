/**
 * GET /api/google-reviews
 * ------------------------------------------------------------------
 * Backs the Reviews page with real Google reviews. Requires a
 * logged-in user and a business that's completed the Google OAuth
 * connection (separate from their CRM connection entirely).
 *
 * Handles refreshing the Google access token automatically if it's
 * expired — Google's access tokens are short-lived (usually ~1 hour),
 * so this will happen often.
 * ------------------------------------------------------------------
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchGoogleReviews, refreshGoogleAccessToken } from "../adapters/google-business-profile";
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
      .select("google_access_token, google_refresh_token, google_token_expiry, google_account_id, google_location_id")
      .eq("id", auth.businessId)
      .single();

    if (bizError || !business?.google_refresh_token || !business?.google_account_id) {
      return res.status(200).json({
        connected: false,
        error: "Google Business Profile isn't connected yet for this business.",
      });
    }

    let accessToken = business.google_access_token;
    const isExpired = !business.google_token_expiry || new Date(business.google_token_expiry) <= new Date();

    if (isExpired) {
      const refreshed = await refreshGoogleAccessToken(business.google_refresh_token);
      accessToken = refreshed.accessToken;
      // Save the fresh token so we don't refresh again on every single request.
      await supabase
        .from("businesses")
        .update({ google_access_token: refreshed.accessToken, google_token_expiry: refreshed.expiresAt })
        .eq("id", auth.businessId);
    }

    const reviews = await fetchGoogleReviews(accessToken, business.google_account_id, business.google_location_id);
    return res.status(200).json({ connected: true, reviews });
  } catch (err: any) {
    console.error("[/api/google-reviews] error:", err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
}

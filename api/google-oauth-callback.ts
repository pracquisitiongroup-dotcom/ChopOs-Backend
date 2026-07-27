/**
 * GET /api/google-oauth-url
 * ------------------------------------------------------------------
 * Returns the URL to send a business owner to for Google's consent
 * screen. The frontend redirects the browser here; Google eventually
 * redirects back to /api/google-oauth-callback.
 * ------------------------------------------------------------------
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildGoogleAuthUrl } from "../adapters/google-business-profile";
import { getAuthedBusiness } from "../lib/auth";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const auth = await getAuthedBusiness(req);
    if (!auth) return res.status(401).json({ error: "Not authenticated" });

    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_REDIRECT_URI) {
      return res.status(500).json({
        error: "Google OAuth isn't configured yet (missing GOOGLE_CLIENT_ID / GOOGLE_REDIRECT_URI).",
      });
    }

    const url = buildGoogleAuthUrl(auth.businessId);
    return res.status(200).json({ url });
  } catch (err: any) {
    console.error("[/api/google-oauth-url] error:", err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
}

/**
 * /api/post-to-gbp
 * ------------------------------------------------------------------
 * GET  -> lists this business's connected social accounts (so the
 *         frontend can find their Google Business Profile account id)
 * POST -> { summary, mediaUrls? } posts that content to GBP through
 *         GHL's Social Planner API
 *
 * Requires a logged-in user. Uses the SAME GHL Private Integration
 * Token already connected — no separate Google OAuth needed, as long
 * as the business already connected GBP as a channel inside GHL.
 *
 * Needed scope on the GHL token: search the scope picker for "social"
 * when creating/editing the Private Integration — same discovery
 * process as the conversations/message.write scope.
 * ------------------------------------------------------------------
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchGhlSocialAccounts, createGhlSocialPost } from "../adapters/ghl";
import { getAuthedBusiness } from "../lib/auth";
import { supabase } from "../lib/supabase";

async function getBusinessGhlConfig(businessId: string) {
  const { data: business, error } = await supabase
    .from("businesses")
    .select("ghl_private_token, ghl_location_id")
    .eq("id", businessId)
    .single();
  if (error || !business?.ghl_private_token || !business?.ghl_location_id) {
    throw new Error("This business hasn't connected a CRM yet (missing GHL credentials).");
  }
  return { privateToken: business.ghl_private_token, locationId: business.ghl_location_id };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const auth = await getAuthedBusiness(req);
    if (!auth) return res.status(401).json({ error: "Not authenticated" });

    if (req.method === "GET") {
      const config = await getBusinessGhlConfig(auth.businessId);
      const accounts = await fetchGhlSocialAccounts(config);
      // Surface only Google Business Profile accounts — the frontend
      // doesn't need to know about any other connected platform here.
      const gbpAccounts = (accounts as any[]).filter(
        (a) => (a.platform || a.type || "").toLowerCase().includes("google")
      );
      return res.status(200).json({ accounts: gbpAccounts, allAccounts: accounts });
    }

    if (req.method === "POST") {
      const { accountId, summary, mediaUrls } = req.body || {};
      if (!accountId || !summary) {
        return res.status(400).json({ error: "Body must include accountId and summary" });
      }
      const config = await getBusinessGhlConfig(auth.businessId);
      const result = await createGhlSocialPost(config, [accountId], summary, mediaUrls);
      return res.status(200).json({ posted: true, result });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err: any) {
    console.error("[/api/post-to-gbp] error:", err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
}

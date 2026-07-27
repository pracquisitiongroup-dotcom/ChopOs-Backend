/**
 * POST /api/send-followup
 * ------------------------------------------------------------------
 * Sends a real SMS to a real customer through GHL. Now business-scoped:
 * requires a logged-in user, and uses THAT business's GHL credentials —
 * the old shared ACTION_SECRET password is retired now that real
 * per-user login exists.
 *
 * Body: { "contactId": "wLFXrbz5bg7RptiTb3Hr", "message": "Hi ...", "estimatedValue"?: 2450 }
 *
 * `estimatedValue` is optional — if the frontend has it (from the
 * lead's GHL data), it gets logged to chop_actions_log as "pipeline
 * value touched by this follow-up." This is NOT a claim that Chop
 * caused a sale — just an honest record of what was in play when the
 * action happened, for the impact tracker on the dashboard.
 * ------------------------------------------------------------------
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sendGhlSms } from "../adapters/ghl";
import { getAuthedBusiness } from "../lib/auth";
import { supabase } from "../lib/supabase";

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

    const { contactId, message, estimatedValue } = req.body || {};
    if (!contactId || !message) {
      return res.status(400).json({ error: "Body must include contactId and message" });
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

    const result = await sendGhlSms(
      { privateToken: business.ghl_private_token, locationId: business.ghl_location_id },
      contactId,
      message
    );

    // Log the real impact — best-effort, never blocks the actual response.
    supabase
      .from("chop_actions_log")
      .insert({
        business_id: auth.businessId,
        action_type: "follow_up_sent",
        minutes_saved: 5, // a defensible estimate: time to look up, compose, and send a personalized text by hand
        dollar_value: typeof estimatedValue === "number" ? estimatedValue : null,
      })
      .then(({ error }) => {
        if (error) console.warn("[/api/send-followup] impact log failed:", error);
      });

    return res.status(200).json(result);
  } catch (err: any) {
    console.error("[/api/send-followup] error:", err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
}

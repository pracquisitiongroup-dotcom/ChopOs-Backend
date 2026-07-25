/**
 * POST /api/send-followup
 * ------------------------------------------------------------------
 * This is the one that actually DOES something — it sends a real SMS
 * to a real customer through GHL. Treat it with more care than
 * /api/leads: it changes something in the world, so we add a simple
 * shared-secret check to stop randoms from hitting it directly.
 *
 * Body: { "contactId": "wLFXrbz5bg7RptiTb3Hr", "message": "Hi ..." }
 *
 * Env vars needed (in addition to the ones /api/leads uses):
 *   ACTION_SECRET   (a password only your frontend knows — see below)
 * ------------------------------------------------------------------
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sendGhlSms } from "../adapters/ghl";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-chopos-secret");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  // ---- Simple guard so this write-endpoint isn't wide open to the internet ----
  // This is a starting point, not real auth — see the note in README about
  // upgrading this once you have real user accounts.
  const providedSecret = req.headers["x-chopos-secret"];
  if (!process.env.ACTION_SECRET || providedSecret !== process.env.ACTION_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const privateToken = process.env.GHL_PRIVATE_TOKEN;
    const locationId = process.env.GHL_LOCATION_ID;
    const { contactId, message } = req.body || {};

    if (!privateToken || !locationId) {
      return res.status(500).json({ error: "Missing GHL_PRIVATE_TOKEN or GHL_LOCATION_ID" });
    }
    if (!contactId || !message) {
      return res.status(400).json({ error: "Body must include contactId and message" });
    }

    const result = await sendGhlSms({ privateToken, locationId }, contactId, message);
    return res.status(200).json(result);
  } catch (err: any) {
    console.error("[/api/send-followup] error:", err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
}

/**
 * /api/training
 * ------------------------------------------------------------------
 * Backs the Train Chop wizard. Supports:
 *   GET  /api/training           -> { answers: { "1.businessName": "...", ... } }
 *   POST /api/training  { step, answers: { fieldKey: value, ... } }
 *        -> saves/updates every field for that step in one call
 *
 * Reads are open. Writes need the x-chopos-secret header, same as
 * every other write-endpoint in this app.
 * ------------------------------------------------------------------
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase, DEFAULT_BUSINESS_ID } from "../lib/supabase";

function checkSecret(req: VercelRequest): boolean {
  const provided = req.headers["x-chopos-secret"];
  return !!process.env.ACTION_SECRET && provided === process.env.ACTION_SECRET;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-chopos-secret");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("training_answers")
        .select("step, field_key, value")
        .eq("business_id", DEFAULT_BUSINESS_ID);
      if (error) throw error;

      // Flatten into { "1.businessName": "P&R Moving Co.", ... } for easy frontend use
      const answers: Record<string, string> = {};
      (data || []).forEach((row) => {
        answers[`${row.step}.${row.field_key}`] = row.value ?? "";
      });
      return res.status(200).json({ answers });
    }

    if (req.method === "POST") {
      if (!checkSecret(req)) return res.status(401).json({ error: "Unauthorized" });
      const { step, answers } = req.body || {};
      if (typeof step !== "number" || !answers || typeof answers !== "object") {
        return res.status(400).json({ error: "Body must include step (number) and answers (object)" });
      }

      const rows = Object.entries(answers).map(([field_key, value]) => ({
        business_id: DEFAULT_BUSINESS_ID,
        step,
        field_key,
        value: String(value),
        updated_at: new Date().toISOString(),
      }));

      const { error } = await supabase
        .from("training_answers")
        .upsert(rows, { onConflict: "business_id,step,field_key" });
      if (error) throw error;

      return res.status(200).json({ saved: rows.length });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err: any) {
    console.error("[/api/training] error:", err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
}

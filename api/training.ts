/**
 * /api/training
 * ------------------------------------------------------------------
 * Backs the Train Chop wizard. Supports:
 *   GET  /api/training           -> { answers: { "1.field_0": "...", ... } }
 *   POST /api/training  { step, answers: { fieldKey: value, ... } }
 *
 * Every request now requires a logged-in user — retired the old shared
 * ACTION_SECRET. Data is scoped to whichever business the logged-in
 * user belongs to.
 * ------------------------------------------------------------------
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase } from "../lib/supabase";
import { getAuthedBusiness } from "../lib/auth";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  const auth = await getAuthedBusiness(req);
  if (!auth) return res.status(401).json({ error: "Not authenticated" });
  const businessId = auth.businessId;

  try {
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("training_answers")
        .select("step, field_key, value")
        .eq("business_id", businessId);
      if (error) throw error;

      const answers: Record<string, string> = {};
      (data || []).forEach((row) => {
        answers[`${row.step}.${row.field_key}`] = row.value ?? "";
      });
      return res.status(200).json({ answers });
    }

    if (req.method === "POST") {
      const { step, answers } = req.body || {};
      if (typeof step !== "number" || !answers || typeof answers !== "object") {
        return res.status(400).json({ error: "Body must include step (number) and answers (object)" });
      }

      const rows = Object.entries(answers).map(([field_key, value]) => ({
        business_id: businessId,
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

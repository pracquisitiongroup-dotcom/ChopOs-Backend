/**
 * /api/memory
 * ------------------------------------------------------------------
 * Backs the Memory page. Supports:
 *   GET    /api/memory                -> list this business's memories
 *   POST   /api/memory                -> create one { text, category }
 *   PATCH  /api/memory  { id, ... }    -> update text/category/pinned
 *   DELETE /api/memory?id=...          -> remove one
 *
 * Every request (including GET) now requires a logged-in user — the
 * old shared ACTION_SECRET is retired now that real per-user login
 * exists. Data is scoped to whichever business the logged-in user
 * belongs to, resolved via getAuthedBusiness().
 * ------------------------------------------------------------------
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase } from "../lib/supabase";
import { getAuthedBusiness } from "../lib/auth";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  const auth = await getAuthedBusiness(req);
  if (!auth) return res.status(401).json({ error: "Not authenticated" });
  const businessId = auth.businessId;

  try {
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("memories")
        .select("*")
        .eq("business_id", businessId)
        .order("pinned", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return res.status(200).json({ memories: data });
    }

    if (req.method === "POST") {
      const { text, category } = req.body || {};
      if (!text) return res.status(400).json({ error: "Body must include text" });
      const { data, error } = await supabase
        .from("memories")
        .insert({ business_id: businessId, text, category: category || "General" })
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json({ memory: data });
    }

    if (req.method === "PATCH") {
      const { id, text, category, pinned } = req.body || {};
      if (!id) return res.status(400).json({ error: "Body must include id" });
      const update: Record<string, unknown> = {};
      if (text !== undefined) update.text = text;
      if (category !== undefined) update.category = category;
      if (pinned !== undefined) update.pinned = pinned;
      const { data, error } = await supabase
        .from("memories")
        .update(update)
        .eq("id", id)
        .eq("business_id", businessId) // can't edit another business's memory even by guessing an id
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json({ memory: data });
    }

    if (req.method === "DELETE") {
      const id = (req.query.id as string) || (req.body || {}).id;
      if (!id) return res.status(400).json({ error: "Provide id as a query param" });
      const { error } = await supabase
        .from("memories")
        .delete()
        .eq("id", id)
        .eq("business_id", businessId);
      if (error) throw error;
      return res.status(200).json({ deleted: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err: any) {
    console.error("[/api/memory] error:", err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
}

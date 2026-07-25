/**
 * /api/memory
 * ------------------------------------------------------------------
 * Backs the Memory page. Supports:
 *   GET    /api/memory                -> list all memories
 *   POST   /api/memory                -> create one { text, category }
 *   PATCH  /api/memory  { id, ... }    -> update text/category/pinned
 *   DELETE /api/memory?id=...          -> remove one
 *
 * Reads are open (same as /api/leads). Writes require the same
 * x-chopos-secret header as /api/send-followup, since they change
 * data — same pattern, so nothing new to learn here.
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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-chopos-secret");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("memories")
        .select("*")
        .eq("business_id", DEFAULT_BUSINESS_ID)
        .order("pinned", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return res.status(200).json({ memories: data });
    }

    if (req.method === "POST") {
      if (!checkSecret(req)) return res.status(401).json({ error: "Unauthorized" });
      const { text, category } = req.body || {};
      if (!text) return res.status(400).json({ error: "Body must include text" });
      const { data, error } = await supabase
        .from("memories")
        .insert({ business_id: DEFAULT_BUSINESS_ID, text, category: category || "General" })
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json({ memory: data });
    }

    if (req.method === "PATCH") {
      if (!checkSecret(req)) return res.status(401).json({ error: "Unauthorized" });
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
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json({ memory: data });
    }

    if (req.method === "DELETE") {
      if (!checkSecret(req)) return res.status(401).json({ error: "Unauthorized" });
      const id = (req.query.id as string) || (req.body || {}).id;
      if (!id) return res.status(400).json({ error: "Provide id as a query param" });
      const { error } = await supabase.from("memories").delete().eq("id", id);
      if (error) throw error;
      return res.status(200).json({ deleted: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err: any) {
    console.error("[/api/memory] error:", err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
}

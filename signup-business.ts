/**
 * POST /api/signup-business
 * ------------------------------------------------------------------
 * Called right after someone signs up, to actually create their
 * business and link them to it as the owner — replacing the manual
 * SQL insert that used to be needed for every new account.
 *
 * Body: {
 *   businessName: string,
 *   industry?: string,
 *   phone?: string,
 *   website?: string,
 *   serviceAreas?: string
 * }
 *
 * Requires a logged-in user (Authorization: Bearer <token>) but does
 * NOT require an existing business — that's the whole point of this
 * endpoint. If the user already has one, it's left alone (idempotent).
 * ------------------------------------------------------------------
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase } from "../lib/supabase";
import { getAuthedUser } from "../lib/auth";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const authed = await getAuthedUser(req);
    if (!authed) return res.status(401).json({ error: "Not authenticated" });

    // Idempotent: if this user is already linked to a business, don't make a second one.
    const { data: existingMembership } = await supabase
      .from("business_members")
      .select("business_id")
      .eq("user_id", authed.userId)
      .maybeSingle();

    if (existingMembership) {
      return res.status(200).json({ businessId: existingMembership.business_id, alreadyExisted: true });
    }

    const { businessName, industry, phone, website, serviceAreas } = req.body || {};
    if (!businessName || !businessName.trim()) {
      return res.status(400).json({ error: "businessName is required" });
    }

    const { data: business, error: bizError } = await supabase
      .from("businesses")
      .insert({
        name: businessName.trim(),
        industry: industry || null,
        phone: phone || null,
        website: website || null,
        service_areas: serviceAreas || null,
      })
      .select()
      .single();

    if (bizError || !business) {
      throw bizError || new Error("Failed to create business");
    }

    const { error: memberError } = await supabase
      .from("business_members")
      .insert({ business_id: business.id, user_id: authed.userId, role: "owner" });

    if (memberError) {
      throw memberError;
    }

    return res.status(200).json({ businessId: business.id, alreadyExisted: false });
  } catch (err: any) {
    console.error("[/api/signup-business] error:", err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
}

/**
 * AUTH HELPER
 * ------------------------------------------------------------------
 * Every endpoint that used to hardcode DEFAULT_BUSINESS_ID now calls
 * getAuthedBusiness(req) instead. It:
 *   1. Reads the Supabase session token from the Authorization header
 *      (the frontend gets this automatically once someone logs in)
 *   2. Verifies it's a real, currently-logged-in user
 *   3. Looks up which business that user belongs to via business_members
 *   4. Returns { userId, businessId } — or null if not authed/no business
 *
 * This is what makes "multiple people can log into the same business"
 * work: two different users, same business_id, same data.
 * ------------------------------------------------------------------
 */

import type { VercelRequest } from "@vercel/node";
import { supabase } from "./supabase";

export interface AuthedContext {
  userId: string;
  businessId: string;
  role: "owner" | "member";
}

export async function getAuthedBusiness(req: VercelRequest): Promise<AuthedContext | null> {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) return null;

  const userId = userData.user.id;

  // For now: one business per user. If someone belongs to more than one
  // (e.g. an agency managing several client businesses later), this picks
  // the first — a future "switch business" UI would pass a business_id
  // explicitly instead of relying on this default.
  const { data: membership, error: memberError } = await supabase
    .from("business_members")
    .select("business_id, role")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (memberError || !membership) return null;

  return { userId, businessId: membership.business_id, role: membership.role };
}

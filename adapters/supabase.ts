/**
 * SUPABASE CLIENT
 * ------------------------------------------------------------------
 * One shared client, reused by every endpoint that needs the database.
 * Uses the SERVICE ROLE key (full access, server-side only) — this
 * must never be sent to the browser. It only ever lives in Vercel's
 * environment variables and this file.
 * ------------------------------------------------------------------
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const supabase = createClient(supabaseUrl, supabaseServiceKey);

export const DEFAULT_BUSINESS_ID = "default";

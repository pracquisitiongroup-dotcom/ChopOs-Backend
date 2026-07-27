/**
 * GOHIGHLEVEL ADAPTER
 * ------------------------------------------------------------------
 * This is the ONLY file in the whole app that knows GHL's specific
 * API shape, field names, and quirks. It translates everything into
 * the CanonicalLead type from models/lead.ts.
 *
 * When you add HubSpot later, you write adapters/hubspot.ts with the
 * exact same function signatures — nothing else in the app changes.
 *
 * Auth: GHL Private Integration Token (Settings -> Private Integrations)
 * Docs: https://marketplace.gohighlevel.com/docs
 * ------------------------------------------------------------------
 */

import type { CanonicalLead, LeadStatus } from "../models/lead";

const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28"; // required "Version" header for all v2 calls

interface GHLConfig {
  privateToken: string; // from Settings -> Private Integrations
  locationId: string;   // your GHL sub-account id
}

function ghlHeaders(config: GHLConfig) {
  return {
    Authorization: `Bearer ${config.privateToken}`,
    "Content-Type": "application/json",
    Version: GHL_API_VERSION,
  };
}

/**
 * Maps a GHL contact's messy status/tag data into our clean LeadStatus enum.
 * Adjust this mapping to match how your specific GHL pipeline actually
 * tags/labels contacts — this is the one part you'll want to tune per business.
 */
function mapGhlStatus(ghlContact: any): LeadStatus {
  const tags: string[] = ghlContact.tags || [];
  if (tags.includes("won") || tags.includes("customer")) return "won";
  if (tags.includes("lost")) return "lost";
  if (tags.includes("cold")) return "cold";
  if (tags.includes("quoted")) return "quoted";
  if (ghlContact.lastActivity) return "contacted";
  return "new";
}

function mapGhlContact(ghlContact: any): CanonicalLead {
  return {
    id: `ghl_${ghlContact.id}`,
    sourceCrm: "gohighlevel",
    sourceId: ghlContact.id,
    name:
      ghlContact.contactName ||
      [ghlContact.firstName, ghlContact.lastName].filter(Boolean).join(" ") ||
      "Unknown",
    email: ghlContact.email || undefined,
    phone: ghlContact.phone || undefined,
    status: mapGhlStatus(ghlContact),
    estimatedValue: ghlContact.opportunityValue || undefined,
    createdAt: ghlContact.dateAdded || new Date().toISOString(),
    lastContactedAt: ghlContact.lastActivity || undefined,
    tags: ghlContact.tags || [],
    raw: ghlContact,
  };
}

/**
 * Fetches contacts from GHL and returns them in the canonical shape.
 * Uses the Search Contacts endpoint (the old GET /contacts/ list endpoint
 * is deprecated by GHL as of 2026).
 */
export async function fetchGhlLeads(
  config: GHLConfig,
  options?: { limit?: number }
): Promise<CanonicalLead[]> {
  const res = await fetch(`${GHL_BASE_URL}/contacts/search`, {
    method: "POST",
    headers: ghlHeaders(config),
    body: JSON.stringify({
      locationId: config.locationId,
      pageLimit: options?.limit ?? 50,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GHL contacts/search failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  const contacts = data.contacts || [];
  return contacts.map(mapGhlContact);
}

/**
 * Scopes you need when generating the Private Integration token in GHL
 * (Settings -> Private Integrations -> Create):
 *   - contacts.readonly
 *   - opportunities.readonly
 *   - calendars.readonly
 * Add the matching *.write scopes only once ChopOS is actually taking
 * actions (sending follow-ups, booking appointments) on the owner's behalf.
 */

/**
 * Sends a real SMS to a contact through GHL's conversations API.
 * This is a WRITE action — requires the `conversations.write` scope
 * on your Private Integration token (add it in GHL: Settings ->
 * Private Integrations -> edit your token -> add scope).
 *
 * contactId must be a real GHL contact id (CanonicalLead.sourceId),
 * not the ChopOS-prefixed CanonicalLead.id.
 */
export async function sendGhlSms(
  config: GHLConfig,
  contactId: string,
  message: string
): Promise<{ success: true; messageId?: string }> {
  const res = await fetch(`${GHL_BASE_URL}/conversations/messages`, {
    method: "POST",
    headers: ghlHeaders(config),
    body: JSON.stringify({
      type: "SMS",
      contactId,
      message,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GHL send message failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return { success: true, messageId: data.messageId };
}

/**
 * OPPORTUNITIES (Revenue / pipeline page)
 * ------------------------------------------------------------------
 * Confirmed real endpoint: GET /opportunities/search
 * Same base URL, same Bearer + Version header auth as everything else.
 */
function mapGhlOpportunity(ghlOpp: any) {
  return {
    id: `ghl_opp_${ghlOpp.id}`,
    sourceCrm: "gohighlevel" as const,
    sourceId: ghlOpp.id,
    leadId: ghlOpp.contactId || "",
    stage: ghlOpp.pipelineStageId || ghlOpp.status || "unknown",
    value: Number(ghlOpp.monetaryValue) || 0,
    probability: undefined,
    createdAt: ghlOpp.createdAt || new Date().toISOString(),
  };
}

export async function fetchGhlOpportunities(
  config: GHLConfig,
  options?: { limit?: number }
) {
  const params = new URLSearchParams({
    locationId: config.locationId,
    limit: String(options?.limit ?? 50),
  });
  const res = await fetch(`${GHL_BASE_URL}/opportunities/search?${params.toString()}`, {
    method: "GET",
    headers: ghlHeaders(config),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GHL opportunities/search failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  const opportunities = data.opportunities || [];
  return opportunities.map(mapGhlOpportunity);
}

/**
 * SOCIAL PLANNER (Google Business Profile posting)
 * ------------------------------------------------------------------
 * GHL's Social Planner API can post to a business's connected GBP
 * listing through the SAME Private Integration Token — no separate
 * Google OAuth needed, as long as the business has already connected
 * their Google Business Profile as a channel inside GHL itself.
 *
 * Confirmed real endpoints from GHL's docs:
 *   GET  /social-media-posting/oauth/:locationId/accounts  (list connected channels)
 *   POST /social-media-posting/:locationId/posts            (create a post)
 *
 * NOTE: GHL's public docs render their request-body schema as an
 * interactive JS table that isn't visible in plain-text fetches, so
 * the exact field names below (accountIds, summary) are my best
 * informed guess based on their written description, not a confirmed
 * schema. If the first real post fails, check the error message for
 * the field name GHL actually expects and this is a one-line fix,
 * not a rebuild — same situation we hit with the conversations scope.
 */
export async function fetchGhlSocialAccounts(config: GHLConfig) {
  const res = await fetch(
    `${GHL_BASE_URL}/social-media-posting/oauth/${config.locationId}/accounts`,
    { method: "GET", headers: ghlHeaders(config) }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GHL social accounts fetch failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return data.accounts || data.results || [];
}

export async function createGhlSocialPost(
  config: GHLConfig,
  accountIds: string[],
  summary: string,
  mediaUrls?: string[]
) {
  const res = await fetch(`${GHL_BASE_URL}/social-media-posting/${config.locationId}/posts`, {
    method: "POST",
    headers: ghlHeaders(config),
    body: JSON.stringify({
      accountIds,
      summary,
      media: (mediaUrls || []).map((url) => ({ url })),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GHL create post failed (${res.status}): ${body}`);
  }
  return await res.json();
}

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

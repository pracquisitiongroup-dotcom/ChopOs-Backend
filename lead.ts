/**
 * CANONICAL MODELS
 * ------------------------------------------------------------------
 * This is the one shape ChopOS's dashboard, AI, and automations ever
 * talk to. It never changes based on which CRM the data came from.
 *
 * Every CRM adapter (ghl.ts, hubspot.ts, salesforce.ts, ...) has one
 * job: take that CRM's weird API shape and map it into THESE types.
 * Nothing else in the app should ever import a CRM-specific type.
 * ------------------------------------------------------------------
 */

export type LeadStatus =
  | "new"
  | "contacted"
  | "quoted"
  | "won"
  | "lost"
  | "cold";

export interface CanonicalLead {
  id: string;              // ChopOS's own id, not the CRM's id
  sourceCrm: "gohighlevel" | "hubspot" | "salesforce" | "servicetitan" | "jobber" | "housecallpro" | "pipedrive";
  sourceId: string;         // the id inside that CRM, kept for write-back
  name: string;
  email?: string;
  phone?: string;
  status: LeadStatus;
  estimatedValue?: number;  // dollars
  createdAt: string;        // ISO date
  lastContactedAt?: string; // ISO date
  tags: string[];
  raw: Record<string, unknown>; // original CRM payload, for debugging only — never read by the UI
}

export interface CanonicalOpportunity {
  id: string;
  sourceCrm: CanonicalLead["sourceCrm"];
  sourceId: string;
  leadId: string;
  stage: string;            // normalized pipeline stage name
  value: number;
  probability?: number;     // 0-100
  createdAt: string;
}

export interface CanonicalAppointment {
  id: string;
  sourceCrm: CanonicalLead["sourceCrm"];
  sourceId: string;
  leadId?: string;
  title: string;
  startsAt: string;
  endsAt: string;
}

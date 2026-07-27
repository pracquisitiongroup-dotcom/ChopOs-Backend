/**
 * GOOGLE BUSINESS PROFILE ADAPTER
 * ------------------------------------------------------------------
 * Deliberately separate from adapters/ghl.ts — GBP is tied to a
 * business's Google account, not their CRM, so this works identically
 * regardless of whether a business runs GHL, HubSpot, or anything else.
 *
 * IMPORTANT — this is not self-serve like GHL's Private Integration
 * tokens. Google requires manual approval of your Cloud project
 * before any of this will actually return data:
 *   1. Create a Google Cloud project, enable these APIs:
 *      - My Business Account Management API
 *      - My Business Business Information API
 *      - (reviews stay on the legacy but still-active v4 API below)
 *   2. Set up an OAuth consent screen (needs a real Terms of Service
 *      and Privacy Policy URL)
 *   3. Submit the Business Profile API access request — needs a
 *      verified, active GBP 60+ days old, submitted while signed in
 *      as that profile's OWNER (not a manager account)
 *   4. Wait for approval (days to weeks, not guaranteed)
 *
 * Confirmed real endpoints as of this build:
 *   Accounts:  GET https://mybusinessaccountmanagement.googleapis.com/v1/accounts
 *   Locations: GET https://mybusinessbusinessinformation.googleapis.com/v1/{accountName}/locations
 *   Reviews:   GET https://mybusiness.googleapis.com/v4/accounts/{accountId}/locations/{locationId}/reviews
 *   OAuth scope needed: https://www.googleapis.com/auth/business.manage
 * ------------------------------------------------------------------
 */

const GOOGLE_OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/business.manage";

export interface GoogleTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string; // ISO date
}

/**
 * Builds the URL to send a business owner to for Google's consent screen.
 * `state` should be the ChopOS businessId so the callback knows which
 * business to attach the resulting tokens to.
 */
export function buildGoogleAuthUrl(state: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || "";
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPE,
    access_type: "offline", // needed to get a refresh_token, not just a short-lived access token
    prompt: "consent",
    state,
  });
  return `${GOOGLE_OAUTH_AUTH_URL}?${params.toString()}`;
}

/** Exchanges the one-time code Google sends back for real access/refresh tokens. */
export async function exchangeGoogleCode(code: string): Promise<GoogleTokens> {
  const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      redirect_uri: process.env.GOOGLE_REDIRECT_URI || "",
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google token exchange failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}

/** Access tokens expire quickly — use the refresh token to get a new one. */
export async function refreshGoogleAccessToken(refreshToken: string): Promise<GoogleTokens> {
  const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google token refresh failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}

function googleHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
}

/** Lists the Google accounts (usually just one) this OAuth grant has access to. */
export async function fetchGoogleAccounts(accessToken: string) {
  const res = await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", {
    headers: googleHeaders(accessToken),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google accounts fetch failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return data.accounts || [];
}

/** Lists locations (business listings) under a given Google account. */
export async function fetchGoogleLocations(accessToken: string, accountName: string) {
  const params = new URLSearchParams({ readMask: "name,title" });
  const res = await fetch(
    `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?${params.toString()}`,
    { headers: googleHeaders(accessToken) }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google locations fetch failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return data.locations || [];
}

/**
 * Fetches reviews for a location — this is the actual feature being built.
 * Reviews stay on Google's older but still-active v4 API.
 */
export async function fetchGoogleReviews(
  accessToken: string,
  accountId: string, // e.g. "123456789" (without the "accounts/" prefix)
  locationId: string // e.g. "987654321" (without the "locations/" prefix)
) {
  const res = await fetch(
    `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/reviews`,
    { headers: googleHeaders(accessToken) }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google reviews fetch failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return (data.reviews || []).map((r: any) => ({
    id: r.reviewId,
    reviewerName: r.reviewer?.displayName || "Anonymous",
    starRating: starRatingToNumber(r.starRating),
    comment: r.comment || "",
    createTime: r.createTime,
    hasReply: !!r.reviewReply,
  }));
}

function starRatingToNumber(rating: string): number {
  const map: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  return map[rating] || 0;
}

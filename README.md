# ChopOS Backend — Starter Slice (GHL, Contacts only)

This is the smallest possible working slice: one real endpoint, pulling
real contacts out of your GHL account, in the canonical shape ChopOS's
dashboard expects. Everything else (Opportunities, Appointments, other
CRMs) follows the exact same pattern once this works end to end.

## 1. Get your GHL Private Integration token

1. In GoHighLevel: **Settings → Private Integrations → Create New**
2. Name it something like "ChopOS"
3. Select these scopes to start:
   - `contacts.readonly`
   - `opportunities.readonly`
   - `calendars.readonly`
4. Save, and copy the generated token — GHL only shows it once
5. Grab your **Location ID** from Settings → Business Info (or the URL
   when you're viewing that sub-account in GHL)

## 2. Local setup

```bash
npm install
cp .env.example .env
# paste your token + location id into .env
npm run dev
```

Vercel's local dev server will run `/api/leads` at
`http://localhost:3000/api/leads` — open it in a browser or `curl` it.
You should see real contacts from your GHL account back as JSON.

## 3. Deploy for free

```bash
npm install -g vercel
vercel
```

Then in the Vercel dashboard for this project: **Settings →
Environment Variables** → add `GHL_PRIVATE_TOKEN` and
`GHL_LOCATION_ID` there (not in a committed file). Redeploy.

You now have a real `https://your-project.vercel.app/api/leads` your
partner (or the ChopOS frontend) can hit and get real data back.

## 4. Wire it into the ChopOS HTML prototype

In the prototype's Customers view, replace the hardcoded customer
cards with a `fetch('/api/leads')` call, and map `CanonicalLead[]`
into the existing card markup. Same shape works no matter which CRM
is behind it later.

## 5. What's next after this works

- Add `adapters/ghl.ts` functions for Opportunities and Appointments
  (same pattern as `fetchGhlLeads`)
- Add a database (Supabase is the easiest free option) so leads are
  cached instead of hitting GHL on every page load, and so Train Chop
  / Memory answers have somewhere permanent to live
- Only once this is solid: register a GHL Marketplace app and build
  the real OAuth flow so *other* businesses' GHL accounts can connect
  through ChopLink, instead of your own hardcoded token

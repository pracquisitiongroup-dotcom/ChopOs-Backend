-- ChopOS database schema
-- ------------------------------------------------------------------
-- Run this in Supabase: your project -> SQL Editor -> New Query ->
-- paste this whole file -> Run.
--
-- Single-tenant for now: every row is tagged business_id = 'default'
-- since ChopOS currently runs against one connected business (yours).
-- When you add real multi-business support later, business_id becomes
-- a real foreign key instead of a hardcoded string — nothing else
-- about the shape needs to change.
-- ------------------------------------------------------------------

create extension if not exists "pgcrypto";

-- Memory page: plain-language beliefs Chop holds about the business
create table if not exists memories (
  id uuid primary key default gen_random_uuid(),
  business_id text not null default 'default',
  text text not null,
  category text not null default 'General',
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);

-- Train Chop: every answer from the onboarding wizard, one row per field
create table if not exists training_answers (
  id uuid primary key default gen_random_uuid(),
  business_id text not null default 'default',
  step integer not null,
  field_key text not null,
  value text,
  updated_at timestamptz not null default now(),
  unique (business_id, step, field_key)
);

-- AI Chat: message history, so Chop can recall earlier turns in a session
-- and so you have a record of what it's been asked/told to do
create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  business_id text not null default 'default',
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_memories_business on memories(business_id);
create index if not exists idx_training_business on training_answers(business_id);
create index if not exists idx_chat_business_time on chat_messages(business_id, created_at);

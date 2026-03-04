-- ─────────────────────────────────────────────────────────────────────────────
-- Messenger Lead Bot — Supabase Schema
-- Run this in Supabase SQL Editor to set up all tables
-- ─────────────────────────────────────────────────────────────────────────────

-- One row per tradesperson client
create table if not exists businesses (
  id                 uuid primary key default gen_random_uuid(),
  business_name      text not null,
  page_id            text unique not null,
  page_access_token  text not null,
  owner_phone        text,
  owner_email        text,
  trade_type         text,
  active             boolean default true,
  created_at         timestamptz default now()
);

-- Active conversations (one per user+page combo)
create table if not exists conversations (
  id                  uuid primary key default gen_random_uuid(),
  messenger_user_id   text not null,
  page_id             text not null,
  state               jsonb default '{}',
  message_history     jsonb default '[]',
  status              text default 'ACTIVE' check (status in ('ACTIVE', 'COMPLETE', 'ABANDONED')),
  started_at          timestamptz default now(),
  last_message_at     timestamptz default now(),
  unique (messenger_user_id, page_id)
);

create index if not exists conversations_page_id_idx on conversations (page_id);
create index if not exists conversations_status_idx  on conversations (status);
create index if not exists conversations_last_msg_idx on conversations (last_message_at);

-- Completed leads
create table if not exists leads (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz default now(),
  page_id               text not null,
  business_name         text,
  messenger_user_id     text,
  customer_first_name   text,
  customer_phone        text,
  job_type              text,
  job_description       text,
  location              text,
  timeframe             text,
  budget                text,
  lead_score            int check (lead_score in (1, 2, 3)),
  lead_label            text check (lead_label in ('HOT', 'WARM', 'COLD')),
  ai_summary            text,
  full_conversation     jsonb,
  status                text default 'NEW' check (status in ('NEW', 'CONTACTED', 'CONVERTED', 'LOST')),
  notified_at           timestamptz,
  notes                 text
);

create index if not exists leads_page_id_idx  on leads (page_id);
create index if not exists leads_status_idx   on leads (status);
create index if not exists leads_score_idx    on leads (lead_score desc);
create index if not exists leads_created_idx  on leads (created_at desc);

-- Error log
create table if not exists errors (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz default now(),
  service        text,
  error_message  text,
  context        jsonb
);

-- ─── Row Level Security ───────────────────────────────────────────────────────
-- Using service role key server-side so RLS is disabled for now.
-- Enable and add policies when building a customer-facing dashboard.
alter table businesses    disable row level security;
alter table conversations disable row level security;
alter table leads         disable row level security;
alter table errors        disable row level security;

-- ─── Sample business (for testing) ───────────────────────────────────────────
-- Replace with real values before testing
-- insert into businesses (business_name, page_id, page_access_token, owner_phone, owner_email, trade_type)
-- values ('Mike Murphy Plumbing', '123456789', 'EAAxxxxxxxx', '+353871234567', 'mike@example.com', 'Plumber');

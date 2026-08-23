-- ============================================================================
-- Migration: create admin_users table
-- Admin Operations Dashboard V1 milestone.
--
-- Authentication (is this really a Supabase Auth user?) is handled entirely
-- by Supabase Auth itself (auth.users) — this table is the AUTHORIZATION
-- layer on top of it: a Supabase Auth user is only an admin if they also
-- have an active row here. See src/lib/admin/require-admin.ts, which is the
-- only code path that ever reads this table (via the service-role admin
-- client — an authenticated-but-non-admin user has zero grant/RLS access to
-- query this table about themselves, same zero-policy convention as every
-- other table in this schema).
--
-- role uses a plain text + CHECK (not a Postgres enum), matching this
-- schema's existing convention (package_amendments.old_cadence,
-- booking_orders.status, etc. are all text+CHECK) — this lets 'owner',
-- 'manager', 'scheduler' be added later as a one-line CHECK-constraint
-- migration without a schema redesign, per the approved V1 scope (no RBAC
-- system built now).
--
-- No self-signup UI exists or is planned — admin accounts (a Supabase Auth
-- user plus the corresponding row here) are provisioned manually via the
-- Supabase dashboard, appropriate for a small internal operations team.
-- ============================================================================

create table public.admin_users (
  id uuid primary key default gen_random_uuid(),

  supabase_user_id uuid not null unique references auth.users (id),

  role text not null default 'admin'
    check (role in ('admin')),

  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.admin_users is
  'Authorization layer for the Admin Operations Dashboard: a Supabase Auth user (auth.users) is only permitted into /admin once they also have an active row here. Read exclusively via the service-role admin client from src/lib/admin/require-admin.ts — never via a client-trusted role flag.';

comment on column public.admin_users.supabase_user_id is
  'FK to auth.users.id — the authenticated identity. unique so each Supabase Auth user maps to at most one admin_users row; also serves as the lookup index for require-admin.ts.';

comment on column public.admin_users.role is
  'V1 only ever has ''admin''. Deliberately a text+CHECK, not an enum, so future roles (owner/manager/scheduler) are a one-line additive migration — no RBAC system is built in this milestone.';

-- Reuses the shared trigger function defined in
-- 20260817200000_create_customers.sql.
create trigger admin_users_set_updated_at
before update on public.admin_users
for each row execute function public.set_updated_at();

alter table public.admin_users enable row level security;

revoke all privileges
on table public.admin_users
from anon, authenticated;

grant select, insert, update
on table public.admin_users
to service_role;
-- No delete grant — deactivate (active = false) instead of deleting, same
-- convention as every other table in this schema (e.g. cleaners).

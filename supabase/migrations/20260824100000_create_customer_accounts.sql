-- ============================================================================
-- Migration: create customer_accounts table
-- My CleanPerfecto — Customer Portal V1 milestone.
--
-- Authentication (is this really a Supabase Auth user?) is handled entirely
-- by Supabase Auth itself (auth.users) — this table is the AUTHORIZATION/
-- LINKING layer on top of it, mirroring admin_users' own role exactly:
-- a Supabase Auth user only gets portal access to a specific customers row
-- once this table links the two. See src/lib/customer-portal/require-customer.ts,
-- the only code path that reads this table (via the service-role admin
-- client — same zero-policy convention as every other table in this schema).
--
-- Deliberately a separate table rather than a customers.supabase_user_id
-- column: customers stays a pure business/CRM record (see its own table
-- comment), identity/auth is a different concern, and activation becomes an
-- explicit, auditable event (a row appearing with activated_at) rather than
-- a nullable column quietly filled in. admin_users and customer_accounts are
-- fully independent — both may reference the SAME auth.users row (a person
-- can legitimately be both staff and a customer), but neither table implies
-- or grants the other's access.
--
-- Both FKs are unique: one Supabase Auth login maps to at most one customer
-- record, and one customer record is claimed by at most one login — see
-- activate-customer-account.ts for the zero/one/many-match resolution rules
-- this enforces at the application layer before ever inserting here.
-- ============================================================================

create table public.customer_accounts (
  id uuid primary key default gen_random_uuid(),

  supabase_user_id uuid not null unique references auth.users (id),
  customer_id uuid not null unique references public.customers (id),

  active boolean not null default true,
  activated_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.customer_accounts is
  'Authorization/linking layer for My CleanPerfecto: a Supabase Auth user (auth.users) is only permitted into /my, and only as a specific customers row, once linked here. Read/written exclusively via the service-role admin client from src/lib/customer-portal/require-customer.ts and activate-customer-account.ts — never via a client-trusted email match.';

comment on column public.customer_accounts.supabase_user_id is
  'FK to auth.users.id — the authenticated identity. unique so each Supabase Auth user maps to at most one customer_accounts row.';

comment on column public.customer_accounts.customer_id is
  'FK to customers.id — unique so each customer record is claimed by at most one Supabase Auth login. Once set, this relationship is immutable for ordinary self-service flows: a later change to customers.email or auth.users.email never re-triggers identity resolution.';

create trigger customer_accounts_set_updated_at
before update on public.customer_accounts
for each row execute function public.set_updated_at();

alter table public.customer_accounts enable row level security;

revoke all privileges
on table public.customer_accounts
from anon, authenticated;

grant select, insert, update
on table public.customer_accounts
to service_role;
-- No delete grant — deactivate (active = false) instead of deleting, same
-- convention as every other table in this schema.

-- ============================================================================
-- Migration: claim_customer_login_link_request — server-side rate limiting
-- for the customer /my/login "email me a sign-in link" request.
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- /my/login's form now calls requestCustomerLoginLink
-- (src/lib/customer-portal/request-customer-login-link.ts), which mints a
-- real one-click link via the SAME admin generateLink mechanism
-- (createSupabaseCustomerAuthLinkGenerator) and sends it via Resend,
-- replacing the old client-side supabase.auth.signInWithOtp call (which
-- depended on Supabase's own Auth "Redirect URLs" allowlist — the actual
-- root cause of magic links silently landing on the public homepage
-- instead of the customer portal, confirmed against a real Preview
-- deployment). The admin generateLink API has no built-in per-email rate
-- limit of its own (that protection only ever applied to the public
-- /otp endpoint signInWithOtp used), so this migration adds one.
--
-- A plain, append-only ledger (one row per request, never updated) plus an
-- atomic claim function — same advisory-lock-then-count convention as
-- claim_payment_link_resend (see that migration's own comment), scoped by
-- email instead of a visit id, and deliberately simpler: a single sliding
-- window/cap is enough for a login request (no separate short "duplicate
-- click" cooldown tier is needed the way a financial document resend
-- needed one).
--
-- Raises a plain exception with message 'rate_limited' when blocked — same
-- convention as every other business-rule rejection in this schema.
-- ============================================================================

create table public.customer_login_link_requests (
  id uuid primary key default gen_random_uuid(),
  email_normalized text not null,
  requested_at timestamptz not null default now()
);

comment on table public.customer_login_link_requests is
  'Append-only rate-limit ledger for /my/login sign-in-link requests, keyed by normalized email — never updated after insert. See claim_customer_login_link_request().';

create index customer_login_link_requests_email_requested_at_idx
  on public.customer_login_link_requests (email_normalized, requested_at desc);

alter table public.customer_login_link_requests enable row level security;

revoke all privileges
on table public.customer_login_link_requests
from anon, authenticated;

grant select, insert
on table public.customer_login_link_requests
to service_role;
-- No update/delete grant — append-only, same convention as
-- financial_audit_log/service_visit_events.

create or replace function public.claim_customer_login_link_request(
  p_email_normalized text,
  p_now timestamptz,
  p_rate_limit_window_seconds integer,
  p_rate_limit_max integer
)
returns public.customer_login_link_requests
language plpgsql
set search_path = public
as $$
declare
  v_lock_key bigint;
  v_recent_count integer;
  v_row customer_login_link_requests;
begin
  -- Keyed on the email (not a row id, since none exists yet) — serializes
  -- concurrent requests for the SAME email only, never blocking unrelated
  -- emails' requests against each other.
  v_lock_key := ('x' || substr(md5(p_email_normalized), 1, 15))::bit(60)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  select count(*) into v_recent_count
  from customer_login_link_requests
  where email_normalized = p_email_normalized
    and requested_at > p_now - make_interval(secs => p_rate_limit_window_seconds);

  if v_recent_count >= p_rate_limit_max then
    raise exception 'rate_limited';
  end if;

  insert into customer_login_link_requests (email_normalized, requested_at)
  values (p_email_normalized, p_now)
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.claim_customer_login_link_request(text, timestamptz, integer, integer) is
  'Atomically rate-limits /my/login sign-in-link requests per normalized email: advisory-locks on the email, counts requests in the trailing window, raises ''rate_limited'' at the cap, otherwise inserts and returns the new ledger row. Never reveals whether the email matches a real customer — this check runs identically regardless.';

revoke all on function public.claim_customer_login_link_request(text, timestamptz, integer, integer)
from public, anon, authenticated;

grant execute on function public.claim_customer_login_link_request(text, timestamptz, integer, integer)
to service_role;

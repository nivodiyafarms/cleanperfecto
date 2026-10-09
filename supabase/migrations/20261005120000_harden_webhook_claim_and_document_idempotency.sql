-- ============================================================================
-- Migration: harden Stripe webhook claim atomicity + visit-payment document
-- issuance idempotency.
--
-- AUTHORED ONLY. Do not apply to production. Fixes two concurrency gaps
-- found during production-readiness review:
--
-- 1. stripe_webhook_events.claim_stripe_webhook_event(): the previous
--    application-level claim (read processing_status, then a separate
--    unconditional UPDATE to 'processing') had a TOCTOU race — two
--    concurrent deliveries of the same event could both read a non-
--    'processed' status before either wrote 'processing', so both would
--    proceed to run fulfillment. This function makes the claim a single
--    conditional UPDATE ... WHERE statement (the only way Postgres actually
--    serializes concurrent claimants on the same row), and adds a lease
--    (processing_claimed_at) so a crashed/killed worker that never reaches
--    'processed' or 'failed' does not strand the event in 'processing'
--    forever — a later retry can reclaim it once the lease expires.
--
-- 2. receipts had no uniqueness tied to the settlement it documents, so two
--    calls issuing documents for the same service_visit_payment_id (racing,
--    or triggered by two distinct Stripe events for the same underlying
--    payment) could each allocate and insert their own invoice+receipt
--    pair. issue_visit_payment_documents() closes this with a
--    transaction-scoped advisory lock keyed on the settlement id (so
--    concurrent callers serialize and the second sees the first's already-
--    committed receipt) plus a partial unique index as a permanent backstop.
--    Deliberately scoped to service_visit_payment_id only — NOT
--    service_visit_id (one visit can legitimately carry more than one
--    invoice over its lifetime: a cancellation-fee invoice alongside the
--    visit-payment invoice, or a voided-then-reissued correction) and NOT
--    service_fee_assessment_id/prepaid_package_id (different call sites,
--    not implicated in this bug, out of scope for this fix).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1a. Lease column for the webhook claim.
-- ---------------------------------------------------------------------------

alter table public.stripe_webhook_events
  add column processing_claimed_at timestamptz;

comment on column public.stripe_webhook_events.processing_claimed_at is
  'Set by claim_stripe_webhook_event() each time a row transitions into processing_status=processing. Doubles as (a) the claim token markWebhookEventProcessed/Failed must present to actually commit their transition — a stale worker superseded by a later reclaim cannot clobber it — and (b) the lease expiry claim_stripe_webhook_event() checks to reclaim a row whose worker crashed without ever reaching processed/failed.';

-- Serves BookingRepository.listStuckWebhookEvents (src/lib/booking/webhook/
-- retry-stuck-webhook-events.ts) — the lease alone doesn't schedule
-- anything; this is what a periodic sweep needs to cheaply find
-- 'failed' rows and 'processing' rows past their lease.
create index stripe_webhook_events_stuck_lookup_idx
  on public.stripe_webhook_events (processing_status, processing_claimed_at)
  where processing_status in ('processing', 'failed');

-- ---------------------------------------------------------------------------
-- 1b. Atomic claim-or-reclaim. Single statement, not a read-then-write.
-- ---------------------------------------------------------------------------

create or replace function public.claim_stripe_webhook_event(
  p_stripe_event_id text,
  p_event_type text,
  p_payload jsonb,
  p_lease_seconds integer default 300
)
returns table (event_row_id uuid, should_process boolean, claim_token timestamptz)
language plpgsql
set search_path = public
as $$
declare
  v_id uuid;
  v_token timestamptz := clock_timestamp();
  v_claimed boolean;
begin
  insert into stripe_webhook_events (stripe_event_id, event_type, payload, processing_status)
  values (p_stripe_event_id, p_event_type, p_payload, 'received')
  on conflict (stripe_event_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from stripe_webhook_events where stripe_event_id = p_stripe_event_id;
  end if;

  -- The single compare-and-swap: only a row currently 'received'/'failed',
  -- or a 'processing' row whose lease has expired, can be (re)claimed. A
  -- 'processed' row, or a 'processing' row still within its lease, matches
  -- neither branch, so this affects 0 rows and v_claimed stays false —
  -- correctly covering both "permanent no-op" and "another delivery is
  -- legitimately still working this one right now" with the same safe
  -- caller behavior (skip), while never permanently stranding the latter.
  update stripe_webhook_events
  set processing_status = 'processing', processing_claimed_at = v_token
  where id = v_id
    and (
      processing_status in ('received', 'failed')
      or (processing_status = 'processing' and processing_claimed_at < clock_timestamp() - make_interval(secs => p_lease_seconds))
    )
  returning true into v_claimed;

  return query select v_id, coalesce(v_claimed, false), v_token;
end;
$$;

comment on function public.claim_stripe_webhook_event(text, text, jsonb, integer) is
  'Atomic claim-or-reclaim for a Stripe webhook delivery: inserts the ledger row if new, then attempts a single conditional UPDATE to processing_status=processing. should_process=false means either a prior delivery already reached processed (permanent no-op) or another delivery currently holds an unexpired processing lease (safe skip, not stranded — see p_lease_seconds). Sole caller: BookingRepository.claimWebhookEvent (src/lib/booking/supabase-booking-repository.ts).';

revoke all on function public.claim_stripe_webhook_event(text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.claim_stripe_webhook_event(text, text, jsonb, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 2a. Permanent backstop: at most one receipt per visit-payment settlement.
-- ---------------------------------------------------------------------------

create unique index receipts_service_visit_payment_id_unique
  on public.receipts (service_visit_payment_id)
  where service_visit_payment_id is not null;

comment on index public.receipts_service_visit_payment_id_unique is
  'At most one receipt per settled service_visit_payments row, ever — receipts are fully append-only/immutable (see table comment), so unlike invoices there is no legitimate reissue case here. Scoped to service_visit_payment_id only, not service_visit_id (see migration header) and not service_fee_assessment_id/prepaid_package_id (different call sites, out of scope for this fix).';

-- ---------------------------------------------------------------------------
-- 2b. Idempotent combined issuance, serialized per settlement.
-- ---------------------------------------------------------------------------

create or replace function public.issue_visit_payment_documents(
  p_service_visit_payment_id uuid,
  p_source_type text,
  p_service_visit_id uuid,
  p_prepaid_package_id uuid,
  p_service_visit_pricing_id uuid,
  p_service_fee_assessment_id uuid,
  p_customer_id uuid,
  p_customer_display_name text,
  p_description text,
  p_service_address_line1 text,
  p_service_address_line2 text,
  p_service_city text,
  p_service_state text,
  p_service_zip text,
  p_service_date date,
  p_cleaning_type text,
  p_currency text,
  p_base_amount numeric,
  p_room_adjustments_amount numeric,
  p_add_ons_amount numeric,
  p_add_ons_detail jsonb,
  p_travel_amount numeric,
  p_supplies_amount numeric,
  p_custom_charges_amount numeric,
  p_custom_charges_detail jsonb,
  p_discount_amount numeric,
  p_discount_description text,
  p_discount_detail jsonb,
  p_cancellation_fee_amount numeric,
  p_tax_amount numeric,
  p_subtotal_amount numeric,
  p_total_amount numeric,
  p_pricing_snapshot jsonb,
  p_payment_timestamp timestamptz,
  p_amount_paid numeric,
  p_tax_paid numeric,
  p_tip_paid numeric,
  p_payment_method_display text,
  p_stripe_payment_intent_id text,
  p_stripe_charge_id text
)
returns table (invoice_json jsonb, receipt_json jsonb, was_already_issued boolean)
language plpgsql
set search_path = public
as $$
declare
  v_invoice invoices;
  v_receipt receipts;
  v_existing_receipt receipts;
begin
  -- Serialize every concurrent/duplicate attempt to document this exact
  -- settlement onto one another — released automatically at commit or
  -- rollback of this call's own transaction. This is what actually
  -- prevents the orphaned-invoice case (an invoice inserted, then losing
  -- the receipt race) rather than just narrowing the window: the second
  -- caller's existence check below only runs after the first caller's
  -- insert has fully committed.
  perform pg_advisory_xact_lock(hashtextextended('issue_visit_payment_documents:' || p_service_visit_payment_id::text, 0));

  select * into v_existing_receipt
  from receipts
  where service_visit_payment_id = p_service_visit_payment_id
  limit 1;

  if v_existing_receipt.id is not null then
    select * into v_invoice from invoices where id = v_existing_receipt.invoice_id;
    return query select to_jsonb(v_invoice), to_jsonb(v_existing_receipt), true;
    return;
  end if;

  v_invoice := issue_invoice(
    p_source_type, p_service_visit_id, p_prepaid_package_id, p_service_visit_pricing_id,
    p_service_fee_assessment_id, p_customer_id, p_customer_display_name, p_description,
    p_service_address_line1, p_service_address_line2, p_service_city, p_service_state, p_service_zip,
    p_service_date, p_cleaning_type, p_currency,
    p_base_amount, p_room_adjustments_amount, p_add_ons_amount, p_add_ons_detail,
    p_travel_amount, p_supplies_amount, p_custom_charges_amount, p_custom_charges_detail,
    p_discount_amount, p_discount_description, p_discount_detail,
    p_cancellation_fee_amount, p_tax_amount, p_subtotal_amount, p_total_amount, p_pricing_snapshot
  );

  v_receipt := issue_receipt(
    v_invoice.id, p_customer_id, 'visit_payment', p_service_visit_payment_id, null, null,
    p_payment_timestamp, p_amount_paid, p_tax_paid, p_tip_paid,
    p_payment_method_display, p_stripe_payment_intent_id, p_stripe_charge_id, p_currency
  );

  return query select to_jsonb(v_invoice), to_jsonb(v_receipt), false;
end;
$$;

comment on function public.issue_visit_payment_documents(
  uuid, text, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, date, text, text,
  numeric, numeric, numeric, jsonb, numeric, numeric, numeric, jsonb, numeric, text, jsonb, numeric, numeric, numeric, numeric, jsonb,
  timestamptz, numeric, numeric, numeric, text, text, text
) is
  'Idempotent, concurrency-safe wrapper around issue_invoice()+issue_receipt() for the visit-payment settlement rail (stripe_card and zelle/cash both funnel through this). Locks per service_visit_payment_id for the transaction, returns the already-issued pair (was_already_issued=true) if one exists rather than creating a second. Sole caller: src/lib/invoicing/issue-documents-for-visit-payment.ts via SchedulingRepository.issueVisitPaymentDocumentsIdempotent.';

revoke all on function public.issue_visit_payment_documents(
  uuid, text, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, date, text, text,
  numeric, numeric, numeric, jsonb, numeric, numeric, numeric, jsonb, numeric, text, jsonb, numeric, numeric, numeric, numeric, jsonb,
  timestamptz, numeric, numeric, numeric, text, text, text
) from public, anon, authenticated;

grant execute on function public.issue_visit_payment_documents(
  uuid, text, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, date, text, text,
  numeric, numeric, numeric, jsonb, numeric, numeric, numeric, jsonb, numeric, text, jsonb, numeric, numeric, numeric, numeric, jsonb,
  timestamptz, numeric, numeric, numeric, text, text, text
) to service_role;

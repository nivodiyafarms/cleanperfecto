-- ============================================================================
-- Migration: add ACH payment-method audit fields, a specific preferred
-- start-time field, and cancellation-policy versioning
-- Booking + Payment product revision (owner-approved 2026-08-19).
--
-- REVIEW ONLY — DO NOT APPLY YET. Created for review and dry-run approval
-- per the approved revision plan. Purely additive: no drops, no renames,
-- no destructive change to any existing sandbox/QA row. All new columns
-- are nullable, so every historical row remains valid without a backfill.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- payment_attempts: which payment method was used for a prepaid purchase,
-- and the ACH-incentive audit trail. Together with the existing `amount`
-- column (already the server-authoritative charged subtotal for
-- mode='payment'), this reconstructs: payment method choice, package
-- subtotal before the ACH incentive, the ACH savings amount, and the final
-- pre-tax charged subtotal — the full audit trail for a discounted ACH
-- purchase. Null for every existing row and for every mode='setup' attempt,
-- where payment method choice is not yet meaningful.
-- ----------------------------------------------------------------------------

alter table public.payment_attempts
  add column payment_method_type text
    check (payment_method_type is null or payment_method_type in ('card', 'us_bank_account'));

alter table public.payment_attempts
  add column package_subtotal_before_ach_incentive numeric(10, 2);

alter table public.payment_attempts
  add column ach_savings_amount numeric(10, 2);

comment on column public.payment_attempts.payment_method_type is
  'Which Stripe payment method this attempt is restricted to (see createPrepaidCardCheckoutSession/createPrepaidAchCheckoutSession — payment_method_types is always explicitly set to exactly one method for a prepaid attempt, never left to Dashboard-managed dynamic selection, so card and ACH pricing can never be interchanged within one session). Null for setup-mode attempts and for attempts created before this migration.';

comment on column public.payment_attempts.package_subtotal_before_ach_incentive is
  'For an ACH prepaid attempt only: the trusted, already-10%-discounted prepaidPackageTotal from the pricing engine BEFORE the additional 1% ACH incentive (see ach-incentive.ts). Null for card attempts and for setup-mode attempts.';

comment on column public.payment_attempts.ach_savings_amount is
  'For an ACH prepaid attempt only: the dollar amount saved by the 1% ACH incentive (package_subtotal_before_ach_incentive - amount). Null for card attempts and for setup-mode attempts.';

-- ----------------------------------------------------------------------------
-- booking_orders: a specific preferred start time (replaces the
-- Morning/Afternoon/Evening picker going forward) and which cancellation-
-- policy text version the customer accepted.
--
-- The existing requested_time_window enum column is intentionally left
-- untouched — not dropped, not renamed. New normal bookings simply stop
-- writing to it and write requested_start_time instead, so no historical
-- QA row needs a backfill or type cast.
-- ----------------------------------------------------------------------------

alter table public.booking_orders
  add column requested_start_time time;

alter table public.booking_orders
  add column cancellation_policy_version text;

comment on column public.booking_orders.requested_start_time is
  'A specific requested cleaning start time (still a request, not a guaranteed slot — see the approved revision plan). Replaces requested_time_window for new normal bookings; that legacy column is kept, unused, for historical rows.';

comment on column public.booking_orders.cancellation_policy_version is
  'Which version of the disclosed cancellation/rescheduling fee policy the customer accepted, recorded at the same moment as payment_authorization_accepted_at (a single combined authorization now covers both saving the payment method for the approved cleaning charge AND the disclosed late-cancellation/rescheduling/no-access fees — see cancellation-policy.ts). Null for rows created before this policy existed.';

-- No NOT NULL / required-for-normal constraint is added on either new
-- column (unlike payment_authorization_accepted_at's existing constraint)
-- — doing so would fail validation against already-existing normal-booking
-- QA rows that predate this migration. Enforcement for new rows is
-- application-level in create-normal-booking-checkout.ts, the same
-- precedent already used for requested_date.

-- Extend the existing prepaid-has-no-schedule-fields rule to also cover
-- the new start-time column. Safe against existing data: every existing
-- prepaid_package row already has requested_time_window null, and no row
-- of any type yet has requested_start_time populated.
alter table public.booking_orders
  drop constraint booking_orders_prepaid_has_no_schedule_fields;

alter table public.booking_orders
  add constraint booking_orders_prepaid_has_no_schedule_fields check (
    booking_type = 'normal'
    or (requested_date is null and requested_time_window is null and requested_start_time is null)
  );

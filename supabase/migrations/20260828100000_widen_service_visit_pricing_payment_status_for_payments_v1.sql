-- ============================================================================
-- Migration: widen service_visit_pricing.payment_status for Payments V1
-- Pay-Per-Cleaning Charge & Payment Completion V1 milestone.
--
-- Purely additive widening of the existing payment_status vocabulary (see
-- 20260824100400_create_service_visit_pricing.sql) — no new column, no
-- rename of the existing 5 values. Adds exactly the states this milestone's
-- real off-Checkout payment lifecycle needs:
--   processing            - a PaymentIntent/external settlement is in flight
--   requires_action        - a Stripe card charge needs customer authentication
--   partially_refunded      - a Stripe refund has been applied, not in full
--   refunded                - a Stripe refund has been applied in full
--   no_payment_due          - the visit completed and the customer went
--                              through the full Review Charges -> Tip ->
--                              Confirm & Pay flow, but the collectible total
--                              (service/extras + tip) resolved to exactly
--                              $0 — distinct from 'paid' since no actual
--                              charge/settlement occurred (see
--                              service_visit_payments.status, which mirrors
--                              this same vocabulary for the payment-attempt
--                              record itself).
-- ============================================================================

alter table public.service_visit_pricing
  drop constraint service_visit_pricing_payment_status_check;

alter table public.service_visit_pricing
  add constraint service_visit_pricing_payment_status_check
  check (payment_status in (
    'not_applicable',
    'awaiting_completion',
    'awaiting_payment',
    'processing',
    'requires_action',
    'paid',
    'payment_failed',
    'partially_refunded',
    'refunded',
    'no_payment_due'
  ));

comment on column public.service_visit_pricing.payment_status is
  'not_applicable: nothing customer-owed yet to track (e.g. package base with no extras). awaiting_completion: an amount is owed but the visit has not completed yet. awaiting_payment: the visit completed and the customer has not yet completed Review Charges -> Tip -> Confirm & Pay (or an Admin external-payment recording). processing/requires_action: a Stripe PaymentIntent attempt is in flight or needs customer authentication (Payments V1, see service_visit_payments). paid: settled, via Stripe card or Admin-recorded Cash/Zelle. payment_failed: the attempt failed and may be retried. partially_refunded/refunded: a Stripe refund was applied after paid. no_payment_due: the customer completed the payment review flow but the collectible total (service/extras + tip) was exactly $0 — no PaymentIntent was ever created. This column always mirrors the authoritative service_visit_payments.status for the visit once one exists (see that table). Independent of price_status.';

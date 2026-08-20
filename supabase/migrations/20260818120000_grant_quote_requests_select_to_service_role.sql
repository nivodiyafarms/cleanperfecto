-- ============================================================================
-- Migration: grant service_role SELECT on quote_requests
-- Booking + Payment Phase 1 (owner-approved).
--
-- service_role has had INSERT-only on quote_requests since it was created.
-- The Booking + Payment milestone needs to read a quote back by id (its
-- pricing_snapshot, address, customer_id) to recompute pricing
-- server-side when a customer proceeds from a quote to booking — the
-- browser must never be the price authority.
--
-- This is safe specifically because of the pricing-immutability trigger
-- (protect_quote_pricing_snapshot, added in
-- 20260817200100_extend_quote_requests_for_instant_quotes.sql) already in
-- place, whose own comments describe this exact moment: "a future
-- SELECT/UPDATE grant" being safe to add without risking historical
-- pricing data. This migration only adds SELECT — booking/payment code
-- never writes to quote_requests (booking_orders and prepaid_packages are
-- this milestone's source of truth), so UPDATE is intentionally not
-- granted here.
-- ============================================================================

grant select
on table public.quote_requests
to service_role;

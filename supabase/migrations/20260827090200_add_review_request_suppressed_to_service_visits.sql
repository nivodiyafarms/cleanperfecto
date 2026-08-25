-- ============================================================================
-- Migration: add review_request_suppressed to service_visits
-- Consent + Review Automation V1 milestone.
--
-- Admin-settable, per-visit override: when true, enqueueReviewRequest
-- never enqueues a review_request for THIS visit's completion, regardless
-- of cooldown/suppression state otherwise. For a problem/unhappy visit an
-- admin can proactively suppress the ask without touching the customer's
-- broader notification/consent state.
-- ============================================================================

alter table public.service_visits
  add column review_request_suppressed boolean not null default false;

comment on column public.service_visits.review_request_suppressed is
  'Admin override: when true, completing this visit never enqueues a review_request, regardless of cooldown. Set via the admin visit page for a problem/unhappy cleaning. Never set automatically.';

-- ============================================================================
-- Migration: link package_visit_plans to recurring_visit_plans
-- My CleanPerfecto — Customer Portal V1 wiring.
--
-- package_visit_plans (prepaid-package fulfillment/credit-planning history)
-- and recurring_visit_plans (the universal customer/admin next-six
-- calendar) must never become two independently-drifting sources of truth
-- for the same occurrence. This is the smallest additive linkage that
-- prevents that: a nullable, unique FK from a package's plan row to its
-- corresponding universal plan row.
--
-- Both tables stay structurally exactly as they were — package_visit_plans
-- is not redesigned, just given one new optional pointer. Application code
-- (see sync-linked-recurring-package-plan.ts) keeps both rows' planned_date/
-- planned_start_time/status/service_visit_id equal whenever this link is
-- set, regardless of whether the change originated from an admin action on
-- package_visit_plans or a portal/admin action on recurring_visit_plans.
-- Unique so one universal plan can never be claimed by more than one
-- package plan.
-- ============================================================================

alter table public.package_visit_plans
  add column recurring_visit_plan_id uuid unique references public.recurring_visit_plans (id);

comment on column public.package_visit_plans.recurring_visit_plan_id is
  'Nullable, unique link to this package visit''s corresponding row in the universal recurring_visit_plans calendar. Null for packages scheduled before this linkage existed. When set, this row''s planned_date/planned_start_time/status/service_visit_id are kept equal to the linked recurring_visit_plans row by every domain function that touches either side (see sync-linked-recurring-package-plan.ts) — never two independently-drifting calendars for the same occurrence.';

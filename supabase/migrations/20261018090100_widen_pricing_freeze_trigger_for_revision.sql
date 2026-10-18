-- ============================================================================
-- Migration: widen protect_service_visit_pricing_after_completion() for the
-- "Revise & Resend Final Total" pricing-revision window.
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- Three distinct cases once the parent service_visits.status = 'completed',
-- each narrowly scoped — never "if mid-revision, allow any change":
--
--   A. old.price_status = 'revision_in_progress' (the normal mid-revision
--      recompute/confirm write, by estimateVisitPricing/confirmVisitPricing)
--      — price_status may only move to 'revision_in_progress' (staying) or
--      'confirmed' (finishing); every other pricing column is permitted to
--      change, the same set those two functions already write together as
--      one unit for a work_finished visit, with RBAC enforced at the app
--      layer exactly as it is there.
--   B. old.price_status = 'confirmed' and new.price_status =
--      'revision_in_progress' — the one-shot ENTRY into a revision. Gated
--      by the session-local Postgres setting app.allow_payment_revision_reset,
--      settable only inside start_visit_pricing_revision's own transaction
--      (never reachable through an ordinary application UPDATE) AND
--      restricted to changing ONLY price_status and revision_number —
--      every other pricing column must stay byte-identical in this same
--      statement, or the update is rejected.
--   C. Everything else — the ORIGINAL freeze logic, byte-for-byte
--      unchanged, so every non-revision completed visit behaves exactly as
--      before this migration.
--
-- custom_adjustments/custom_charge_amount/custom_discount_amount are
-- deliberately NOT guarded in any case, exactly as in the original trigger
-- (see 20260824100400_create_service_visit_pricing.sql) — add/remove
-- CustomPricingAdjustment are only ever called pre-completion in the normal
-- flow; their own application-level guards (widened in this same migration
-- group) are what gate them during a revision instead.
--
-- Dependencies: requires service_visit_pricing
-- (20260824100400_create_service_visit_pricing.sql,
-- 20261018090000_widen_service_visit_pricing_for_revision.sql) to already be
-- applied.
--
-- Safety: no DROP/TRUNCATE — a single function replacement (CREATE OR
-- REPLACE, same signature, same return type).
-- ============================================================================

create or replace function public.protect_service_visit_pricing_after_completion()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_visit_status text;
begin
  select status into v_visit_status from service_visits where id = old.service_visit_id;

  if v_visit_status = 'completed' then
    if old.price_status = 'revision_in_progress' then
      -- Case A: normal mid-revision recompute/confirm write.
      if new.price_status not in ('revision_in_progress', 'confirmed') then
        raise exception
          'service_visit_pricing %: while a revision is in progress, price_status may only stay ''revision_in_progress'' or move to ''confirmed'' (attempted %)',
          old.service_visit_id, new.price_status;
      end if;
    elsif old.price_status = 'confirmed' and new.price_status = 'revision_in_progress' then
      -- Case B: the one-shot entry into a revision.
      if current_setting('app.allow_payment_revision_reset', true) is distinct from 'true' then
        raise exception
          'service_visit_pricing %: entering a revision requires start_visit_pricing_revision()',
          old.service_visit_id;
      end if;
      if new.pricing_snapshot is distinct from old.pricing_snapshot
        or new.base_amount is distinct from old.base_amount
        or new.add_on_ids is distinct from old.add_on_ids
        or new.add_on_amount is distinct from old.add_on_amount
        or new.total_amount is distinct from old.total_amount
        or new.amount_due_from_customer is distinct from old.amount_due_from_customer
        or new.previously_approved_amount is distinct from old.previously_approved_amount
      then
        raise exception
          'service_visit_pricing %: entering a revision may only change price_status and revision_number, nothing else',
          old.service_visit_id;
      end if;
    else
      -- Case C: ordinary frozen/confirmed completed visit — the original
      -- freeze logic, unchanged.
      if new.pricing_snapshot is distinct from old.pricing_snapshot
        or new.base_amount is distinct from old.base_amount
        or new.add_on_ids is distinct from old.add_on_ids
        or new.add_on_amount is distinct from old.add_on_amount
        or new.total_amount is distinct from old.total_amount
        or new.amount_due_from_customer is distinct from old.amount_due_from_customer
        or new.price_status is distinct from old.price_status
        or new.previously_approved_amount is distinct from old.previously_approved_amount
      then
        raise exception
          'service_visit_pricing pricing fields are immutable once the parent service_visit has completed (service_visit_id=%). payment_status remains updatable.',
          old.service_visit_id;
      end if;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.protect_service_visit_pricing_after_completion() is
  'BEFORE UPDATE guard: once the parent service_visits.status = ''completed'', rejects any change to pricing/amount/price_status fields — EXCEPT (a) the one-shot entry into a revision (price_status confirmed -> revision_in_progress, gated by app.allow_payment_revision_reset and restricted to touching only price_status/revision_number, settable only by start_visit_pricing_revision), and (b) while old.price_status = ''revision_in_progress'', the normal pricing recompute/confirm write (price_status restricted to staying revision_in_progress or finishing at confirmed; every other pricing column freely recomputable, same as a work_finished visit). payment_status remains updatable throughout, as before.';

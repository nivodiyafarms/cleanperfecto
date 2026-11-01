-- ============================================================================
-- Migration: Google Business Profile reviews cache + admin curation + sync state
--
-- Google Business Profile Reviews milestone (homepage display). This is a
-- new, independent feature area — no pricing/booking/payment table is
-- touched. Prepared and verified against the disposable Supabase project
-- only (see .env.disposable.local / project ref ggcmjiqzsuxlwnoatyjj); NOT
-- applied to production (numabqpfnigejtdwpxng) in this phase. Applying to
-- production requires the same explicit, separate authorization as every
-- other group in "Approved Production Migration Groups."
--
-- Three tables:
--   - google_business_profile_reviews: the synced cache of reviews actually
--     returned by Google. Never a permanent archive — every row carries
--     last_seen_at so the sync job can enforce a content-retention expiry
--     even if syncing stops or Google authorization is revoked (see
--     src/lib/google-reviews/retention.ts). Reviews no longer present in a
--     *complete* successful fetch are deleted by the reconciliation step
--     (never by a partial/failed fetch — see src/lib/google-reviews/sync.ts).
--   - featured_google_reviews: the admin's curated subset + display order
--     shown on the homepage. FK cascade means a review Google stops
--     returning (and that therefore gets reconciled away) automatically
--     drops out of the featured set too.
--   - google_business_profile_sync_state: a singleton row (id = 1) holding
--     Google's own aggregate rating/count — shown on the homepage as-is,
--     never recomputed from the featured subset — plus last sync status for
--     the admin screen.
--
-- Same zero-policy convention as every other table in this schema: RLS
-- enabled, anon/authenticated get zero grants, service_role gets exactly
-- the operations the app needs. No table here is ever queried from the
-- browser directly — the homepage section and admin screen are server
-- components/actions that select only the public-safe columns they need.
-- ============================================================================

create table public.google_business_profile_reviews (
  id uuid primary key default gen_random_uuid(),

  google_review_id text not null unique,
  reviewer_display_name text not null,
  reviewer_photo_url text,
  star_rating smallint not null check (star_rating between 1 and 5),
  review_text text,
  review_created_at timestamptz not null,
  review_updated_at timestamptz not null,

  first_synced_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.google_business_profile_reviews is
  'Synced cache of reviews returned by the Business Profile API for our verified listing. Not a permanent archive — last_seen_at drives a content-retention expiry (see retention.ts) independent of whether syncing is currently working. review_text is nullable because a rating-only Google review has no text.';

comment on column public.google_business_profile_reviews.last_seen_at is
  'Updated to now() only when a COMPLETE successful fetch of every review page re-confirms this row. Drives (a) retention expiry — a row whose last_seen_at falls outside the retention window is deleted regardless of sync outcome, and (b) is distinct from review_updated_at, which is Google''s own edit timestamp for the review content itself.';

create trigger google_business_profile_reviews_set_updated_at
before update on public.google_business_profile_reviews
for each row execute function public.set_updated_at();

alter table public.google_business_profile_reviews enable row level security;

revoke all privileges
on table public.google_business_profile_reviews
from anon, authenticated;

grant select, insert, update, delete
on table public.google_business_profile_reviews
to service_role;

-- ----------------------------------------------------------------------------

create table public.featured_google_reviews (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.google_business_profile_reviews (id) on delete cascade,
  display_order smallint not null check (display_order between 1 and 5),
  created_at timestamptz not null default now(),

  unique (review_id),
  unique (display_order)
);

comment on table public.featured_google_reviews is
  'Admin-curated subset (up to 5) + order shown in the homepage "Featured Google Reviews" section. on delete cascade: if a review is reconciled away because Google no longer returns it, it automatically drops out of the featured set rather than leaving a dangling reference.';

alter table public.featured_google_reviews enable row level security;

revoke all privileges
on table public.featured_google_reviews
from anon, authenticated;

grant select, insert, update, delete
on table public.featured_google_reviews
to service_role;

-- ----------------------------------------------------------------------------

create table public.google_business_profile_sync_state (
  id smallint primary key default 1 check (id = 1),

  overall_rating numeric(2, 1),
  total_review_count integer,

  last_successful_sync_at timestamptz,
  last_sync_attempt_at timestamptz,
  last_sync_error text,

  updated_at timestamptz not null default now()
);

comment on table public.google_business_profile_sync_state is
  'Singleton (id = 1, seeded below, never inserted again by the app) holding Google''s own aggregate rating/total_review_count from the reviews.list response — the homepage always shows this, never a figure recomputed from only the featured cards. last_successful_sync_at is null until the first real sync ever completes; the homepage section stays hidden until it is non-null AND at least one featured review exists.';

create trigger google_business_profile_sync_state_set_updated_at
before update on public.google_business_profile_sync_state
for each row execute function public.set_updated_at();

insert into public.google_business_profile_sync_state (id) values (1);

alter table public.google_business_profile_sync_state enable row level security;

revoke all privileges
on table public.google_business_profile_sync_state
from anon, authenticated;

grant select, update
on table public.google_business_profile_sync_state
to service_role;
-- No insert/delete grant — exactly one row exists for the lifetime of the
-- table, seeded by this migration; the app only ever updates it.

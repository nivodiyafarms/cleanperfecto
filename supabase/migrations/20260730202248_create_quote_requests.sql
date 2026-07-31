create table public.quote_requests (
  id uuid primary key default gen_random_uuid(),

  name text not null,
  phone text not null,
  email text not null,
  zip text not null,

  property_type text not null
    check (
      property_type in (
        'home',
        'airbnb',
        'restaurant',
        'office'
      )
    ),

  service_id text not null
    check (
      service_id in (
        'standard',
        'deep',
        'move',
        'recurring'
      )
    ),

  preferred_date date,
  message text,

  status text not null default 'new'
    check (
      status in (
        'new',
        'contacted',
        'quoted',
        'booked',
        'closed',
        'spam'
      )
    ),

  created_at timestamptz not null default now()
);

comment on table public.quote_requests is
  'Quote requests submitted through the CleanPerfecto website.';

alter table public.quote_requests enable row level security;

revoke all privileges
on table public.quote_requests
from anon, authenticated;

create index quote_requests_status_created_at_idx
on public.quote_requests (status, created_at desc);

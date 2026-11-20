-- Group seats: an instructor or program buys course seats for a class.
--
-- Each group (class) has a join code. Students open the join link, confirm
-- their email, and get one year of course access; each one uses a seat.
-- The instructor sees who joined, and their certificates, at /#group.
--
-- Run in the Supabase SQL Editor (after 0001-0004). Safe to re-run.

create table if not exists public.ecg_course_groups (
	id uuid primary key default gen_random_uuid(),
	code text not null unique,                 -- the join code, e.g. K7QM-3RXP
	org_name text not null default '',         -- program / class name shown to students
	owner_email text not null,                 -- the instructor who bought it
	owner_name text not null default '',
	seats integer not null default 0 check (seats >= 0),
	seats_used integer not null default 0 check (seats_used >= 0),
	join_until timestamptz,                    -- seats can be used until this date
	created_at timestamptz not null default now()
);
create index if not exists ecg_course_groups_owner_idx on public.ecg_course_groups (owner_email);

-- One row per Stripe payment for seats (a group can buy more seats later).
create table if not exists public.ecg_course_group_purchases (
	id uuid primary key default gen_random_uuid(),
	group_id uuid references public.ecg_course_groups (id) on delete cascade,
	stripe_checkout_session_id text not null unique,
	seats integer not null,
	amount_paid integer,
	currency text,
	paid_at timestamptz not null default now()
);

alter table public.ecg_course_students
	add column if not exists group_id uuid references public.ecg_course_groups (id) on delete set null,
	add column if not exists group_joined_at timestamptz,
	add column if not exists is_instructor boolean not null default false;
create index if not exists ecg_course_students_group_idx on public.ecg_course_students (group_id);

-- Only the site's server functions (service-role key) can read or write these.
alter table public.ecg_course_groups enable row level security;
alter table public.ecg_course_group_purchases enable row level security;

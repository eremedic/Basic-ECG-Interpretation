-- Student records for the Basic ECG Interpretation course website.
--
-- One row per student (by email): their name, Stripe payment, and the
-- completion certificate once issued. Rows are written only by the site's
-- server functions using the service-role key; RLS is on with no policies,
-- so nothing is readable or writable with the public (anon) key.
--
-- View the records in Supabase → Table Editor → ecg_course_students.
--
-- Run this in the Supabase SQL Editor of the project the site's functions use
-- (SUPABASE_URL). Safe to re-run.

create table if not exists public.ecg_course_students (
	id uuid primary key default gen_random_uuid(),
	-- Stored lower-case; one record per email address.
	email text not null unique check (email = lower(email) and email like '%_@_%'),
	name text not null default '' check (char_length(name) <= 120),

	-- Payment (Stripe Checkout)
	paid_at timestamptz,
	amount_paid int,                 -- in the smallest currency unit (cents)
	currency text,
	stripe_customer_id text,
	stripe_checkout_session_id text unique,

	-- Certificate of completion
	certificate_id uuid unique,      -- the verification code printed on the certificate
	certificate_name text check (char_length(certificate_name) <= 80),
	certificate_score int check (certificate_score between 0 and 100),
	certificate_issued_at timestamptz,

	-- Last time the student signed in on a device
	last_sign_in_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create index if not exists ecg_course_students_paid_idx on public.ecg_course_students (paid_at desc);
create index if not exists ecg_course_students_cert_idx on public.ecg_course_students (certificate_issued_at desc);

create or replace function public.ecg_course_students_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
	new.updated_at := now();
	return new;
end;
$$;

drop trigger if exists ecg_course_students_touch on public.ecg_course_students;
create trigger ecg_course_students_touch
	before update on public.ecg_course_students
	for each row
	execute function public.ecg_course_students_touch();

alter table public.ecg_course_students enable row level security;
-- No policies on purpose: only the server functions (service role) use this table.
revoke all on public.ecg_course_students from anon, authenticated;

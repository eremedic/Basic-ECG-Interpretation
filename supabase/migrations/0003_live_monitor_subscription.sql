-- Live Monitor subscription (monthly, billed by Stripe).
--
-- The Live Monitor is sold separately from the course, so a row can belong to
-- a course student, a Live Monitor subscriber, or both. Subscribers who never
-- bought the course have no paid_at.
--
-- These columns mirror the student's Stripe subscription; the site's webhook
-- keeps them current as it renews, fails a payment or is canceled.
--
-- Run in the Supabase SQL Editor (after 0001 and 0002). Safe to re-run.

alter table public.ecg_course_students
	add column if not exists monitor_status text,                    -- Stripe status: active, trialing, past_due, canceled, unpaid, incomplete…
	add column if not exists monitor_subscription_id text unique,     -- sub_…
	add column if not exists monitor_current_period_end timestamptz,  -- paid through
	add column if not exists monitor_cancel_at_period_end boolean not null default false,
	add column if not exists monitor_started_at timestamptz;

create index if not exists ecg_course_students_customer_idx on public.ecg_course_students (stripe_customer_id);
create index if not exists ecg_course_students_monitor_idx on public.ecg_course_students (monitor_status, monitor_current_period_end);

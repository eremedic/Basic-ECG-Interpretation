-- One-year access for the Basic ECG Interpretation course.
--
-- Adds access_expires_at: when a student's access ends. Each payment gives
-- one year; renewing early adds a year to the current end date.
-- Existing students get one year from their payment date.
--
-- Run in the Supabase SQL Editor (after 0001). Safe to re-run.

alter table public.ecg_course_students
	add column if not exists access_expires_at timestamptz;

update public.ecg_course_students
	set access_expires_at = paid_at + interval '1 year'
	where paid_at is not null and access_expires_at is null;

create index if not exists ecg_course_students_expires_idx
	on public.ecg_course_students (access_expires_at);

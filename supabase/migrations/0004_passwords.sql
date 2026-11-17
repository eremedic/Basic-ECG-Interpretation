-- Passwords, so students can sign in on any device with email + password.
--
-- Only a salted scrypt hash is stored (never the password). The sign-in
-- email link still works, and doubles as the "forgot password" reset link.
-- After 10 wrong passwords in a row, password sign-in for that account pauses
-- for 15 minutes (the emailed link still works).
--
-- Run in the Supabase SQL Editor (after 0001-0003). Safe to re-run.

alter table public.ecg_course_students
	add column if not exists password_hash text,
	add column if not exists password_set_at timestamptz,
	add column if not exists password_failed_count integer not null default 0,
	add column if not exists password_locked_until timestamptz;

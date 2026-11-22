# Basic ECG Interpretation — CSHealthED

A self-paced, narrated 3-lead ECG course for paramedic students, sold as a
stand-alone website: **Unit 1 is free; the full course is $49 for one year of access** via
Stripe Checkout. Student name, email, payment and the course certificate are
recorded in Supabase.

## How it works

| Piece | What it does |
| --- | --- |
| `site/` | The static course site (landing page, enrollment, the course, certificate, certificate verification). |
| `src/course.js` | The full course content. **Not published as-is.** |
| `scripts/build.mjs` | Builds `site/js/course-preview.js` (Unit 1 only; other units show titles) and `netlify/data/course-full.json` (everything, bundled into the server function). |
| `site/js/monitor.js`, `scripts/build-monitor-strips.mjs` | The **Live Monitor** (`/#monitor`), a separate **$14.99/month Stripe subscription**: the cardiac monitor from the Cardiac Lab defib trainer, playing 300 strips (50 each: sinus, atrial, junctional, ventricular, AV blocks, paced) for students to name. The first 5 strips in each category are free. The build writes the free strips to `site/js/monitor-strips.js` and the full bank to `netlify/data/monitor-full.json`, which the `monitor-bank` function serves only to active subscribers. |
| `src/lab/`, `scripts/build-lab.mjs`, `site/js/cardiac-lab.js` | **Practice strips and the Code lab**, from the Cardiac Lab project, also part of the Live Monitor subscription. Practice areas (sinus, atrial, junctional, ventricular, AV blocks, paced: 50 each), 100 field strips with real-world artifact and 102 random strips, each with a full interpretation, color-coded corrections on wrong answers, calipers, a zoom viewer and cardiologist hints. The Code lab runs ACLS cases on a live monitor/defibrillator (Beginner, Intermediate or “I Got This”, with a bottom bar for CPR, airway, access and drugs checked for clinical timing). The build writes the free preview (the first 5 strips of each area and 2 Code lab cases) to `site/js/cl-free.js` and everything to `netlify/data/lab-full.json`, which `/api/lab-bank?part=<area\|codelab>` serves only to active subscribers. Cardiac Lab's styles are scoped under `.cl` in `site/css/cardiac-lab.css` so they don't touch the rest of the site. No 12-lead practice area. Pages: `/#practice-<area>`, `/#codelab`, with tiles on the Lab home. |
| `netlify/functions/` | Server API at `/api/*`: `create-checkout`, `stripe-webhook`, `lab-bank`, `claim`, `login`, `set-password`, `request-link`, `create-group-checkout`, `join-group`, `my-groups`, `course-content`, `certificate`, `verify-certificate`. |
| `supabase/migrations/0001_ecg_course_students.sql` | The `ecg_course_students` table. |

Student flow:

1. **Enroll**: the student enters a name and email → Stripe Checkout ($49).
2. Stripe sends them back to `/#welcome`. The site confirms the payment with Stripe and records the student, and the browser gets an access token. The full course then unlocks on that device.
3. The Stripe webhook also records every payment, so it's recorded even if the student closes the tab.
4. **Password:** right after purchase the student is offered to create a password. On any device they sign in with email + password (`/api/login`). Only a salted scrypt hash is stored; 10 wrong passwords in a row pause password sign-in for 15 minutes.
5. **Forgot password / no password yet:** *Email me a link* sends a sign-in link (valid 24 hours, sent through Resend). It signs them in and lets them set a new password (`/api/set-password`). Changing a password while signed in needs the current one.
6. **Group seats (instructors):** at `/#group-buy` an instructor buys seats for a class ($39 each by default, minimum 5). They get a join link and a dashboard at `/#group` showing who has joined, access dates and certificates (with a CSV download), and can add seats later. Students open the join link, confirm their email, and get one year of course access from the day they join; each uses one seat. A student who already has the course joins without using a seat. Seats can be used for 12 months after the latest purchase.
7. **Certificate:** after passing the final exam (80%+), the student issues their certificate. It's stored with a unique ID that anyone can check at `/#verify?id=…`.

Lesson progress is saved in each browser. Enrollment and certificates are stored on the server.

## Setup

### 1. Supabase

Open the SQL Editor in your Supabase project and run `supabase/migrations/0001_ecg_course_students.sql`.

Student records then appear in **Table Editor → ecg_course_students**, with these columns:

- `name`
- `email`
- `paid_at`
- `amount_paid`
- `certificate_id`
- `certificate_name`
- `certificate_score`
- `certificate_issued_at`

Row-level security is on, with no policies. Only the site's server functions (using the service-role key) can read or write this table.

Then run `supabase/migrations/0002_one_year_access.sql`, which adds `access_expires_at`. Each payment gives **one year of access**. Students can renew in the last 30 days or after their access ends; renewing early adds a year to the current end date. Certificates stay verifiable after access ends.

Then run `supabase/migrations/0003_live_monitor_subscription.sql`, which adds the Live Monitor subscription columns (`monitor_status`, `monitor_subscription_id`, `monitor_current_period_end`, `monitor_cancel_at_period_end`, `monitor_started_at`). A row can be a course student, a Live Monitor subscriber, or both.

Then run `supabase/migrations/0004_passwords.sql`, which adds the password columns (`password_hash`, `password_set_at`, `password_failed_count`, `password_locked_until`).

Then run `supabase/migrations/0005_group_seats.sql`, which adds the `ecg_course_groups` and `ecg_course_group_purchases` tables and the `group_id`, `group_joined_at` and `is_instructor` columns.

### 2. Netlify

Create a new site from this repository. The build settings come from `netlify.toml`. Then add these environment variables under **Site configuration → Environment variables**:

| Variable | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys → Secret key (`sk_live_…`, or `sk_test_…` while testing) |
| `STRIPE_WEBHOOK_SECRET` | From step 3 (`whsec_…`) |
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` key (server only, never in the browser) |
| `ACCESS_TOKEN_SECRET` | A long random string, e.g. the output of `openssl rand -hex 32`. Changing it signs everyone out (they can sign in again by email). |
| `RESEND_API_KEY` | Resend → API Keys (used for sign-in and password-reset link emails) |
| `SITE_URL` | Your public address, e.g. `https://ecg.cshealthed.com` (no trailing slash) |
| `EMAIL_FROM` *(optional)* | Defaults to `CSHealthED <no-reply@cshealthed.com>` |
| `STRIPE_PRICE_ID` *(optional)* | A Stripe Price to charge. Without it, checkout charges $49.00 USD. |
| `COURSE_PRICE_CENTS` *(optional)* | Changes the built-in price, e.g. `4900`. |
| `STRIPE_MONITOR_PRICE_ID` *(optional)* | A recurring monthly Stripe Price for the Live Monitor. Without it, checkout charges $14.99 USD per month. |
| `MONITOR_PRICE_CENTS` *(optional)* | Changes the built-in Live Monitor price, e.g. `1499`. (The price shown on the site is `MON_PRICE` in `site/js/app.js`.) |
| `GROUP_SEAT_CENTS` *(optional)* | Price per group seat, e.g. `3900`. (The price shown on the site is `SEAT_PRICE` in `site/js/app.js`.) |
| `GROUP_MIN_SEATS` *(optional)* | Minimum seats in a new group purchase. Defaults to `5`. (Shown on the site as `SEAT_MIN`.) |
| `STRIPE_REQUIRE_TERMS` *(optional)* | `true` adds a required “I agree to the Terms and Refund Policy” checkbox on the payment page. First set a Terms of Service URL (`https://YOUR-SITE/#terms`) in Stripe → Settings → Business → Public details, or checkout will fail. |

Redeploy after you add the variables.

### 3. Stripe webhook

In Stripe, go to **Developers → Webhooks → Add endpoint** and set it up:

- **URL:** `https://YOUR-SITE/api/stripe-webhook`
- **Events:** `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated` and `customer.subscription.deleted` (the last three keep Live Monitor subscriptions current through renewals, failed payments and cancellations)

Copy the endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`, then redeploy.

### Live Monitor: customer portal

Subscribers cancel or update their card with **Manage subscription** on the Live Monitor page, which opens Stripe's customer portal. Turn it on once in each mode (sandbox and live): Stripe → **Settings → Billing → Customer portal**, allow customers to cancel subscriptions and update payment methods, then **Save**.

### 4. Brand the payment page

Stripe → Settings → Business → **Branding**: upload the logo/icon, brand color `#1b2a5b`, accent `#e0262b`.
Settings → Business → **Public details**: business name, support email, statement descriptor.
Settings → **Customer emails**: turn on successful-payment receipts. (Sandboxes have their own settings.)
The site already sends the course image (`site/assets/stripe-course.png`) and the text shown above the Pay button.

### 5. Test it

1. With test keys, enroll using card `4242 4242 4242 4242`.
2. You should land on "You're enrolled!" with every unit unlocked.
3. A row should appear in `ecg_course_students`.
4. Switch to live keys when you're ready.

## Development

```bash
npm install
npm run build   # builds the preview + full course files
npm test        # server function tests
```

To edit the course, change `src/course.js` and rebuild. To preview the site, serve `site/` with any static server. Use `netlify dev` if you also want the `/api` functions.

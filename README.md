# Basic ECG Interpretation — CSHealthED

A self-paced, narrated 3-lead ECG course for paramedic students, sold as a
stand-alone website: **Unit 1 is free, the full course is $49 one-time** via
Stripe Checkout. Student name, email, payment and the course certificate are
recorded in Supabase.

## How it works

| Piece | What it does |
| --- | --- |
| `site/` | The static course site (landing page, enrollment, the course, certificate, certificate verification). |
| `src/course.js` | The full course content. **Not published as-is.** |
| `scripts/build.mjs` | Builds `site/js/course-preview.js` (Unit 1 only; other units show titles) and `netlify/data/course-full.json` (everything, bundled into the server function). |
| `netlify/functions/` | Server API at `/api/*`: `create-checkout`, `stripe-webhook`, `claim`, `request-link`, `course-content`, `certificate`, `verify-certificate`. |
| `supabase/migrations/0001_ecg_course_students.sql` | The `ecg_course_students` table. |

Student flow:

1. **Enroll**: the student enters a name and email → Stripe Checkout ($49).
2. Stripe sends them back to `/#welcome`. The site confirms the payment with Stripe and records the student, and the browser gets an access token. The full course then unlocks on that device.
3. The Stripe webhook also records every payment, so it's recorded even if the student closes the tab.
4. **Other devices:** *Sign in* emails a one-time sign-in link, valid for 24 hours, sent through Resend.
5. **Certificate:** after passing the final exam (80%+), the student issues their certificate. It's stored with a unique ID that anyone can check at `/#verify?id=…`.

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

### 2. Netlify

Create a new site from this repository. The build settings come from `netlify.toml`. Then add these environment variables under **Site configuration → Environment variables**:

| Variable | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys → Secret key (`sk_live_…`, or `sk_test_…` while testing) |
| `STRIPE_WEBHOOK_SECRET` | From step 3 (`whsec_…`) |
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` key (server only, never in the browser) |
| `ACCESS_TOKEN_SECRET` | A long random string, e.g. the output of `openssl rand -hex 32`. Changing it signs everyone out (they can sign in again by email). |
| `RESEND_API_KEY` | Resend → API Keys (used for sign-in link emails) |
| `SITE_URL` | Your public address, e.g. `https://ecg.cshealthed.com` (no trailing slash) |
| `EMAIL_FROM` *(optional)* | Defaults to `CSHealthED <no-reply@cshealthed.com>` |
| `STRIPE_PRICE_ID` *(optional)* | A Stripe Price to charge. Without it, checkout charges $49.00 USD. |
| `COURSE_PRICE_CENTS` *(optional)* | Changes the built-in price, e.g. `4900`. |

Redeploy after you add the variables.

### 3. Stripe webhook

In Stripe, go to **Developers → Webhooks → Add endpoint** and set it up:

- **URL:** `https://YOUR-SITE/api/stripe-webhook`
- **Events:** `checkout.session.completed` and `checkout.session.async_payment_succeeded`

Copy the endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`, then redeploy.

### 4. Test it

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

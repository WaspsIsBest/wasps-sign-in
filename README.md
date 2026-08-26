# WASPS Weekly Sign-In Pilot

Mobile-first Next.js front end for the Supabase-backed WASPS sign-in pilot.

## Prerequisites

Run the Supabase SQL scripts through:

- `007_import_test_event_2026_08_20.sql`
- `008_scan_member_function.sql`
- `009_undo_sign_in_function.sql`

Create staff users in Supabase Authentication and matching rows in `public.user_profiles`.

## Environment

Copy `.env.example` to `.env.local` and set:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_PILOT_EVENT_DATE=2026-08-20
```

Use the publishable key, not the service-role key.

## Local run

```bash
npm install
npm run dev
```

Open `http://localhost:3000/login`.

## Vercel deployment

1. Create a GitHub repository and upload this folder.
2. Import the repository into Vercel.
3. Add the three environment variables above.
4. Deploy.
5. In Supabase Authentication URL Configuration, add the Vercel production URL under Site URL or Redirect URLs.
6. Login using the existing Supabase admin or sign-in test account.

## Pilot scanner use

The scan box remains focused. A keyboard-wedge USB or Bluetooth scanner should type the WASRA value and send Enter. Manual WASRA entry also works.

## Pilot pages

- `/login`
- `/sign-in`
- `/attendance`

The app uses `scan_member` for each live scan and `undo_sign_in` for corrections. `scan_member_batch` is intentionally not used for ordinary live scanning.

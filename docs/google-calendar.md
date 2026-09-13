# Unified calendar

Google events, imported academic PDF schedules and manually assigned dashboard
events share the monthly view, agenda and upcoming schedule widget. Their source
is indicated by green, purple and blue respectively. Google events open Google
Calendar for management; manual and PDF events remain in the dashboard database.

## Configuration

Set `GOOGLE_CALENDAR_ICAL_URL` as a **secret** in the existing Sites environment.
Use the owner's private iCal address from Google Calendar settings. Keep the
calendar private. Never paste the feed address into source code, browser code,
GitHub, logs or public environment variables. Redeploy after changing the secret.

For local development, place the same key in an ignored `.dev.vars` file and
start Vite on `127.0.0.1`. `.env.example` records the variable name without a value.
Production requires the owner identity supplied by Sites. The API rejects other
identities even if the Site's audience is subsequently expanded.

## Refresh and display

The browser checks every five minutes while visible, on focus and when the user
clicks refresh. Google may take additional time to update its iCal export. The
server caches a feed for up to two minutes, bypasses that cache for an explicit
refresh and shows the previous feed with a status message if an update fails.
Responses use `Cache-Control: private, no-store`; no raw feed or secret is returned.

The calendar displays times in Asia/Seoul. All-day end dates are exclusive.
Recurring events, exclusions, moved instances, cancelled instances and events
spanning multiple days are expanded for the visible month and the next 90 days.
Only the configured Google calendar's feed is included. Other calendars require
their own authorized feed and are not inferred from account access.

## Verification

Run `node --experimental-strip-types --test tests/google-calendar.test.mjs` with
Node 22.13 or later. Tests cover day boundaries, exclusions, edits, cancellations,
IANA timezones, added recurrence dates and duplicate prevention. The integration
endpoint is `/api/google-calendar?month=YYYY-MM`.

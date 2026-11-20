# Customer WhatsApp notifications (Interakt)

The backend sends 14 kinds of WhatsApp update to customers through Eventory's Interakt account. Each update is sent as an approved template.

It ships **off**. With `WHATSAPP_NOTIFICATIONS_ENABLED=false`, which is the default, nothing is sent and nothing is written, and every existing flow behaves exactly as before.

- Template copy and variable order to submit in Interakt: [TEMPLATES.md](TEMPLATES.md)
- Every setting: [.env.example](../../.env.example), in the WhatsApp section

## What existed before

- **V2 backend (this repo):** no Interakt or WhatsApp sending at all. Customers already had a `preferences.notification.whatsapp` toggle (default `false`) with no consent record behind it. Vendors already get in-app inbox rows plus FCM push (`vendorNotificationService` / `pushService`), and a 5-minute in-process `notificationScheduler` runs vendor reminders. Customers had no notifications.
- **Legacy `Eventory-backend` repo:** Interakt is used only inbound. `POST /webhook/interakt-slack` receives leads from an Interakt flow and creates Slack tickets. It has no signature check. Its outbound WhatsApp sends go **directly to the Meta Graph API** (`WA_ACCESS_TOKEN`), not through Interakt. That repo isn't touched.

So this is a new module, built on the V2 conventions: fire-and-forget hooks next to the existing `notifyVendor()` calls, unique-key dedupe, and the existing scheduler.

## How it works

```
business event (controller/service, after save)
  └─ customerWhatsApp.<event>(doc)                 services/customerWhatsAppEvents.js
       builds template vars + dedupeKey, never throws, not awaited
       └─ notify(type, …)                         services/customerWhatsAppService.js
            1. flag on? API key? template configured for this type?
            2. customer opted in (whatsappConsent), verified phone == consented phone, valid E.164?
               → no: log "skipped", write nothing
            3. insert WhatsAppNotification row (unique dedupeKey) → duplicate: stop
            4. interaktClient.sendTemplate()       services/interaktClient.js
               retryable (429/502-504/conn refused): backoff, then "retry_scheduled"
               ambiguous (timeout/500): "unknown", never resent (could double-send)
               permanent (4xx, bad template/number): "failed"
            5. row → "submitted" + interaktMessageId

notificationScheduler (existing, every 5 min)
  ├─ whatsappPaymentReminders / whatsappEventReminders   services/customerWhatsAppScheduler.js
  └─ whatsappRetries   (atomically claims due retry rows; re-checks consent first)

Interakt → POST /api/webhooks/interakt               controllers/interaktWebhookController.js
  verify Interakt-Signature (HMAC-SHA256 of raw body) → match row by message id
  (or callbackData = row id) → status only moves forward: sent → delivered → read / failed
```

A WhatsApp failure can never fail a booking, payment, signup or profile update. Every hook is fire-and-forget and swallows its own errors.

## The 14 notifications

| # | Type | Fires when | Hook | Sent once per |
|---|---|---|---|---|
| 1 | `welcome` | Account created (email, Google/Facebook, phone OTP) **or** first WhatsApp opt-in | `customerAuthController.signup`, `customerSocialAuthController`, `customerPhoneController.verifyPhoneOtp`, consent route, profile toggle | customer |
| 2 | `vendorResponse` | Vendor sends a proposal on an enquiry | `enquiryController.sendProposal` | enquiry + proposal time |
| 3 | `bookingRequest` | A customer checkout creates a booking | `bookingCreationService.createBookingsFromCheckoutSession` | booking |
| 4 | `bookingStatus` | Vendor accepts (or confirms via update), Eventory force-accepts, vendor declines | `bookingController.acceptBooking` / `updateBooking(confirm)` / `declineBooking`, `adminBookingController.forceAccept` | booking + outcome |
| 5 | `bookingModification` | Vendor changes the proposal (decisions, pricing, payment plan) | `bookingController.updateBooking` (when the proposal changed), `updatePaymentMilestones` | booking + proposal version; throttled to 1 per 30 min per booking |
| 6 | `bookingModified` | Customer accepts the revised proposal on a booking that was already confirmed, so both sides have agreed and it's re-confirmed | `customerBookingController.acceptProposal` (re-confirming) | booking + proposal version |
| 7 | `bookingCancelled` | Customer or vendor cancels | `customerBookingController` cancel, `bookingController.cancelBooking` | booking + cancellation time |
| 8 | `paymentSuccess` | Cashfree confirms PAID (re-verified with `PGFetchOrder`) | `customerPaymentController` webhook + status-poll recheck | payment |
| 9 | `paymentFailed` | Cashfree reports EXPIRED / TERMINATED / `PAYMENT_FAILED_WEBHOOK` | same two places | payment |
| 10 | `paymentReminder` | Unpaid instalment due within 48 h (configurable) | scheduler | milestone + due date |
| 11 | `refundInitiated` | Team marks the refund `started` | `adminBookingController.updateRefundStatus` | booking cancellation |
| 12 | `refundCompleted` | Team marks the refund `completed` | `adminBookingController.updateRefundStatus` | booking cancellation |
| 13 | `eventReminder` | The IST day before the event | scheduler | booking + event day |
| 14 | `eventDay` | The event day (IST), before the event ends | scheduler | booking + event day |

**Eligibility rules:**
- **Payments:** a payment is never reported failed on a timeout or an uncertain status. Only Cashfree's own terminal status counts. A success is only reported after the `PGFetchOrder` re-check the code already does.
- **Payment reminders:** only for bookings that are not Cancelled, Declined or Completed, have been confirmed by the vendor, have no refund under way and aren't fully paid. A milestone is also skipped if a PAID payment already exists for it. Overdue milestones are not reminded; the vendor-side overdue reminder already covers those.
- **Event reminders:** only for bookings that hold their date: `Confirmed`, or reopened for changes after confirming. Cancelled, declined, completed and never-confirmed bookings are skipped. A reminder for a moved date gets a new key, so the new date is reminded too.
- **Send window:** reminders go out only between 09:00 and 21:00 IST (`WHATSAPP_SCHEDULE_WINDOW_IST`). Messages that are still being retried expire: a day-before reminder is dropped once the event day starts, and an event-day reminder once the event ends.

## Consent

- `Customer.whatsappConsent` = `{ status: "opted_in" | "opted_out", optedInAt, optedOutAt, source, phone }`. This is what sending checks. The existing `preferences.notification.whatsapp` toggle is kept in sync for the apps that already read it.
- **Having a phone number is not consent.** Existing customers all start without consent, and nothing is backfilled.
- Consent is tied to the number it was given for. If the customer changes their phone, they need to opt in again.
- How consent is recorded:
  - `PUT /api/customer/whatsapp-consent` with `{ optIn: true|false, source? }`, where `source` is one of `signup`, `checkout`, `booking`, `profile`, `settings` or `support`. `GET` returns the current state.
  - The existing profile `PATCH /api/customers/:id` with `preferences.notification.whatsapp` set to true or false is recorded with source `profile`. A PATCH that doesn't send that toggle changes nothing.
- Sending also requires a **verified** phone (OTP) in valid E.164 form. `+91` numbers must be 10-digit mobiles starting 6–9, and other country codes are accepted only if they're listed in `WHATSAPP_ALLOWED_COUNTRY_CODES`.

**Frontend work needed (not in this change):** show an explicit, unticked WhatsApp opt-in checkbox or toggle (for example at checkout or in profile settings) and call the consent route when the customer changes it. Until then, no customer is eligible and nothing is sent.

## Database changes

No migration script is needed. Mongoose creates the collection and indexes on first use.

- **New collection `customer_whatsapp_notifications`** (`models/WhatsAppNotification.js`):
  - fields: customer ids, type, refs (`bookingId` / `enquiryId` / `paymentId` / `milestoneId`), recipient, template name and language, status, Interakt message id, failure reason and code, attempts, `nextAttemptAt`, `expiresAt`, and the `submittedAt` / `sentAt` / `deliveredAt` / `readAt` / `failedAt` timestamps
  - `createdAt` / `updatedAt` come from Mongoose timestamps
  - indexes: **unique** on `dedupeKey`, **unique partial** on `interaktMessageId`, plus `(status, nextAttemptAt)` and `(bookingId, type, createdAt)`
  - template values are not stored. They're held only while a retry is pending and are removed once the message settles.
- **`customer_accounts`** gets the `whatsappConsent` sub-object. It's additive, and existing documents read as "no consent".

If `autoIndex` is disabled in production, create the indexes once with `WhatsAppNotification.syncIndexes()`, or make sure the unique `dedupeKey` index exists before you enable the flag. Duplicate-prevention depends on it.

## Credentials to get from the tech lead / Interakt admin

| What | Where | Env var |
|---|---|---|
| Interakt API key | Interakt → Settings → Developer Settings. Public APIs need the **Growth** plan or higher. | `INTERAKT_API_KEY` |
| A webhook secret you choose | You enter it in Interakt's webhook settings. Generate it with `openssl rand -hex 32`. | `INTERAKT_WEBHOOK_SECRET` |
| Approved template code names (14) | Interakt → Templates, after Meta approves them | `WHATSAPP_TEMPLATE_*` |

Also confirm with the admin:
- the plan's API rate limit (300/min on Growth, 600/min on Advanced)
- which WhatsApp number the account sends from
- that webhooks are available on the plan (Growth or Advanced)

## Webhook setup

1. Deploy with `INTERAKT_WEBHOOK_SECRET` set.
2. In Interakt → Developer Settings → Webhooks:
   - URL: `https://<backend host>/api/webhooks/interakt`
   - Secret: the same value as `INTERAKT_WEBHOOK_SECRET`
   - Events: message-status events for templates sent through the API (`message_api_sent`, `message_api_delivered`, `message_api_read`, `message_api_failed`)
3. Send one test message (see "Going live") and check that its row moves `submitted → sent → delivered`.

Interakt **doesn't retry** webhooks, expects a 200 within 3 s, and **disables the webhook after 5 failures in 10 minutes**, so you'd need to re-enable it by hand. The endpoint returns 200 for anything authentic, including event types it ignores. It returns 401 only for a bad signature and 503 when the secret isn't configured.

Because Interakt doesn't retry, a missed webhook just leaves a row at `submitted`. The message itself was still sent.

## Testing

```bash
npm run test:whatsapp      # node --test, no DB, no network, mocked Interakt
```

The tests cover:
- each of the 14 triggers: template choice, variable order, dedupe keys, and payment/refund status validation
- opt-in and opt-out, re-consent after a phone change, and the profile-toggle sync
- invalid phone numbers and missing credentials
- the feature flag and dry run
- Interakt errors (429, 5xx, 4xx, auth, timeout) and the retry rules
- duplicate prevention, including concurrent triggers
- webhook signature checks, duplicate and out-of-order events
- scheduler eligibility: IST day boundaries, send window, cancelled, declined and completed exclusion, paid and refunded bookings

No test calls Interakt.

Not automated: the controller hooks themselves, which are one-line calls into the tested event functions, and anything that needs a live MongoDB.

## Going live

1. Create and submit the 14 templates ([TEMPLATES.md](TEMPLATES.md)) and wait for approval.
2. On **staging**, set:
   - `INTERAKT_API_KEY`
   - `INTERAKT_WEBHOOK_SECRET`
   - all the `WHATSAPP_TEMPLATE_*` names
   - `WHATSAPP_RECIPIENT_ALLOWLIST=+91<your number>`
   - `WHATSAPP_NOTIFICATIONS_ENABLED=true`

   You can set `WHATSAPP_DRY_RUN=true` first to see rows without sending anything.
3. Opt your own test account in, with a verified phone, through `PUT /api/customer/whatsapp-consent`. Then walk through booking, payment, cancellation and refund, and check the messages and the `customer_whatsapp_notifications` rows.
4. Configure the Interakt webhook and confirm the statuses update.
5. In production:
   - make sure the indexes exist (see "Database changes")
   - set the same variables, without the allowlist and dry run
   - flip the flag
   - add the new variables to the `V2_PROD_ENV` GitHub secret (`npm run sync-env:prod`) so the deploy workflow writes them
6. To turn it off, set `WHATSAPP_NOTIFICATIONS_ENABLED=false` and restart. Nothing else changes.

`NOTIFICATION_SCHEDULER=off` also stops the WhatsApp reminders and retries, because they run in the same loop.

## Logs

Log lines are JSON with `"scope":"whatsapp"`. The events are:
- `submitted`, `skipped` (with a `reason`), `duplicate`
- `retrying`, `retry_scheduled`, `failed`, `unknown`, `dry_run`
- `config_problem`
- `webhook_*`

The logs never contain phone numbers (only masked ones, in dry run), names, template values or keys.

## Known limits / still to do

- **No outbound Interakt access was available during development.** The request and response format follows Interakt's public docs, and the code was tested only against mocks. Do the staging run before production.
- **Interakt error bodies** aren't fully documented. Errors are classified by HTTP status. If staging shows a 4xx that ought to be retried (or the other way round), adjust `classifyError` in `interaktClient.js`.
- **Message ids:** the webhook matches on `data.message.id`, assumed to be the `id` the send API returns. As a fallback it also matches on `callbackData`, which carries our row id, so status tracking works either way.
- **Replying STOP on WhatsApp** isn't handled. Opt-out happens through the app or the API. Handling STOP would need Interakt's inbound `message_received` content format, which isn't documented well enough to rely on.
- **Refunds are manual** in this codebase, with no gateway refund API. "Refund completed" means the team confirmed the refund in the admin tool (`PUT /api/admin/bookings/:id/refund`), not a gateway callback. Separately, the admin booking routes have no auth middleware today, which was already the case before this change and is worth fixing.
- **Rate limiting is per instance.** With more than one API instance, keep `WHATSAPP_RATE_LIMIT_PER_MINUTE × instances` under the plan limit.
- **Event times are IST.** Bookings don't store a timezone and Eventory is India-only. If events outside IST are ever supported, `istDayRange` / `eventEndOf` are the places to change.
- **Bookings created by vendors** (walk-ins, enquiry conversions) don't trigger "booking request submitted", because the customer didn't submit them. Their later status, cancellation and reminder messages still go out when the booking is linked to an opted-in account.

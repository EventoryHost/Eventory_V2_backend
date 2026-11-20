# Customer WhatsApp templates — submit in Interakt

Create these 14 templates in **Interakt → Templates → Create template**, submit them to Meta for approval, and once each is **Approved** put its **code name** into `.env`.

The code name is the part of the template's dashboard URL between `template/` and `/view`. The display name won't work.

## Rules that apply to every template

- **Category:** `Utility`. Each one is a transactional update about something the customer did or booked. None of them contain offers, discounts or calls to buy. If Meta re-categorises one as Marketing (it happens most often to welcome messages), see the note under template 1.
- **Language:** English (`en`), unless you change `WHATSAPP_TEMPLATE_LANGUAGE`. Every template must be approved in that language.
- **Header / footer / buttons:** none. The backend sends body variables only. If you add a header or a button that has a variable, the send will fail until the code is changed to supply it. Static footers (for example "Eventory") are fine.
- **Variables:** use exactly the number listed, in exactly the order listed. The backend fills `{{1}}`, `{{2}}`, … in this order (the source of truth is [src/constants/customerWhatsAppTypes.js](../../src/constants/customerWhatsAppTypes.js)).
- **Meta rules the copy below already follows:**
  - the body doesn't start or end with a variable
  - no two variables sit next to each other
  - every variable has enough fixed text around it
- **Sample values:** Interakt asks for a sample for each variable when you submit. Use the samples given here.
- Values never contain line breaks. The backend strips newlines, tabs and runs of spaces, which WhatsApp rejects, and replaces an empty value with `-`.

---

### 1. Welcome message
`WHATSAPP_TEMPLATE_WELCOME` · suggested name `eventory_welcome` · **Utility**

> Hi {{1}}, your Eventory account is set up and WhatsApp updates are on. We'll message you here about your enquiries, bookings, payments and event reminders. You can turn these updates off anytime from your Eventory profile.

| Var | Value | Sample |
|---|---|---|
| {{1}} | Customer's first name | Asha |

**When it's sent:** once per customer, when they register, or when they first opt in to WhatsApp, whichever comes first with consent in place. It's usually the opt-in, because the phone number isn't collected at signup.
**Note:** Meta sometimes classifies welcome messages as **Marketing**. If that happens, it can still be approved as Marketing; marketing messages cost more and are subject to Meta's marketing-message limits. Alternatively, drop the env var and the welcome won't be sent.

### 2. New vendor response
`WHATSAPP_TEMPLATE_VENDOR_RESPONSE` · suggested name `eventory_vendor_response` · **Utility**

> Hi {{1}}, {{2}} has responded to your enquiry for your {{3}} on {{4}}. Enquiry ID: {{5}} — open the Eventory app to review their proposal.

| Var | Value | Sample |
|---|---|---|
| {{1}} | Customer's first name | Asha |
| {{2}} | Vendor name (point-of-contact name, never the business name) | Ravi Kumar |
| {{3}} | Event type | Wedding |
| {{4}} | Event date | 14 Dec 2026 |
| {{5}} | Enquiry ID | ENQ20261110101500123 |

### 3. Booking request submitted
`WHATSAPP_TEMPLATE_BOOKING_REQUEST` · suggested name `eventory_booking_request` · **Utility**

> Hi {{1}}, we've received your booking request {{2}} with {{3}} for your {{4}} on {{5}}. The vendor will review it, and we'll update you here as soon as they respond.

| Var | Value | Sample |
|---|---|---|
| {{1}} | Customer's first name | Asha |
| {{2}} | Booking ID | EVT20261110101500123 |
| {{3}} | Vendor name | Ravi Kumar |
| {{4}} | Event type | Wedding |
| {{5}} | Event date | 14 Dec 2026 |

### 4. Booking status update (accepted / declined)
`WHATSAPP_TEMPLATE_BOOKING_STATUS` · suggested name `eventory_booking_status` · **Utility**

> Hi {{1}}, your booking {{2}} with {{3}} for {{4}} has been {{5}} by the vendor.
>
> What's next: {{6}}
>
> Thank you for choosing Eventory.

| Var | Value | Sample |
|---|---|---|
| {{1}} | Customer's first name | Asha |
| {{2}} | Booking ID | EVT20261110101500123 |
| {{3}} | Vendor name | Ravi Kumar |
| {{4}} | Event date | 14 Dec 2026 |
| {{5}} | `accepted` or `declined` | accepted |
| {{6}} | Accepted: "Your date is reserved. You can see the details and payment schedule in the Eventory app." Declined: "You can explore other vendors for your event in the Eventory app." | Your date is reserved. You can see the details and payment schedule in the Eventory app. |

The same template covers both outcomes; {{5}} and {{6}} change. If Meta rejects the long {{6}}, split this into two templates and tell engineering, because the code would then need a second env var.

### 5. Booking modification request
`WHATSAPP_TEMPLATE_BOOKING_MODIFICATION` · suggested name `eventory_booking_modification` · **Utility**

> Hi {{1}}, {{2}} has updated the proposal for your booking {{3}} on {{4}}. Please review the changes in the Eventory app — your action may be required to keep the booking moving.

| Var | Value | Sample |
|---|---|---|
| {{1}} | Customer's first name | Asha |
| {{2}} | Vendor name | Ravi Kumar |
| {{3}} | Booking ID | EVT20261110101500123 |
| {{4}} | Event date | 14 Dec 2026 |

### 6. Booking modification confirmed
`WHATSAPP_TEMPLATE_BOOKING_MODIFIED` · suggested name `eventory_booking_modified` · **Utility**

> Hi {{1}}, the updated details of your booking {{2}} with {{3}} for {{4}} are now agreed and confirmed. You can view the final booking in the Eventory app.

| Var | Value | Sample |
|---|---|---|
| {{1}} | Customer's first name | Asha |
| {{2}} | Booking ID | EVT20261110101500123 |
| {{3}} | Vendor name | Ravi Kumar |
| {{4}} | Event date | 14 Dec 2026 |

### 7. Booking cancelled
`WHATSAPP_TEMPLATE_BOOKING_CANCELLED` · suggested name `eventory_booking_cancelled` · **Utility**

> Hi {{1}}, your booking {{2}} with {{3}} for {{4}} has been cancelled {{5}}. If a refund applies, we'll keep you updated on it here. You can view the details in the Eventory app.

| Var | Value | Sample |
|---|---|---|
| {{1}} | Customer's first name | Asha |
| {{2}} | Booking ID | EVT20261110101500123 |
| {{3}} | Vendor name | Ravi Kumar |
| {{4}} | Event date | 14 Dec 2026 |
| {{5}} | `at your request` or `by the vendor` | at your request |

### 8. Payment successful
`WHATSAPP_TEMPLATE_PAYMENT_SUCCESS` · suggested name `eventory_payment_success` · **Utility**

> Hi {{1}}, we've received your payment of {{2}} for {{3}}. Transaction reference: {{4}}. Thank you for booking with Eventory.

| Var | Value | Sample |
|---|---|---|
| {{1}} | Customer's first name | Asha |
| {{2}} | Amount | ₹5,000 |
| {{3}} | `booking <ID>` (or several IDs, comma-separated, for a multi-vendor checkout) | booking EVT20261110101500123 |
| {{4}} | Cashfree order ID | PAY20261110101500123 |

### 9. Payment failed
`WHATSAPP_TEMPLATE_PAYMENT_FAILED` · suggested name `eventory_payment_failed` · **Utility**

> Hi {{1}}, your payment of {{2}} for {{3}} could not be completed. If any amount was deducted, it is usually reversed automatically by your bank — contact Eventory support if it isn't. You can try the payment again from the Eventory app.

| Var | Value | Sample |
|---|---|---|
| {{1}} | Customer's first name | Asha |
| {{2}} | Amount | ₹5,000 |
| {{3}} | `booking <ID>`, or `order <Cashfree order ID>` when no booking exists yet | booking EVT20261110101500123 |

Only sent when Cashfree itself reports the payment failed or the order expired or was terminated. It's never sent for a timeout or an uncertain status.

### 10. Payment reminder
`WHATSAPP_TEMPLATE_PAYMENT_REMINDER` · suggested name `eventory_payment_reminder` · **Utility**

> Hi {{1}}, a payment of {{2}} ({{3}}) for your booking {{4}} is due on {{5}}. You can pay securely from the Eventory app. Please ignore this message if you've already paid.

| Var | Value | Sample |
|---|---|---|
| {{1}} | Customer's first name | Asha |
| {{2}} | Amount due | ₹15,000 |
| {{3}} | Instalment title, as the vendor named it | Advance 2 |
| {{4}} | Booking ID | EVT20261110101500123 |
| {{5}} | Due date | 1 Dec 2026 |

### 11. Refund initiated
`WHATSAPP_TEMPLATE_REFUND_INITIATED` · suggested name `eventory_refund_initiated` · **Utility**

> Hi {{1}}, we've started processing your refund of {{2}} for booking {{3}}. We'll message you again once it has been completed.

| Var | Value | Sample |
|---|---|---|
| {{1}} | Customer's first name | Asha |
| {{2}} | Refund amount | ₹4,000 |
| {{3}} | Booking ID | EVT20261110101500123 |

### 12. Refund completed
`WHATSAPP_TEMPLATE_REFUND_COMPLETED` · suggested name `eventory_refund_completed` · **Utility**

> Hi {{1}}, your refund of {{2}} for booking {{3}} has been processed. Depending on your bank, it may take a few working days to show in your account.

| Var | Value | Sample |
|---|---|---|
| {{1}} | Customer's first name | Asha |
| {{2}} | Refund amount | ₹4,000 |
| {{3}} | Booking ID | EVT20261110101500123 |

### 13. Upcoming event reminder (day before)
`WHATSAPP_TEMPLATE_EVENT_REMINDER` · suggested name `eventory_event_reminder` · **Utility**

> Hi {{1}}, a reminder that your {{2}} is tomorrow, {{3}}. Start time: {{4}}. Your vendor {{5}} is booked for it. Booking ID: {{6}} — you'll find all the details in the Eventory app.

| Var | Value | Sample |
|---|---|---|
| {{1}} | Customer's first name | Asha |
| {{2}} | Event type | Wedding |
| {{3}} | Event date | 14 Dec 2026 |
| {{4}} | Start time, or `as per your booking` | 6:00 PM |
| {{5}} | Vendor name | Ravi Kumar |
| {{6}} | Booking ID | EVT20261110101500123 |

### 14. Event-day reminder
`WHATSAPP_TEMPLATE_EVENT_DAY` · suggested name `eventory_event_day` · **Utility**

> Hi {{1}}, today is the day of your {{2}}! Start time: {{3}}. {{4}} is booked for it. Booking ID: {{5}} — open the Eventory app for your booking details and your vendor's on-ground contact.

| Var | Value | Sample |
|---|---|---|
| {{1}} | Customer's first name | Asha |
| {{2}} | Event type | Wedding |
| {{3}} | Start time, or `as per your booking` | 6:00 PM |
| {{4}} | Vendor name | Ravi Kumar |
| {{5}} | Booking ID | EVT20261110101500123 |

---

## If Meta asks for wording changes

You can change the wording freely, as long as the **number and order of variables stays the same**. To change a variable itself (add, remove or reorder one), update `variables` in [src/constants/customerWhatsAppTypes.js](../../src/constants/customerWhatsAppTypes.js) and the matching values in [src/services/customerWhatsAppEvents.js](../../src/services/customerWhatsAppEvents.js) in the same change.

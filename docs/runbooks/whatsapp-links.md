# Manual WhatsApp contact

On2026-10-25 the owner replaced OpenWA with click-to-chat links for both guest-to-team and staff-to-guest contact. This explicitly supersedes automated WhatsApp delivery, pairing, hosting and callback requirements. Automated email remains required and uses the existing Resend worker, consent, template, sandbox and verification controls.

The owner supplied `01099267451` and `+201220907478`. The Egyptian local number is normalized to `+201099267451`; both contacts are defined in `src/modules/content/whatsapp.ts`. No department or availability claims are inferred.

## Guest contact

Both numbers appear on the contact page, public footer, successful request receipt and private booking status page. The receipt/status draft includes only the booking reference. Links use the documented [WhatsApp click-to-chat format](https://faq.whatsapp.com/5913398998672934): full international digits and an encoded draft, with no leading plus in the URL. They open a new tab without an opener or referrer. The person reviews the draft and presses Send in WhatsApp; the application never records this click as a sent or delivered notification.

## Staff contact

Open **Reservations → reservation → WhatsApp guest → Prepare WhatsApp message**. The server rechecks current staff authority, booking scope and the guest's latest WhatsApp consent. It uses the phone saved on the booking, not a browser-supplied destination. A valid international phone and active consent are required. The localized draft contains a neutral reference-only greeting; no access token, payment-success claim, health detail or participant list is included. Staff review/send in WhatsApp. This does not approve a booking, collect a payment or change delivery status.

## Automated email

Notification jobs now select email only, including for guests who consented to WhatsApp. Historical WhatsApp templates/receipts and authoritative SQL migration checksums remain intact. Existing ambiguous or submitted receipts still require reconciliation before any further send. A phone-only record produces `MANUAL_CONTACT_REQUIRED` suppression rather than an invented delivery or a gateway request. **Notifications & jobs → Deliveries** shows the manual-contact reason, event and authorized reservation link. Reservation details require current booking permission and scope; opening WhatsApp never marks the notification delivered. The website booking form requires email. Actual Resend delivery still requires a designated account, verified sender domain, approved email templates and recipient tests.

Set `WHATSAPP_PROVIDER=links` in Vercel staging/production. This value is already set in the designated production project. No `OPENWA_*`, Meta gateway credentials, QR scan, persistent server, public tunnel or WhatsApp webhook subscription is needed. Retired gateway webhook routes return404. `MESSAGING_ACCOUNT_VERIFIED` remains an email-provider verification gate; it was not enabled by this change.

## Removal and verification

The dedicated RSH local gateway container/network, built image and unpaired session volume were removed; its QR browser was closed. Port2786 has no listener. No unrelated Docker instance was changed. Automatic approval review rejected recursive deletion of the inactive `.local/openwa` folder with "blocked by policy"; these private files remain ignored and excluded from deployment. Do not restart the obsolete private setup helpers. Current Compose deployment code and OpenWA send/configuration/callback code were removed. Previous runbooks/evidence remain historical only. See [current verification](../evidence/whatsapp-links-2026-10-25.json).

Verification covers international-number encoding, invalid-number rejection, staff authorization/consent, email-only dispatch despite legacy templates, phone-only suppression, retired callback routes and browser links. Browser destinations/drafts are inspected without sending a message or claiming either owner number is registered/online. Human approval of ten-locale wording and the other production launch gates remain required.

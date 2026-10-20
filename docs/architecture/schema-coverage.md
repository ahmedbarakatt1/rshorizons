# Schema coverage

The database is built from the core schema and the [extension source](../../supabase/extensions.sql). The extension is concatenated after the core tables into the ordered migration; it must not be applied independently. All extension foreign keys restrict deletion. The final migration phase enables RLS, revokes public function execution and anonymous/authenticated schema access, and grants the application server only the required operations.

| Handoff section | Extension tables and enforcement |
| --- | --- |
| 5.8 Media | `media_assets`, `media_derivatives`, `media_processing_jobs`; originals remain private, upload metadata and checksums are constrained, ready assets require a safety timestamp, public derivatives require explicit staff approval. |
| 5.8 Packages | `photo_packages`, `photo_package_translations`; nonnegative integer minor-unit prices, currency and locale foreign keys, structured entitlement snapshots. |
| 5.8 Galleries | `galleries`, `gallery_assets`, `gallery_entitlements`, `photographer_assignments`, `public_gallery_translations`; private galleries require a booking, entitlements must belong to that booking, assignment access is time-bounded. |
| 5.8 Consent and access | `media_subjects`, `publication_consents`, `download_events`; every recorded subject must have an active marketing consent from that subject or their recorded guardian. Download events are append-only and refer only to grant/session IDs. |
| 5.9 Reviews | `review_invitations`, `reviews`, `review_moderation_events`, `review_replies`; one review per completed booking item, only its primary guest, single-use unexpired invitation, immutable submitted rating/text, append-only moderation history. |
| 5.9 Content | `cms_pages`, `cms_translations`, `social_links`, `contact_requests`; localized slug uniqueness, structured content, approval metadata, official social-host allowlists, bounded contact retention. |
| 5.9 Delivery and operations | `notification_templates`, `notification_deliveries`, `integration_health`, `security_events`, `rate_limit_buckets`; approved provider-language templates, distinct submitted/accepted/delivered/read states, append-only redacted security events, atomic shared rate counters. |

## Core dependencies

Extensions reference `app.staff_profiles(id)`, `guests(id)`, `locales(code)`, `currencies(code)`, `destinations(id)`, `bookings(id)`, `booking_items(id)`, `jobs(id)`, `access_grants(id)` and `guest_sessions(id)`. Review validation reads `bookings.primary_guest_id`, `booking_items.booking_id` and `booking_items.fulfilment_state = 'fulfilled'`. Entitlement validation reads `booking_items.booking_id`. The core provides `app.deny_mutation()`.

The final migration adds the cyclic relationships from `access_grants.gallery_id` to `galleries.id`, `access_grants.review_invitation_id` to `review_invitations.id`, `photography_booking_items.package_id` to `photo_packages.id` and `services.hero_asset_id` to `media_assets.id`.

`app.jobs` remains the authority for lease owners, lease expiry, retries and scheduling. `media_processing_jobs` stores only the linked media-specific projection. Provider webhook ingestion and event deduplication remain in the core pipeline; this extension creates no second webhook inbox.

## Publication and consent

`app.assert_public_gallery()` is a deferred constraint check. A published public gallery must have assets, each asset must be ready and safety-checked, rights evidence and subject review must be recorded, all recorded subjects must have active marketing consent, and each gallery item must choose a separately approved ready public derivative. The derivative must belong to its asset and cannot point to the original object key. Related gallery, asset, derivative, subject and consent writes all revalidate the final transaction state. Consent withdrawal and gallery withdrawal can therefore be committed together.

`media_subjects` makes consent coverage explicit for group photographs. Staff must record every identifiable subject before recording the subject-review approval. Assets without identifiable people can pass after that recorded review and rights approval.

Time expiry cannot trigger a database write. Public delivery must call `app.asset_publication_eligible()` and check gallery expiry on each manifest request. A public object URL also requires an expiry/revocation-capable delivery design: do not copy consent-dependent objects into an irrevocably public bucket or rely on these relational checks to recall already downloaded files. Storage buckets and signed-delivery policies require deployment configuration and separate negative access tests.

## Application and deployment responsibilities

The schema provides relational checks, not proof that an operator supplied complete subjects or lawful evidence. The application must validate structured CMS/package content, sanitize rendered text, approve all enabled-locale translations, authorize moderation and publishing, record moderation events with the state change, derive safe display names, and enforce current gallery payment/package entitlements before issuing a short-lived download URL. Never treat a stored `payment_eligible` flag alone as current ledger truth.

Notification workers must recheck current communication consent and approved template availability immediately before sending. Redacted JSON fields and evidence references must receive only safe metadata; the database cannot detect every secret embedded in a string. Contact, security and rate-limit retention require scheduled cleanup, with a separately privileged retention interface for append-only records. Keys supplied to `consume_rate_limit` must be server-keyed digests, not plain hashes of low-entropy contact details.

Verification evidence is maintained by the combined migration and database test suite. No claim of storage provisioning, production migration, or provider integration follows from these source files.

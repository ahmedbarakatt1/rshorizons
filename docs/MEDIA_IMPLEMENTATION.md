# Media, reviews and messaging implementation

This file records implemented behavior and actual verification. It does not assert production readiness.

## Private media contracts

The API passes an `ActorContext` derived from a validated staff session or scoped guest cookie: `{type:"staff"|"guest"|"system",id?:string,sessionHash?:string}`. Request payload roles, prices, ownership and arbitrary storage paths are never authoritative.

`src/modules/photography/service.ts` exports:

| Function | Contract |
|---|---|
| `createUploadIntent(actor,input)` | `{galleryId,mime,sizeBytes,checksumSha256}` creates quarantined asset and returns bounded PUT endpoint |
| `receiveUpload(assetId,actor,bytes)` | Current photographer/owner permission; exact size, SHA-256, signature and full image decode |
| `finalizeUpload(assetId,actor)` | Revalidates immutable stored bytes; durable processing job; returns processing |
| `processMediaAsset(assetId)` | Worker creates metadata-stripped web/preview/thumb derivatives; ready follows successful processing only |
| `getGalleryManifest(actor,galleryId)` | Current live grant/session and gallery check; safe derivative IDs/URLs and `downloadAllowed` |
| `issueDownloadGrant(actor,input)` | `{galleryId,assetIds,derivative}` checks current paid/delivery entitlement, quota, flags, expiry; returns a short-lived session-bound token |
| `streamAsset(actor,input)` | `{galleryId,derivativeId,downloadToken?}` rechecks authority on every byte request; token supplied in `x-download-token`, never URL |
| `createApprovedPublicDerivative(actor,input)` | Separate sanitized object after rights and subject consent checks; no original bucket changes |
| `publishGallery(actor,input)` | Versioned staff operation; SQL guards check readiness and public eligibility |
| `listPublicGalleries(locale)` | Approved translations and eligible derivatives only; includes public proxy URLs |
| `streamPublicDerivative(derivativeId)` | Rechecks approval, current consent and gallery state; serves only non-original derivative |

All objects, including logically public derivatives, remain in a private storage bucket. Streaming through the application gives revocation effect on the next request. Responses use `no-store`; a downloaded copy already held by a customer cannot be recalled. Production Supabase operations require configured project credentials and private bucket policies. No project/bucket was provisioned or production ACL changed in this session.

The isolated filesystem adapter requires `STORAGE_PROVIDER=local`, development/test, and stores immutable objects below `.local/private/media`. It refuses staging/production and path traversal. JPEG/PNG/WebP images have a 20 MiB limit and a 40-million-pixel decode bound. MP4 admission is bounded to 64 MiB and requires genuine processing before readiness. Managed/local video implementation and verification are tracked by the parent task.

Private guest authorization requires explicit `gallery:read` on both the live guest session and its underlying access grant; `booking:read` alone grants no gallery access. Non-owner photographers need an active time-bounded booking assignment. Download grant scope contains the exact asset and derivative IDs, entitlement ID/version and session. Every manifest and download checks current booking state, net cash ledger receipts after refunds, fulfilled purchased item, immutable purchased package snapshot and allowed count. Stored eligibility flags cannot preserve access after a refund. Entitlement withdrawal/version change, gallery revocation and expired/revoked grants are checked when bytes are fetched.

## Retention

`cleanupExpiredMedia({dryRun=true,limit=25})` considers at most100 explicitly due media assets, never age-guesses a deadline. It excludes active galleries and any unexpired nonrevoked entitlement. Execution requires `RETENTION_POLICY_APPROVED=true`. Upload deadlines use `MEDIA_RETENTION_DAYS` (required in staging/production;90 only in development/test).

The worker locks and rechecks each eligible asset, tombstones it and its derivatives, writes an audit event, then removes only its known keys from the fixed private bucket. The due deadline remains a retry marker until all object deletions succeed. It never deletes booking, financial, publication consent or entitlement records. Objects orphaned by an interrupted write before a database reference exists require a separate reconciliation process; this bounded worker does not sweep arbitrary bucket contents.

Managed video deletion is now implemented: the ingestion saves its provider environment; retention requires a tombstone, matching environment and authenticated asset lookup whose passthrough equals the local asset ID before DELETE. A provider404 is an idempotent completion; ambiguous upload/asset identity remains a retryable reconciliation requirement. Contract tests prove that wrong environment or correlation does not delete. No actual external asset was deleted. The adapter follows the official [Mux asset deletion API](https://www.mux.com/docs/api-reference/video/assets/delete-asset).

Authenticated `GET /api/internal/retention` runs daily at 02:30 UTC using `CRON_SECRET`. It previews until policy approval, processes 25 per call, exposes counts only and returns 503 on any failed deletion. Deletion errors remain eligible for the next bounded run.

## Reviews and contact

`submitReview(actor,input)` accepts an invitation ID, rating, original text/locale and display preference. The invitation must belong to the redeemed review grant and a fulfilled booking item, be unused, unexpired and unrevoked. SQL consumes it atomically. Moderation records a separate event and cannot rewrite rating/text. Public review queries return published reviews only.

`submitContact(input,{rateLimitKeyDigest})` requires affirmative contact/privacy consent and an effective approved privacy policy version, including local demo. It uses a database-backed rate limit and stores a 90-day retention deadline. The contact outbox event contains the request ID only. Marketing remains false. Social links are returned only when active and verified.

## Notifications

`src/integrations/messaging/notifications.ts` exports `deliverNotification(job)`, `verifyMessagingWebhook(provider,rawBody,headers)` and `applyMessagingWebhook(events)`. The job's current database lease and event identity are required. Guest identity/contact is resolved through the event's authoritative booking, private gallery or eligible review invitation. Browser/event-payload contact values are ignored.

Approved event/channel/locale template versions are required. Safe template variables are `{{reference}}` and `{{access_url}}`; no health data, arbitrary payload fields, names or form text are interpolated. Contact notifications are staff-only and contain an opaque request reference plus an authenticated admin URL.

WhatsApp checks current booking opt-in, approved provider template/language, and distinct marketing consent where applicable. Review invitations are not automatically treated as WhatsApp utility messages. Email is the fallback when WhatsApp is not consented, unavailable or definitely rejected. Ambiguous sends are recorded as `unknown` and require reconciliation. API acceptance is `accepted`, never `delivered` or `read`; only authenticated callbacks advance those states. Resend idempotency keys bind event/channel/template/version.

Scoped access links use URL fragments, POST redemption and deterministic domain-separated HMAC tokens so a retry need not store a raw token. Database/event/log records store only hashes. Local synthetic previews may contain the scoped URL in ignored `.local/outbox`; external delivery is not performed by tests. The local adapter refuses real recipients and non-synthetic bookings.

Provider choices: Resend email and Meta WhatsApp Cloud API, pending owner accounts. Required configuration is explicit: existing `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_WEBHOOK_SECRET`, `WHATSAPP_TOKEN`, `META_APP_SECRET`, `WHATSAPP_PHONE_NUMBER_ID`, `META_GRAPH_API_VERSION`, `APP_BASE_URL`, `TOKEN_HASH_PEPPER`; additional `MESSAGING_ACCOUNT_VERIFIED`, `MESSAGING_SANDBOX_ALLOWLIST`, `RESEND_ACCOUNT_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, and staff contact notification recipient/locale. A configured string is not evidence of account ownership, DNS authentication or a real delivery test.

The adapter maps the actual SQL event names, including booking completion/expiry, pickup changes, ledger-based payment receipt IDs and refund-request IDs. `refund_approved` records an internal suppression; it neither contacts the guest nor initiates a refund. Payment and pickup reminders recheck current status, exact due time and current pickup assignment immediately before sending. Authenticated provider callbacks use a dedicated immutable notification receipt table, deduplicate retries and prevent delivered/read states from regressing. A definite WhatsApp failure queues email fallback; an ambiguous provider outcome requires reconciliation.

Documentation checked 2026-10-20: [Supabase private storage](https://supabase.com/docs/guides/storage/buckets/fundamentals), [Resend send API](https://resend.com/docs/api-reference/emails/send-email), [Resend webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys), [Meta Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/). The attempted current Meta webhook documentation page failed retrieval; real provider onboarding must verify the configured API version/templates before enabling delivery.

## Owner media and 3D

The owner authorized supplied `media/` assets for previous-trip imagery on 2026-10-20. `src/integrations/storage/prepare-owner-media.mjs` produces seven optimized local-only WebP selections, each with480/960/1440 responsive widths, and `.local/media/owner-media-manifest.json`, preserving original files and source/output SHA-256 hashes. Captions describe visible scenes only. The manifest separately records owner asset-use permission and missing subject consent evidence. Production publication remains gated. CI generates clearly labeled synthetic image fixtures and never requires the owner's originals.

The generated conceptual underwater camera reference is an illustration, not proof of agency equipment. Its lightweight poster is integrated. The Three.js accent stays disabled while the img2threejs build gates remain incomplete. See `docs/design/three/STATUS.md` for measured evidence and remaining gates.

## Verification ledger

- Actual targeted run: 22 tests in `tests/security/gallery.test.ts`, `tests/integration/media.test.ts`, `tests/integration/reviews.test.ts`, `tests/integration/messaging.test.ts` `tests/integration/retention.test.ts` and `tests/unit/retention-route.test.ts` passed (2026-10-20, 19:56 local).
- The media integration tests use real PostgreSQL runtime authority and prove private gallery IDOR denial, wrong photographer denial, actual image processing, entitlement/revocation enforcement, public consent denial, and fulfilled-item review eligibility/immutability.
- Messaging tests were written and run red before implementation. The durable callback replay test exposed the intentional runtime restriction on financial provider events; a dedicated immutable notification receipt table resolved this. Seven messaging tests now pass, including events emitted by real SQL booking request, approval, settlement, fulfilment, refund approval and completion operations with real leased jobs. This does not claim a live provider delivery.
- Three additional retention route tests passed after the expected missing-route RED run: authentication precedes access, unapproved policy only previews, and partial storage failure returns 503 without leaking asset IDs.
- Scoped ESLint and global TypeScript check both passed at 19:52 local. Generated factory material types use explicit unknown-backed shapes.
- No production provider send, public source-media publication, Supabase provisioning, or external delivery verification was performed.

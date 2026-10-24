# Staff training and access

## Designated administrator

The owner privately designated the initial administrator account on 2026-10-24. It is provisioned in the isolated local showcase with the owner-supplied password. Open `http://127.0.0.1:3002/admin` and use the normal email/password form. The password is not in source, seed data, documentation or deployment files. The local credential table stores a random salt and scrypt hash; sessions are hashed, HttpOnly and expire after eight hours. Current roles/scopes and deactivation still apply on every request.

Use **Catalog & prices → Manage → Variants, rates and payment policies** for experience prices, **Apartments → Manage** for apartment prices, and **Photos & galleries → Manage** for photo/video uploads. Seasonal overrides use a higher priority over their effective date range; previous accepted quote/booking snapshots stay unchanged. Uploads require processing and explicit rights/consents before public publication.

Local credentials are restricted to development/test demonstration mode, loopback application/database hosts, no configured Supabase Auth and no Vercel runtime. They are not copied into a hosted environment. The existing one-use local operator grant remains available for isolated automated verification.

### Provisioning and password rotation

`scripts/provision-admin.ts` accepts `{email,password,name}` JSON through stdin, never command-line password arguments. Use a protected operator shell. This PowerShell example prompts privately; it contains no saved password:

```powershell
$adminSecurePassword = Read-Host 'Administrator password' -AsSecureString
$adminInput = @{ email=(Read-Host 'Administrator email'); name=(Read-Host 'Administrator display name'); password=[Net.NetworkCredential]::new('', $adminSecurePassword).Password }
$adminInput | ConvertTo-Json -Compress | node --import tsx scripts/provision-admin.ts --local --showcase
Remove-Variable adminInput,adminSecurePassword
```

For an already-provisioned local account, add `--rotate`. Rotation replaces the salt/hash and revokes all its previous local sessions; it does not reactivate a disabled staff profile or change its roles. Without `--rotate`, existing accounts are never overwritten. Omit `--showcase` only when intentionally targeting the configured isolated test database.

For Vercel, first complete the owner-designated Supabase project, runtime/migration roles, application migrations and protected environment configuration. Supply the same input through stdin to `node --import tsx scripts/provision-admin.ts --project-ref <designated-project-ref>` instead of the local flags. The script requires matching project URL/database target, staging/production mode and demo disabled; it uses server-only Supabase Admin Auth, records the administrator role and all scope, and requires MFA enrollment on first sign-in. It never writes a local password hash into the hosted project. Existing hosted accounts require deliberate Supabase recovery, not password replacement by this command. If Auth creation succeeds but database provisioning fails, the script reports the Auth user ID for operator recovery; that identity has no application staff authority until setup is completed.

**Hosted provisioning has not been run.** The chosen Supabase project and secrets remain missing. The password supplied in chat was used only for the local account and was not retained as plaintext for later deployment; the owner must enter a password privately during hosted setup. Supabase reference: [server-side createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser).

## Booking messages

A successful reservation submission writes a durable `request_received` event. A repeated submission with the same idempotency key creates no second booking/event. The acknowledgement states that staff review is pending; it does not confirm a reservation or request payment. Later approved booking/payment/pickup/gallery events use their corresponding approved templates.

WhatsApp is preferred only when the guest supplies a valid international phone number and explicitly consents. Otherwise the approved email template is used. Definite WhatsApp failures can fall back to email; unknown send outcomes require reconciliation to prevent duplicate messages. Merely typing a phone number or email address does not send a message. Selecting WhatsApp now requires a phone number in both the form and server contract.

The local showcase starts a non-overlapping worker batch every minute and uses English local-only message templates. Synthetic `.invalid` recipients produce ignored `.local/outbox` previews; real addresses are rejected by the local sender, and no external delivery is claimed. Historical synthetic `.test` recipients may appear as failed local jobs for this reason. On Vercel, the protected cron worker dispatches messages after OpenWA, Resend sender verification, secrets, callback verification and approved locale templates are configured. Inspect **Notifications & jobs** for accepted/delivered/failed outcomes.

The owner designates staff addresses and least-privilege roles/scopes. Invite from Staff, privately share the returned link with the intended person, set a password and enroll an authenticator. The application does not claim an invitation email was sent. Current MFA, active profile, permissions and scope are checked on protected actions.

- **Reservations:** open the pending request, inspect participants, quoted items, cancellation policies and pickup requirements. Assign required resources, then approve or reject. A conflict allocates nothing. Refresh stale versions before deciding.
- **Operations:** maintain departures, vehicle seats/luggage, drivers, guides, equipment and photography assignments. Shared riders use one departure's vehicle/driver. Use manifests and clearance state; do not add unnecessary medical diagnoses.
- **Apartments:** maintain agency properties/physical units, approved translations, house rules, amenities, fees, seasonal rates and allowed policies. Blocks and stays share inventory. Use the Stays tab for check-in/checkout/cleaning events on the correct stay version.
- **Changes:** a guest request alone does not release inventory. Prepare a server quote revision; the guest explicitly accepts it before staff atomically replace the reservation. Cancellation and money return remain distinct actions.
- **Finance:** verify offline receipts, review exceptions and follow the separate request/approval/execution refund workflow. Reconcile unknown provider outcomes.
- **Photography:** upload to quarantine, inspect processing, attach purchased package entitlements and current photographer assignments. Review source rights and every subject/guardian consent before public publication. Private delivery rights do not authorize marketing.
- **Content:** edit drafts, review each enabled translation and record approval before publication. Use actual operator-approved itineraries, restrictions, policies and social/contact destinations.
- **Jobs:** correct the underlying dependency/template issue before retrying. Inspect current status afterward.

Deactivate staff when their role ends; revoke inappropriate scopes and grants. Do not share operator sessions, MFA codes or customer links. The last active all-scope owner cannot be removed accidentally.

Staff UAT must cover a request, conflict, approval, deposit/arrival balance, revision, cancellation, refund, stay operation, private gallery and revoked access before production launch.

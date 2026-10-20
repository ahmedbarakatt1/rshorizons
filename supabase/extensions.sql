-- Section 5.8–5.9 extension schema. Concatenate after the core app tables.
-- This file is a source fragment, not an independently applied migration.

create table app.media_assets (
  id uuid primary key default gen_random_uuid(),
  storage_bucket text not null check (length(storage_bucket) between 1 and 128),
  storage_key text not null check (length(storage_key) between 1 and 1024),
  uploaded_by uuid not null references app.staff_profiles(id) on delete restrict,
  mime_type text not null check (mime_type ~ '^(image|video)/[a-zA-Z0-9.+-]+$'),
  size_bytes bigint not null check (size_bytes > 0),
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  width integer check (width > 0),
  height integer check (height > 0),
  state text not null default 'quarantine' check (state in ('quarantine', 'processing', 'ready', 'rejected', 'deleted')),
  classification text not null default 'private' check (classification in ('private', 'public')),
  -- A classification is intent; original storage never becomes a public object.
  storage_visibility text not null default 'private' check (storage_visibility = 'private'),
  rights_evidence_ref text,
  rights_verified_by uuid references app.staff_profiles(id) on delete restrict,
  rights_verified_at timestamptz,
  subjects_reviewed_by uuid references app.staff_profiles(id) on delete restrict,
  subjects_reviewed_at timestamptz,
  safe_at timestamptz,
  retention_deadline timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (storage_bucket, storage_key),
  check ((rights_verified_at is null) = (rights_verified_by is null)),
  check (rights_verified_at is null or nullif(btrim(rights_evidence_ref), '') is not null),
  check ((subjects_reviewed_at is null) = (subjects_reviewed_by is null)),
  check (state <> 'ready' or safe_at is not null)
);

create table app.media_subjects (
  asset_id uuid not null references app.media_assets(id) on delete restrict,
  guest_id uuid not null references app.guests(id) on delete restrict,
  guardian_guest_id uuid references app.guests(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (asset_id, guest_id),
  check (guardian_guest_id is null or guardian_guest_id <> guest_id)
);

create table app.publication_consents (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null,
  subject_guest_id uuid not null,
  granted_by_guest_id uuid not null references app.guests(id) on delete restrict,
  evidence_ref text not null check (length(btrim(evidence_ref)) > 0),
  allowed_uses text[] not null check (cardinality(allowed_uses) > 0 and allowed_uses <@ array['marketing', 'social', 'website', 'print']::text[]),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  foreign key (asset_id, subject_guest_id) references app.media_subjects(asset_id, guest_id) on delete restrict,
  check (expires_at is null or expires_at > granted_at),
  check (withdrawn_at is null or withdrawn_at >= granted_at)
);
create index publication_consents_subject_idx on app.publication_consents(asset_id, subject_guest_id, granted_at desc);

create table app.media_derivatives (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references app.media_assets(id) on delete restrict,
  kind text not null check (kind in ('thumbnail', 'web', 'preview', 'original', 'video-poster')),
  storage_bucket text not null,
  storage_key text not null,
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  state text not null default 'processing' check (state in ('processing', 'ready', 'rejected', 'deleted')),
  width integer check (width > 0),
  height integer check (height > 0),
  size_bytes bigint check (size_bytes > 0),
  approved_by uuid references app.staff_profiles(id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (storage_bucket, storage_key),
  unique (id, asset_id),
  check (kind <> 'original' or visibility = 'private'),
  check ((approved_at is null) = (approved_by is null)),
  check (visibility <> 'public' or (approved_at is not null and state = 'ready'))
);
create index media_derivatives_asset_idx on app.media_derivatives(asset_id, kind);

create table app.media_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references app.jobs(id) on delete restrict,
  asset_id uuid not null references app.media_assets(id) on delete restrict,
  kind text not null check (kind in ('scan', 'metadata', 'thumbnail', 'preview', 'public_derivative', 'video_transcode')),
  provider_ref text,
  status text not null default 'queued' check (status in ('queued', 'processing', 'succeeded', 'failed')),
  failure_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0)
);
comment on table app.media_processing_jobs is 'Media-specific job projection. app.jobs owns leases, attempts, retry scheduling and execution.';
create index media_processing_jobs_asset_idx on app.media_processing_jobs(asset_id, status);

create table app.photo_packages (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  entitlement_rules jsonb not null check (jsonb_typeof(entitlement_rules) = 'object'),
  price_amount bigint not null check (price_amount >= 0),
  currency text not null references app.currencies(code) on delete restrict,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0)
);

create table app.photo_package_translations (
  package_id uuid not null references app.photo_packages(id) on delete restrict,
  locale text not null references app.locales(code) on delete restrict,
  title text not null check (length(btrim(title)) > 0),
  description text not null,
  approved_by uuid references app.staff_profiles(id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  primary key (package_id, locale),
  check ((approved_at is null) = (approved_by is null))
);

create table app.galleries (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('public', 'private')),
  booking_id uuid references app.bookings(id) on delete restrict,
  destination_id uuid references app.destinations(id) on delete restrict,
  visibility_state text not null default 'draft' check (visibility_state in ('draft', 'review', 'published', 'revoked', 'expired')),
  expires_at timestamptz,
  title text not null,
  assigned_photographer_id uuid references app.staff_profiles(id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  check ((kind = 'private' and booking_id is not null) or (kind = 'public' and booking_id is null)),
  check (visibility_state <> 'published' or published_at is not null),
  check (expires_at is null or expires_at > created_at)
);
create index galleries_booking_idx on app.galleries(booking_id) where booking_id is not null;
create index galleries_publication_idx on app.galleries(kind, visibility_state, published_at desc);

create table app.gallery_assets (
  gallery_id uuid not null references app.galleries(id) on delete restrict,
  asset_id uuid not null references app.media_assets(id) on delete restrict,
  display_order integer not null default 0 check (display_order >= 0),
  public_derivative_id uuid,
  preview_allowed boolean not null default true,
  download_allowed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  primary key (gallery_id, asset_id),
  foreign key (public_derivative_id, asset_id) references app.media_derivatives(id, asset_id) on delete restrict
);
create index gallery_assets_asset_idx on app.gallery_assets(asset_id, gallery_id);

create table app.gallery_entitlements (
  id uuid primary key default gen_random_uuid(),
  booking_item_id uuid not null references app.booking_items(id) on delete restrict,
  gallery_id uuid not null references app.galleries(id) on delete restrict,
  package_id uuid not null references app.photo_packages(id) on delete restrict,
  package_snapshot jsonb not null check (jsonb_typeof(package_snapshot) = 'object'),
  payment_eligible boolean not null default false,
  delivery_eligible boolean not null default false,
  allowed_variants text[] not null default array['preview']::text[],
  allowed_count integer check (allowed_count >= 0),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (booking_item_id, gallery_id),
  check (cardinality(allowed_variants) > 0 and allowed_variants <@ array['thumbnail', 'web', 'preview', 'original', 'video-poster']::text[])
);
create index gallery_entitlements_gallery_idx on app.gallery_entitlements(gallery_id);

create table app.photographer_assignments (
  staff_id uuid not null references app.staff_profiles(id) on delete restrict,
  booking_id uuid not null references app.bookings(id) on delete restrict,
  access_starts_at timestamptz not null,
  access_ends_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  primary key (staff_id, booking_id),
  check (access_starts_at < access_ends_at)
);
create index photographer_assignments_booking_idx on app.photographer_assignments(booking_id);

create table app.download_events (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid references app.access_grants(id) on delete restrict,
  session_id uuid references app.guest_sessions(id) on delete restrict,
  derivative_id uuid not null references app.media_derivatives(id) on delete restrict,
  action text not null check (action in ('preview', 'download', 'denied')),
  reason_code text,
  created_at timestamptz not null default now(),
  check (grant_id is not null or session_id is not null)
);
create index download_events_session_idx on app.download_events(session_id, created_at desc);
create index download_events_derivative_idx on app.download_events(derivative_id, created_at desc);
create trigger download_events_immutable before update or delete on app.download_events
for each row execute function app.deny_mutation();

create table app.public_gallery_translations (
  gallery_id uuid not null references app.galleries(id) on delete restrict,
  locale text not null references app.locales(code) on delete restrict,
  title text not null,
  description text not null default '',
  captions jsonb not null default '{}'::jsonb check (jsonb_typeof(captions) = 'object'),
  approved_by uuid references app.staff_profiles(id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  primary key (gallery_id, locale),
  check ((approved_at is null) = (approved_by is null))
);

-- Read-time eligibility is also mandatory: time can expire without a row write.
create function app.asset_publication_eligible(p_asset_id uuid) returns boolean
language sql stable security invoker set search_path = pg_catalog, app as $$
  select exists (
    select 1 from app.media_assets a
    where a.id = p_asset_id and a.state = 'ready' and a.safe_at is not null
      and a.rights_verified_at is not null and a.subjects_reviewed_at is not null
      and not exists (
        select 1 from app.media_subjects s
        where s.asset_id = a.id and not exists (
          select 1 from app.publication_consents c
          where c.asset_id = s.asset_id and c.subject_guest_id = s.guest_id
            and c.granted_by_guest_id = coalesce(s.guardian_guest_id, s.guest_id)
            and 'marketing' = any(c.allowed_uses) and c.granted_at <= now()
            and c.withdrawn_at is null and (c.expires_at is null or c.expires_at > now())
        )
      )
  );
$$;

create function app.assert_public_gallery(p_gallery_id uuid) returns void
language plpgsql security invoker set search_path = pg_catalog, app as $$
declare v_gallery app.galleries;
begin
  select * into v_gallery from app.galleries where id = p_gallery_id for update;
  if not found or v_gallery.kind <> 'public' or v_gallery.visibility_state <> 'published' then return; end if;
  if (v_gallery.expires_at is not null and v_gallery.expires_at <= now())
    or not exists (select 1 from app.gallery_assets where gallery_id = p_gallery_id)
    or exists (
      select 1 from app.gallery_assets ga
      join app.media_assets a on a.id = ga.asset_id
      left join app.media_derivatives d on d.id = ga.public_derivative_id and d.asset_id = ga.asset_id
      where ga.gallery_id = p_gallery_id and (
        not app.asset_publication_eligible(a.id) or d.id is null
        or d.visibility <> 'public' or d.state <> 'ready' or d.kind = 'original'
        or d.approved_at is null
        or exists (
          select 1 from app.media_assets original_asset
          where original_asset.storage_bucket = d.storage_bucket and original_asset.storage_key = d.storage_key
        )
      )
    )
  then raise exception 'Public gallery requires safe media, rights, subject consent and approved public derivatives' using errcode = '23514';
  end if;
end;
$$;

create function app.assert_public_asset(p_asset_id uuid) returns void
language plpgsql security invoker set search_path = pg_catalog, app as $$
begin
  perform 1 from app.media_assets where id = p_asset_id for update;
  if exists (
    select 1 from app.media_derivatives d join app.media_assets a on a.id = d.asset_id
    where d.asset_id = p_asset_id and d.visibility = 'public' and (
      not app.asset_publication_eligible(a.id)
      or exists (
        select 1 from app.media_assets original_asset
        where original_asset.storage_bucket = d.storage_bucket and original_asset.storage_key = d.storage_key
      )
    )
  ) then raise exception 'Public derivative requires current rights and consent and a separate object' using errcode = '23514'; end if;
end;
$$;

create function app.enforce_public_gallery() returns trigger
language plpgsql security invoker set search_path = pg_catalog, app as $$
declare v_gallery_id uuid; v_asset_id uuid; v_old_asset_id uuid;
begin
  if tg_table_name = 'galleries' then
    perform app.assert_public_gallery(new.id);
  elsif tg_table_name = 'gallery_assets' then
    if tg_op <> 'INSERT' then perform app.assert_public_gallery(old.gallery_id); end if;
    if tg_op <> 'DELETE' then perform app.assert_public_gallery(new.gallery_id); end if;
  else
    if tg_table_name = 'media_assets' then
      v_asset_id := new.id;
      v_old_asset_id := old.id;
    else
      if tg_op <> 'DELETE' then v_asset_id := new.asset_id; end if;
      if tg_op <> 'INSERT' then v_old_asset_id := old.asset_id; end if;
    end if;
    if v_asset_id is not null then perform app.assert_public_asset(v_asset_id); end if;
    if v_old_asset_id is not null and v_old_asset_id is distinct from v_asset_id then
      perform app.assert_public_asset(v_old_asset_id);
    end if;
    for v_gallery_id in
      select distinct gallery_id from app.gallery_assets
      where asset_id in (v_asset_id, v_old_asset_id) order by gallery_id
    loop perform app.assert_public_gallery(v_gallery_id); end loop;
  end if;
  return null;
end;
$$;

create constraint trigger galleries_publication_guard after insert or update on app.galleries
deferrable initially deferred for each row execute function app.enforce_public_gallery();
create constraint trigger gallery_assets_publication_guard after insert or update or delete on app.gallery_assets
deferrable initially deferred for each row execute function app.enforce_public_gallery();
create constraint trigger media_assets_publication_guard after update on app.media_assets
deferrable initially deferred for each row execute function app.enforce_public_gallery();
create constraint trigger media_subjects_publication_guard after insert or update or delete on app.media_subjects
deferrable initially deferred for each row execute function app.enforce_public_gallery();
create constraint trigger media_derivatives_publication_guard after insert or update or delete on app.media_derivatives
deferrable initially deferred for each row execute function app.enforce_public_gallery();
create constraint trigger publication_consents_publication_guard after insert or update or delete on app.publication_consents
deferrable initially deferred for each row execute function app.enforce_public_gallery();

create function app.enforce_gallery_entitlement() returns trigger
language plpgsql security invoker set search_path = pg_catalog, app as $$
begin
  if not exists (
    select 1 from app.galleries g join app.booking_items bi on bi.booking_id = g.booking_id
    where g.id = new.gallery_id and g.kind = 'private' and bi.id = new.booking_item_id
  ) then raise exception 'Gallery entitlement must belong to the same private booking' using errcode = '23514'; end if;
  return new;
end;
$$;
create trigger gallery_entitlement_booking_guard before insert or update on app.gallery_entitlements
for each row execute function app.enforce_gallery_entitlement();

create function app.revalidate_gallery_entitlements() returns trigger
language plpgsql security invoker set search_path = pg_catalog, app as $$
begin
  if exists (
    select 1 from app.gallery_entitlements e
    join app.galleries g on g.id = e.gallery_id
    join app.booking_items bi on bi.id = e.booking_item_id
    where ((tg_table_name = 'galleries' and g.id = new.id)
       or (tg_table_name = 'booking_items' and bi.id = new.id))
      and (g.kind <> 'private' or g.booking_id is distinct from bi.booking_id)
  ) then raise exception 'Gallery entitlement must retain the same private booking' using errcode = '23514'; end if;
  return null;
end;
$$;
create constraint trigger gallery_entitlements_gallery_change_guard after update on app.galleries
deferrable initially deferred for each row execute function app.revalidate_gallery_entitlements();
create constraint trigger gallery_entitlements_item_change_guard after update on app.booking_items
deferrable initially deferred for each row execute function app.revalidate_gallery_entitlements();

create table app.review_invitations (
  id uuid primary key default gen_random_uuid(),
  booking_item_id uuid not null unique references app.booking_items(id) on delete restrict,
  eligible_at timestamptz not null,
  sent_at timestamptz,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (id, booking_item_id),
  check (expires_at > eligible_at),
  check (used_at is null or (used_at >= eligible_at and used_at < expires_at))
);

create table app.reviews (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null unique,
  booking_item_id uuid not null unique references app.booking_items(id) on delete restrict,
  primary_guest_id uuid not null references app.guests(id) on delete restrict,
  rating smallint not null check (rating between 1 and 5),
  original_text text not null check (length(original_text) between 1 and 10000),
  original_locale text not null references app.locales(code) on delete restrict,
  submitted_at timestamptz not null default now(),
  moderation_state text not null default 'pending' check (moderation_state in ('pending', 'published', 'rejected', 'withdrawn')),
  display_name_preference text not null default 'initials' check (display_name_preference in ('first_name', 'initials', 'anonymous')),
  public_display_name text not null check (length(public_display_name) between 1 and 100),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  foreign key (invitation_id, booking_item_id) references app.review_invitations(id, booking_item_id) on delete restrict,
  check (moderation_state <> 'published' or published_at is not null)
);
create index reviews_public_idx on app.reviews(moderation_state, submitted_at desc);
create index reviews_guest_idx on app.reviews(primary_guest_id);

create function app.enforce_review_submission() returns trigger
language plpgsql security invoker set search_path = pg_catalog, app as $$
declare v_invitation app.review_invitations;
begin
  select * into v_invitation from app.review_invitations where id = new.invitation_id for update;
  if not found or v_invitation.booking_item_id <> new.booking_item_id
    or v_invitation.eligible_at > now() or v_invitation.expires_at <= now()
    or v_invitation.used_at is not null or v_invitation.revoked_at is not null then
    raise exception 'Review invitation is unavailable' using errcode = '23514';
  end if;
  if not exists (
    select 1 from app.booking_items bi join app.bookings b on b.id = bi.booking_id
    where bi.id = new.booking_item_id and bi.fulfilment_state = 'fulfilled'
      and b.primary_guest_id = new.primary_guest_id
  ) then raise exception 'Review requires the completed item and its primary guest' using errcode = '23514'; end if;
  new.submitted_at := now();
  update app.review_invitations set used_at = now() where id = new.invitation_id;
  return new;
end;
$$;
create trigger review_submission_guard before insert on app.reviews
for each row execute function app.enforce_review_submission();

create function app.protect_review_original() returns trigger
language plpgsql security invoker set search_path = pg_catalog, app as $$
begin
  if tg_op = 'DELETE' then raise exception 'Reviews must be withdrawn, not deleted' using errcode = '23514'; end if;
  if row(new.id, new.invitation_id, new.booking_item_id, new.primary_guest_id, new.rating, new.original_text, new.original_locale, new.submitted_at)
    is distinct from row(old.id, old.invitation_id, old.booking_item_id, old.primary_guest_id, old.rating, old.original_text, old.original_locale, old.submitted_at)
  then raise exception 'Submitted review identity, rating and text are immutable' using errcode = '23514'; end if;
  return new;
end;
$$;
create trigger review_original_immutable before update or delete on app.reviews
for each row execute function app.protect_review_original();

create table app.review_moderation_events (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references app.reviews(id) on delete restrict,
  actor_id uuid not null references app.staff_profiles(id) on delete restrict,
  action text not null check (action in ('publish', 'reject', 'withdraw', 'restore')),
  reason text not null check (length(btrim(reason)) > 0),
  created_at timestamptz not null default now()
);
create index review_moderation_events_review_idx on app.review_moderation_events(review_id, created_at desc);
create trigger review_moderation_events_immutable before update or delete on app.review_moderation_events
for each row execute function app.deny_mutation();

create table app.review_replies (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references app.reviews(id) on delete restrict,
  staff_id uuid not null references app.staff_profiles(id) on delete restrict,
  body text not null check (length(body) between 1 and 10000),
  published_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0)
);
create index review_replies_review_idx on app.review_replies(review_id, published_at);

create table app.cms_pages (
  id uuid primary key default gen_random_uuid(),
  page_key text not null unique check (page_key ~ '^[a-z0-9][a-z0-9_-]*$'),
  status text not null default 'draft' check (status in ('draft', 'review', 'published', 'archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  check (status <> 'published' or published_at is not null)
);

create table app.cms_translations (
  page_id uuid not null references app.cms_pages(id) on delete restrict,
  locale text not null references app.locales(code) on delete restrict,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9/-]*$'),
  title text not null,
  structured_body jsonb not null check (jsonb_typeof(structured_body) = 'array'),
  seo_title text,
  seo_description text,
  approved_by uuid references app.staff_profiles(id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  primary key (page_id, locale),
  unique (locale, slug),
  check ((approved_at is null) = (approved_by is null))
);

create table app.social_links (
  id uuid primary key default gen_random_uuid(),
  platform text not null unique check (platform in ('facebook', 'instagram', 'tiktok', 'whatsapp')),
  url text not null,
  active boolean not null default false,
  verified_by uuid references app.staff_profiles(id) on delete restrict,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  check (
    (platform = 'facebook' and url ~ '^https://(www\.)?facebook\.com/[^[:space:]?#@]+([?][^[:space:]#]*)?$')
    or (platform = 'instagram' and url ~ '^https://(www\.)?instagram\.com/[^[:space:]?#@]+/?$')
    or (platform = 'tiktok' and url ~ '^https://(www\.)?tiktok\.com/@[^[:space:]?#/]+/?$')
    or (platform = 'whatsapp' and url ~ '^https://wa\.me/[1-9][0-9]{6,14}$')
  ),
  check (not active or (verified_by is not null and verified_at is not null))
);

create table app.contact_requests (
  id uuid primary key default gen_random_uuid(),
  sender_name text not null check (length(sender_name) between 1 and 200),
  email text,
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  locale text not null references app.locales(code) on delete restrict,
  message text not null check (length(message) between 1 and 10000),
  state text not null default 'new' check (state in ('new', 'assigned', 'replied', 'closed', 'spam')),
  assigned_to uuid references app.staff_profiles(id) on delete restrict,
  consent_metadata jsonb not null check (jsonb_typeof(consent_metadata) = 'object'),
  retention_deadline timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  check (nullif(btrim(email), '') is not null or phone_e164 is not null),
  check (retention_deadline > created_at)
);
create index contact_requests_queue_idx on app.contact_requests(state, created_at);
create index contact_requests_retention_idx on app.contact_requests(retention_deadline);

create table app.notification_templates (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  channel text not null check (channel in ('email', 'whatsapp')),
  locale text not null references app.locales(code) on delete restrict,
  template_version integer not null check (template_version > 0),
  provider text not null,
  provider_template_id text,
  provider_language text,
  approval_status text not null default 'draft' check (approval_status in ('draft', 'pending', 'approved', 'rejected', 'paused', 'disabled')),
  category text not null check (category in ('transactional', 'utility', 'authentication', 'marketing')),
  subject_template text,
  body_template text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (event_type, channel, locale, template_version),
  check (channel <> 'whatsapp' or approval_status <> 'approved' or (provider_template_id is not null and provider_language is not null))
);

create table app.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references app.jobs(id) on delete restrict,
  template_id uuid references app.notification_templates(id) on delete restrict,
  channel text not null check (channel in ('email', 'whatsapp')),
  attempt integer not null check (attempt > 0),
  provider text not null,
  provider_message_id text,
  status text not null default 'queued' check (status in ('queued', 'submitted', 'accepted', 'delivered', 'read', 'failed', 'suppressed', 'unknown')),
  error_class text,
  submitted_at timestamptz,
  accepted_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (job_id, channel, attempt),
  unique (provider, provider_message_id),
  check (status <> 'delivered' or delivered_at is not null),
  check (status <> 'read' or (delivered_at is not null and read_at is not null)),
  check (status <> 'failed' or failed_at is not null)
);
create index notification_deliveries_pending_idx on app.notification_deliveries(status, created_at) where status in ('queued', 'submitted', 'accepted', 'unknown');

create table app.integration_health (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  environment text not null check (environment in ('development', 'staging', 'production')),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  status text not null default 'unknown' check (status in ('unknown', 'healthy', 'degraded', 'unavailable')),
  safe_diagnostics jsonb not null default '{}'::jsonb check (jsonb_typeof(safe_diagnostics) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (provider, environment)
);

create table app.security_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('authentication', 'access', 'rate_limit', 'privilege', 'session_revoked', 'suspicious_activity')),
  severity text not null check (severity in ('info', 'warning', 'critical')),
  correlation_id uuid not null,
  staff_id uuid references app.staff_profiles(id) on delete restrict,
  guest_session_id uuid references app.guest_sessions(id) on delete restrict,
  redacted_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(redacted_metadata) = 'object'),
  retention_deadline timestamptz not null,
  created_at timestamptz not null default now(),
  check (retention_deadline > created_at)
);
create index security_events_correlation_idx on app.security_events(correlation_id, created_at desc);
create index security_events_retention_idx on app.security_events(retention_deadline);
create trigger security_events_immutable before update or delete on app.security_events
for each row execute function app.deny_mutation();

create table app.rate_limit_buckets (
  id uuid primary key default gen_random_uuid(),
  key_digest text not null check (key_digest ~ '^[0-9a-f]{64}$'),
  operation text not null check (length(operation) between 1 and 100),
  window_started_at timestamptz not null,
  window_seconds integer not null check (window_seconds between 1 and 86400),
  counter bigint not null check (counter >= 0),
  resets_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (key_digest, operation, window_started_at, window_seconds),
  check (resets_at = window_started_at + make_interval(secs => window_seconds))
);
create index rate_limit_buckets_expiry_idx on app.rate_limit_buckets(resets_at);

create function app.consume_rate_limit(p_key_digest text, p_operation text, p_window_seconds integer, p_limit integer)
returns table (allowed boolean, remaining bigint, resets_at timestamptz)
language plpgsql security invoker set search_path = pg_catalog, app as $$
declare v_start timestamptz; v_count bigint; v_reset timestamptz;
begin
  if p_key_digest is null or p_key_digest !~ '^[0-9a-f]{64}$'
    or p_operation is null or length(p_operation) not between 1 and 100
    or p_window_seconds is null or p_window_seconds not between 1 and 86400
    or p_limit is null or p_limit < 1 then
    raise exception 'Invalid rate-limit parameters' using errcode = '22023';
  end if;
  v_start := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds);
  insert into app.rate_limit_buckets(key_digest, operation, window_started_at, window_seconds, counter, resets_at)
  values (p_key_digest, p_operation, v_start, p_window_seconds, 1, v_start + make_interval(secs => p_window_seconds))
  on conflict (key_digest, operation, window_started_at, window_seconds)
  do update set counter = least(app.rate_limit_buckets.counter, 2147483647::bigint) + 1, updated_at = now()
  returning counter, app.rate_limit_buckets.resets_at into v_count, v_reset;
  return query select v_count <= p_limit, greatest(p_limit::bigint - v_count, 0::bigint), v_reset;
end;
$$;

-- No browser grants or permissive policies are introduced here. The final
-- migration phase enables RLS and grants only the server's required operations.

BEGIN;

-- Preserve historical references while removing shore diving from every new
-- public and staff-facing selection surface.
UPDATE app.services AS service
SET status='archived',version=service.version+1,updated_at=now()
FROM app.categories AS category
WHERE service.category_id=category.id
  AND category.code='shore_dives'
  AND service.status<>'archived';

UPDATE app.categories
SET active=false
WHERE code='shore_dives' AND active;

COMMIT;

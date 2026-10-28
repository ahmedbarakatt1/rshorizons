-- Keep extension objects outside the public Data API schema.
-- Existing GiST indexes and constraints retain their object dependencies.
CREATE SCHEMA IF NOT EXISTS extensions;
DO $extension_schema$ BEGIN
 IF (SELECT extnamespace FROM pg_extension WHERE extname='btree_gist') <> 'extensions'::regnamespace THEN
  ALTER EXTENSION btree_gist SET SCHEMA extensions;
 END IF;
END $extension_schema$;
GRANT USAGE ON SCHEMA extensions TO tourism_app;

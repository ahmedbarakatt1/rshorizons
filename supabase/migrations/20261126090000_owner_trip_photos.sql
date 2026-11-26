-- Set only for an owner's public trip photo intent. Existing assets retain their original workflow.
ALTER TABLE app.media_assets ADD COLUMN trip_photo_locale text REFERENCES app.locales(code);

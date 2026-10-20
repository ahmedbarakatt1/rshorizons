DO $$ BEGIN
  IF to_regclass('app.apartment_inventory') IS NULL THEN RAISE EXCEPTION 'missing apartment inventory implementation'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='app.apartment_inventory'::regclass AND contype='x') THEN RAISE EXCEPTION 'missing overlap exclusion'; END IF;
END $$;

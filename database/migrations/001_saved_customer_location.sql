-- GAS-INFO: optional saved customer location fields for an existing database.
-- Safe to run more than once. Adds columns only; existing account data is preserved.
ALTER TABLE users ADD COLUMN IF NOT EXISTS saved_latitude DOUBLE PRECISION;
ALTER TABLE users ADD COLUMN IF NOT EXISTS saved_longitude DOUBLE PRECISION;
ALTER TABLE users ADD COLUMN IF NOT EXISTS saved_location_label VARCHAR(180);
ALTER TABLE users ADD COLUMN IF NOT EXISTS saved_location_updated_at TIMESTAMPTZ;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_saved_latitude_range') THEN
    ALTER TABLE users ADD CONSTRAINT users_saved_latitude_range
      CHECK (saved_latitude IS NULL OR saved_latitude BETWEEN -90 AND 90);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_saved_longitude_range') THEN
    ALTER TABLE users ADD CONSTRAINT users_saved_longitude_range
      CHECK (saved_longitude IS NULL OR saved_longitude BETWEEN -180 AND 180);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_saved_location_pair') THEN
    ALTER TABLE users ADD CONSTRAINT users_saved_location_pair
      CHECK ((saved_latitude IS NULL AND saved_longitude IS NULL) OR
             (saved_latitude IS NOT NULL AND saved_longitude IS NOT NULL));
  END IF;
END $$;

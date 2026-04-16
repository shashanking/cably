-- Store per-dataset spatial summary so we can render each dataset as a
-- single "collection" on the map without loading every asset.

ALTER TABLE datasets
  ADD COLUMN IF NOT EXISTS bbox JSONB,
  ADD COLUMN IF NOT EXISTS centroid JSONB;

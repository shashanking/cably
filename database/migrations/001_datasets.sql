-- Datasets: one row per uploaded KML/KMZ/GeoJSON file.
-- A dataset groups assets that share a source/owner so they can be
-- analyzed together (per-company network, per-upload metrics, etc).

CREATE TABLE IF NOT EXISTS datasets (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  source_file TEXT,
  feature_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS dataset_id INTEGER REFERENCES datasets(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS assets_dataset_id_idx ON assets (dataset_id);

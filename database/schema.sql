-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Datasets group assets uploaded from a single KML/KMZ/GeoJSON file.
CREATE TABLE datasets (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  source_file TEXT,
  feature_count INTEGER NOT NULL DEFAULT 0,
  bbox JSONB,
  centroid JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create assets table
CREATE TABLE assets (
  id SERIAL PRIMARY KEY,
  dataset_id INTEGER REFERENCES datasets(id) ON DELETE CASCADE,
  type VARCHAR(50),
  geometry JSONB,
  properties JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on JSONB geometry for faster queries
CREATE INDEX assets_geometry_idx ON assets USING GIN (geometry);
CREATE INDEX assets_dataset_id_idx ON assets (dataset_id);

-- Create storage bucket for uploads
-- Run this in Supabase dashboard: Storage > Create bucket named 'uploads' with public access
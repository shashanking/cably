-- Module 6: Executive dashboard fields + plans table
-- Run this in the Supabase SQL editor, or via psql.

-- 1. New columns on assets -----------------------------------------------------
ALTER TABLE assets ADD COLUMN IF NOT EXISTS operational_status VARCHAR(16) DEFAULT 'online';
ALTER TABLE assets ADD COLUMN IF NOT EXISTS utilization_pct NUMERIC(5,2);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS capacity_pct NUMERIC(5,2);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS region VARCHAR(32);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS installed_year SMALLINT;

CREATE INDEX IF NOT EXISTS idx_assets_operational_status ON assets(operational_status);
CREATE INDEX IF NOT EXISTS idx_assets_region ON assets(region);
CREATE INDEX IF NOT EXISTS idx_assets_installed_year ON assets(installed_year);

-- 2. Plans table — forward-looking expansion targets / budgets ----------------
CREATE TABLE IF NOT EXISTS plans (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  target_year INTEGER NOT NULL,
  planned_miles NUMERIC(12,2) NOT NULL DEFAULT 0,
  budget NUMERIC(14,2) NOT NULL DEFAULT 0,
  status VARCHAR(16) DEFAULT 'on_track',  -- on_track | at_risk | behind | complete
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plans_target_year ON plans(target_year);

-- 3. Seed one plan so the dashboard has data out of the box -------------------
INSERT INTO plans (name, target_year, planned_miles, budget, status, notes)
SELECT 'Fiber Expansion', 2027, 450, 5200000, 'on_track',
       'Baseline plan matching reference Executive Dashboard'
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE target_year = 2027);

-- 4. Backfill operational_status for existing rows ----------------------------
-- All existing assets start as 'online' (default) unless they were marked
-- decommissioned or maintenance via the older status column.
UPDATE assets
  SET operational_status = CASE
    WHEN status IN ('decommissioned', 'retired') THEN 'offline'
    WHEN status IN ('maintenance', 'outage') THEN 'warning'
    ELSE 'online'
  END
WHERE operational_status IS NULL OR operational_status = 'online';

-- 5. Seed utilization + capacity with realistic ranges so charts render -------
-- Deterministic per-row via id so repeat runs produce the same values.
-- Editable from the asset detail page — these are just starting values.
UPDATE assets
  SET utilization_pct = ROUND((40 + (MOD(ABS(id::bigint * 2654435761::bigint), 55))))::numeric,
      capacity_pct    = ROUND((60 + (MOD(ABS(id::bigint * 40503::bigint), 40))))::numeric
WHERE utilization_pct IS NULL OR capacity_pct IS NULL;

-- 6. Derive installed_year from properties if available -----------------------
UPDATE assets
  SET installed_year = NULLIF(
    regexp_replace(
      COALESCE(
        properties->>'install_year',
        properties->>'installed_year',
        properties->>'year_built',
        properties->>'Year'
      ),
      '[^0-9]', '', 'g'
    ),
    ''
  )::int
WHERE installed_year IS NULL
  AND properties ? 'install_year' OR properties ? 'installed_year'
       OR properties ? 'year_built' OR properties ? 'Year';

-- 7. Derive US region from properties.state when present ---------------------
-- Leave NULL when unknown so the Regional COGS view can show "Unassigned".
UPDATE assets SET region = CASE
  WHEN upper(COALESCE(properties->>'state', properties->>'State', '')) IN
       ('WA','OR','CA','NV','ID','MT','WY','UT','CO','AK','HI') THEN 'West'
  WHEN upper(COALESCE(properties->>'state', properties->>'State', '')) IN
       ('AZ','NM','TX','OK') THEN 'Southwest'
  WHEN upper(COALESCE(properties->>'state', properties->>'State', '')) IN
       ('ND','SD','NE','KS','MN','IA','MO','WI','IL','IN','MI','OH') THEN 'Midwest'
  WHEN upper(COALESCE(properties->>'state', properties->>'State', '')) IN
       ('AR','LA','MS','AL','TN','KY','GA','FL','SC','NC','VA','WV') THEN 'Southeast'
  WHEN upper(COALESCE(properties->>'state', properties->>'State', '')) IN
       ('ME','NH','VT','MA','RI','CT','NY','NJ','PA','DE','MD','DC') THEN 'Northeast'
  ELSE region
END
WHERE region IS NULL;

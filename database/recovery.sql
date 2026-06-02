-- ============================================================================
-- FULL SCHEMA RECOVERY — run this in the Supabase SQL editor after a
-- DROP TABLE CASCADE accident. Rebuilds every table, index, view, and RPC
-- the app needs. Safe to re-run (uses IF NOT EXISTS / OR REPLACE everywhere).
--
-- Runs migrations 001-008 in dependency order as a single transaction.
-- ============================================================================

-- ── EXTENSIONS ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS postgis;

-- ── TABLE: datasets (one row per uploaded KML/KMZ/GeoJSON file) ─────────────
CREATE TABLE IF NOT EXISTS datasets (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  source_file TEXT,
  feature_count INTEGER NOT NULL DEFAULT 0,
  bbox JSONB,
  centroid JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── TABLE: vendors ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendors (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  contact_email TEXT,
  contact_phone TEXT,
  address TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── TABLE: assets (the main GIS table) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS assets (
  id SERIAL PRIMARY KEY,
  dataset_id INTEGER REFERENCES datasets(id) ON DELETE CASCADE,
  type VARCHAR(50),
  geometry JSONB,
  properties JSONB,
  name TEXT,
  status VARCHAR(20) DEFAULT 'active',
  vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
  cost_per_km NUMERIC(12,2),
  total_cost NUMERIC(14,2),
  length_km NUMERIC(10,3),
  operational_status VARCHAR(16) DEFAULT 'online',
  utilization_pct NUMERIC(5,2),
  capacity_pct NUMERIC(5,2),
  region VARCHAR(32),
  installed_year SMALLINT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── TABLE: plans (forward-looking expansion targets) ────────────────────────
CREATE TABLE IF NOT EXISTS plans (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  target_year INTEGER NOT NULL,
  planned_miles NUMERIC(12,2) NOT NULL DEFAULT 0,
  budget NUMERIC(14,2) NOT NULL DEFAULT 0,
  status VARCHAR(16) DEFAULT 'on_track',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── RLS — disable on these tables ──────────────────────────────────────────
-- Supabase enables RLS by default on new tables in the public schema. This
-- app uses the anon key for all writes from server-side /api/* routes, which
-- act as the trust boundary. Leaving RLS on without policies breaks every
-- insert/update (error 42501). Match the pre-wipe behavior: RLS off.
ALTER TABLE datasets DISABLE ROW LEVEL SECURITY;
ALTER TABLE assets   DISABLE ROW LEVEL SECURITY;
ALTER TABLE vendors  DISABLE ROW LEVEL SECURITY;
ALTER TABLE plans    DISABLE ROW LEVEL SECURITY;

-- ── INDEXES ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS assets_geometry_idx       ON assets USING GIN (geometry);
CREATE INDEX IF NOT EXISTS assets_dataset_id_idx     ON assets (dataset_id);
CREATE INDEX IF NOT EXISTS idx_assets_status         ON assets (status);
CREATE INDEX IF NOT EXISTS idx_assets_vendor         ON assets (vendor_id);
CREATE INDEX IF NOT EXISTS idx_assets_name           ON assets (name);
CREATE INDEX IF NOT EXISTS idx_assets_operational_status ON assets (operational_status);
CREATE INDEX IF NOT EXISTS idx_assets_region         ON assets (region);
CREATE INDEX IF NOT EXISTS idx_assets_installed_year ON assets (installed_year);
CREATE INDEX IF NOT EXISTS idx_assets_created_at     ON assets (created_at);
CREATE INDEX IF NOT EXISTS idx_assets_type           ON assets (LOWER(type));
CREATE INDEX IF NOT EXISTS idx_plans_target_year     ON plans (target_year);

-- ── SEED: one plan row so the dashboard renders ─────────────────────────────
INSERT INTO plans (name, target_year, planned_miles, budget, status, notes)
SELECT 'Fiber Expansion', 2027, 450, 5200000, 'on_track', 'Baseline plan'
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE target_year = 2027);

-- ── VIEW: asset_gaps_v (used by /api/assets/gaps) ───────────────────────────
CREATE OR REPLACE VIEW asset_gaps_v AS
SELECT
  id, dataset_id, type, name, status, vendor_id,
  cost_per_km, total_cost, length_km,
  operational_status, utilization_pct, capacity_pct,
  region, installed_year, properties,
  (
    vendor_id             IS NULL
    OR operational_status IS NULL
    OR utilization_pct    IS NULL
    OR capacity_pct       IS NULL
    OR region             IS NULL
    OR installed_year     IS NULL
    OR cost_per_km        IS NULL
    OR total_cost         IS NULL
    OR length_km          IS NULL
  ) AS has_gaps
FROM assets;

ALTER VIEW asset_gaps_v SET (security_invoker = on);

-- ── RPC: dashboard_summary (migration 007) ──────────────────────────────────
CREATE OR REPLACE FUNCTION dashboard_summary()
RETURNS json
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_total_routes        int;
  v_active_routes_n     int;
  v_total_length_km     numeric;
  v_planned_length_km   numeric;
  v_total_cost          numeric;
  v_miles_this_year     numeric;
  v_miles_last_year     numeric;
  v_cost_this_year      numeric;
  v_cost_last_year      numeric;
  v_owned_miles         numeric;
  v_leased_miles        numeric;
  v_composition_json    json;
  v_vendor_costs_json   json;
  v_cost_per_mile_json  json;
  v_facilities_json     json;
  v_plans_json          json;
  v_active_plan_json    json;
  v_result              json;
  v_facility_types CONSTANT text[] := ARRAY['pops', 'wirecenters', 'colo', 'datacenters'];
BEGIN
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE COALESCE(a.operational_status, 'online') = 'online')::int,
    COALESCE(SUM(a.length_km), 0),
    COALESCE(SUM(a.length_km) FILTER (WHERE LOWER(COALESCE(a.status, '')) = 'planned'), 0)
  INTO v_total_routes, v_active_routes_n, v_total_length_km, v_planned_length_km
  FROM assets a
  WHERE a.type IS NOT NULL AND LOWER(a.type) <> ALL (v_facility_types);

  SELECT COALESCE(SUM(a.total_cost), 0) INTO v_total_cost FROM assets a;

  SELECT
    COALESCE(SUM(a.length_km)  FILTER (WHERE a.created_at >= NOW() - INTERVAL '1 year'), 0),
    COALESCE(SUM(a.length_km)  FILTER (WHERE a.created_at >= NOW() - INTERVAL '2 year'
                                         AND a.created_at <  NOW() - INTERVAL '1 year'), 0),
    COALESCE(SUM(a.total_cost) FILTER (WHERE a.created_at >= NOW() - INTERVAL '1 year'), 0),
    COALESCE(SUM(a.total_cost) FILTER (WHERE a.created_at >= NOW() - INTERVAL '2 year'
                                         AND a.created_at <  NOW() - INTERVAL '1 year'), 0)
  INTO v_miles_this_year, v_miles_last_year, v_cost_this_year, v_cost_last_year
  FROM assets a
  WHERE a.type IS NOT NULL AND LOWER(a.type) <> ALL (v_facility_types);

  SELECT COALESCE(json_agg(row_to_json(c) ORDER BY c.miles DESC), '[]'::json)
  INTO v_composition_json
  FROM (
    SELECT
      LOWER(a.type) AS type,
      ROUND(SUM(COALESCE(a.length_km, 0))::numeric * 10) / 10 AS miles,
      COUNT(*)::int AS count,
      CASE WHEN v_total_length_km > 0
           THEN ROUND(SUM(COALESCE(a.length_km, 0))::numeric / v_total_length_km * 1000) / 10
           ELSE 0 END AS share
    FROM assets a
    WHERE a.type IS NOT NULL AND LOWER(a.type) <> ALL (v_facility_types)
    GROUP BY LOWER(a.type)
  ) c;

  SELECT
    COALESCE(SUM(a.length_km) FILTER (WHERE LOWER(COALESCE(a.type, '')) = 'owned'),  0),
    COALESCE(SUM(a.length_km) FILTER (WHERE LOWER(COALESCE(a.type, '')) = 'leased'), 0)
  INTO v_owned_miles, v_leased_miles
  FROM assets a;

  SELECT COALESCE(json_agg(row_to_json(v) ORDER BY v.cost DESC), '[]'::json)
  INTO v_vendor_costs_json
  FROM (
    SELECT
      COALESCE(ven.name, 'Vendor #' || a.vendor_id) AS name,
      COALESCE(SUM(a.total_cost), 0)::numeric AS cost,
      COALESCE(SUM(a.length_km),  0)::numeric AS miles
    FROM assets a
    LEFT JOIN vendors ven ON ven.id = a.vendor_id
    WHERE a.vendor_id IS NOT NULL
    GROUP BY a.vendor_id, ven.name
    ORDER BY cost DESC
    LIMIT 8
  ) v;

  SELECT COALESCE(json_agg(row_to_json(cpm) ORDER BY cpm.cost_per_mile DESC), '[]'::json)
  INTO v_cost_per_mile_json
  FROM (
    SELECT
      a.id,
      COALESCE(a.name, 'Route #' || a.id) AS name,
      COALESCE(ven.name, '—') AS vendor,
      ROUND((a.length_km * 0.621371)::numeric * 10) / 10 AS distance_mi,
      ROUND(COALESCE(a.total_cost, 0)::numeric) AS total_cost,
      CASE
        WHEN a.cost_per_km IS NOT NULL THEN ROUND((a.cost_per_km / 0.621371)::numeric)::int
        ELSE ROUND((COALESCE(a.total_cost, 0) / GREATEST(a.length_km * 0.621371, 0.01))::numeric)::int
      END AS cost_per_mile,
      COALESCE(a.status, 'active') AS status,
      a.utilization_pct
    FROM assets a
    LEFT JOIN vendors ven ON ven.id = a.vendor_id
    WHERE a.type IS NOT NULL AND LOWER(a.type) <> ALL (v_facility_types)
      AND a.length_km IS NOT NULL AND a.length_km > 0
      AND (a.total_cost IS NOT NULL OR a.cost_per_km IS NOT NULL)
    ORDER BY cost_per_mile DESC
    LIMIT 8
  ) cpm;

  SELECT COALESCE(json_agg(row_to_json(f)), '[]'::json)
  INTO v_facilities_json
  FROM (
    SELECT
      LOWER(a.type) AS type,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE COALESCE(a.operational_status, 'online') = 'online')::int AS online,
      COUNT(*) FILTER (WHERE a.operational_status = 'offline')::int AS offline,
      COUNT(*) FILTER (WHERE a.operational_status IS NOT NULL
                         AND a.operational_status NOT IN ('online','offline'))::int AS warning,
      COALESCE(ROUND(AVG(a.capacity_pct))::int,    0) AS capacity,
      COALESCE(ROUND(AVG(a.utilization_pct))::int, 0) AS utilization
    FROM assets a
    WHERE a.type IS NOT NULL AND LOWER(a.type) = ANY (v_facility_types)
    GROUP BY LOWER(a.type)
  ) f;

  SELECT COALESCE(json_agg(row_to_json(p) ORDER BY p.target_year ASC), '[]'::json)
  INTO v_plans_json
  FROM plans p;

  SELECT row_to_json(p) INTO v_active_plan_json
  FROM (SELECT * FROM plans
        WHERE target_year >= EXTRACT(YEAR FROM NOW())::int
        ORDER BY target_year ASC LIMIT 1) p;
  IF v_active_plan_json IS NULL THEN
    SELECT row_to_json(p) INTO v_active_plan_json
    FROM (SELECT * FROM plans ORDER BY target_year ASC LIMIT 1) p;
  END IF;

  v_result := json_build_object(
    'generatedAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'kpis', json_build_object(
      'networkCoveragePct',
        CASE WHEN v_total_routes > 0
             THEN ROUND(v_active_routes_n::numeric / v_total_routes * 1000) / 10
             ELSE 0 END,
      'activeRoutes',  v_active_routes_n,
      'totalCost',     ROUND(v_total_cost)::bigint,
      'totalLengthKm', ROUND(v_total_length_km * 10) / 10,
      'plannedLengthKm', ROUND(v_planned_length_km * 10) / 10,
      'costPerMile',
        CASE WHEN v_total_length_km > 0
             THEN ROUND(v_total_cost / (v_total_length_km * 0.621371))::bigint
             ELSE 0 END
    ),
    'trends', json_build_object(
      'milesYoyPct',
        CASE WHEN v_miles_last_year > 0
             THEN ROUND((v_miles_this_year - v_miles_last_year) / v_miles_last_year * 1000) / 10
             ELSE NULL END,
      'costYoyPct',
        CASE WHEN v_cost_last_year > 0
             THEN ROUND((v_cost_this_year - v_cost_last_year) / v_cost_last_year * 1000) / 10
             ELSE NULL END,
      'milesAddedYtd', ROUND(v_miles_this_year * 0.621371)::bigint
    ),
    'composition',   v_composition_json,
    'ownedVsLeased', json_build_object(
      'ownedPct',
        CASE WHEN v_total_length_km > 0
             THEN ROUND(v_owned_miles / v_total_length_km * 1000) / 10
             ELSE 0 END,
      'leasedPct',
        CASE WHEN v_total_length_km > 0
             THEN ROUND(v_leased_miles / v_total_length_km * 1000) / 10
             ELSE 0 END
    ),
    'vendorCosts',   v_vendor_costs_json,
    'costPerMile',   v_cost_per_mile_json,
    'facilities',    v_facilities_json,
    'activePlan',    v_active_plan_json,
    'plans',         v_plans_json
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION dashboard_summary() TO anon, authenticated, service_role;

-- ── RPC: dashboard_facets (migration 008) ───────────────────────────────────
CREATE OR REPLACE FUNCTION dashboard_facets()
RETURNS json
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_vendors_json    json;
  v_owners_json     json;
  v_groups_json     json;
  v_facilities_json json;
  v_no_vendor       int;
  v_no_owner        int;
  v_no_group        int;
  v_no_facility     int;
  v_result          json;
BEGIN
  SELECT COALESCE(json_agg(row_to_json(v) ORDER BY v.count DESC), '[]'::json)
  INTO v_vendors_json
  FROM (
    SELECT
      a.vendor_id::text AS id,
      COALESCE(ven.name, 'Vendor #' || a.vendor_id) AS name,
      COUNT(*)::int AS count
    FROM assets a
    LEFT JOIN vendors ven ON ven.id = a.vendor_id
    WHERE a.vendor_id IS NOT NULL
    GROUP BY a.vendor_id, ven.name
  ) v;

  SELECT COUNT(*)::int INTO v_no_vendor FROM assets WHERE vendor_id IS NULL;

  SELECT COALESCE(json_agg(row_to_json(o) ORDER BY o.count DESC), '[]'::json)
  INTO v_owners_json
  FROM (
    SELECT owner AS name, COUNT(*)::int AS count
    FROM (
      SELECT NULLIF(TRIM(COALESCE(
        a.properties->>'Owner',     a.properties->>'owner',
        a.properties->>'OwnerName', a.properties->>'owner_name',
        a.properties->>'Owned_by',  a.properties->>'owned_by',
        a.properties->>'OwnedBy',
        a.properties->>'maintainedby', a.properties->>'maintained_by',
        a.properties->>'Operator',  a.properties->>'operator',
        a.properties->>'Carrier',   a.properties->>'carrier',
        a.properties->>'Provider',  a.properties->>'provider',
        a.properties->>'Company',   a.properties->>'company',
        a.properties->>'Organization', a.properties->>'organization',
        ven.name
      )), '') AS owner
      FROM assets a
      LEFT JOIN vendors ven ON ven.id = a.vendor_id
    ) src
    WHERE owner IS NOT NULL
      AND owner NOT IN ('None','none','N/A','n/a','NULL','null','Unknown','unknown','TBD','tbd','-')
    GROUP BY owner
  ) o;

  SELECT COUNT(*)::int INTO v_no_owner
  FROM assets a
  LEFT JOIN vendors ven ON ven.id = a.vendor_id
  WHERE NULLIF(TRIM(COALESCE(
    a.properties->>'Owner',     a.properties->>'owner',
    a.properties->>'OwnerName', a.properties->>'owner_name',
    a.properties->>'Owned_by',  a.properties->>'owned_by',
    a.properties->>'OwnedBy',
    a.properties->>'maintainedby', a.properties->>'maintained_by',
    a.properties->>'Operator',  a.properties->>'operator',
    a.properties->>'Carrier',   a.properties->>'carrier',
    a.properties->>'Provider',  a.properties->>'provider',
    a.properties->>'Company',   a.properties->>'company',
    a.properties->>'Organization', a.properties->>'organization',
    ven.name
  )), '') IS NULL;

  SELECT COALESCE(json_agg(row_to_json(g) ORDER BY g.count DESC), '[]'::json)
  INTO v_groups_json
  FROM (
    SELECT
      COALESCE(a.properties->>'Group', a.properties->>'group') AS name,
      COUNT(*)::int AS count
    FROM assets a
    WHERE COALESCE(a.properties->>'Group', a.properties->>'group') IS NOT NULL
    GROUP BY COALESCE(a.properties->>'Group', a.properties->>'group')
  ) g;

  SELECT COUNT(*)::int INTO v_no_group
  FROM assets
  WHERE COALESCE(properties->>'Group', properties->>'group') IS NULL;

  SELECT COALESCE(json_agg(row_to_json(f) ORDER BY f.count DESC), '[]'::json)
  INTO v_facilities_json
  FROM (
    SELECT
      COALESCE(a.properties->>'Facility', a.properties->>'facility') AS name,
      COUNT(*)::int AS count
    FROM assets a
    WHERE COALESCE(a.properties->>'Facility', a.properties->>'facility') IS NOT NULL
    GROUP BY COALESCE(a.properties->>'Facility', a.properties->>'facility')
  ) f;

  SELECT COUNT(*)::int INTO v_no_facility
  FROM assets
  WHERE COALESCE(properties->>'Facility', properties->>'facility') IS NULL;

  v_result := json_build_object(
    'vendors',    v_vendors_json,
    'owners',     v_owners_json,
    'groups',     v_groups_json,
    'facilities', v_facilities_json,
    'noVendor',   v_no_vendor,
    'noOwner',    v_no_owner,
    'noGroup',    v_no_group,
    'noFacility', v_no_facility
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION dashboard_facets() TO anon, authenticated, service_role;

-- ============================================================================
-- DONE. After this runs successfully:
--   - All 4 tables exist (datasets, assets, vendors, plans) — empty.
--   - All indexes are in place.
--   - asset_gaps_v view exists.
--   - dashboard_summary() and dashboard_facets() RPCs are callable.
--
-- You may still need to manually verify in Supabase Dashboard:
--   - Storage > 'uploads' bucket exists with public access (file uploads need it).
--   - RLS policies if you had any custom ones.
-- ============================================================================

-- Module 7: Dashboard summary as a Postgres function + supporting indexes.
-- Replaces the previous "stream all 28k+ rows to Node, aggregate in JS"
-- approach with a single SQL call that does the entire aggregation in DB,
-- returning ~1 KB of JSON instead of multi-MB of asset rows.
--
-- Run in the Supabase SQL editor (or psql). Safe to re-run — uses CREATE OR
-- REPLACE for the function and IF NOT EXISTS for indexes.

-- 1. Indexes we lean on ------------------------------------------------------

-- Speed up the YoY trend filter (where created_at >= NOW() - INTERVAL '...').
CREATE INDEX IF NOT EXISTS idx_assets_created_at ON assets(created_at);

-- Speed up GROUP BY / WHERE on type — the composition and facility splits
-- both scan by type heavily.
CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(LOWER(type));

-- 2. Aggregation function ---------------------------------------------------
-- Returns the exact JSON shape the dashboard expects, so the API route can
-- swap from "fetch + aggregate in JS" to a single supabase.rpc() call.

CREATE OR REPLACE FUNCTION dashboard_summary()
RETURNS json
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  -- All variables use a v_ prefix so they can't collide with column names
  -- inside SELECT / SUM / etc. (Postgres errors with "ambiguous reference"
  -- when a PL/pgSQL var shadows a column in the same query.)
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

  -- Asset types we treat as "facilities" (matches the Node code).
  v_facility_types CONSTANT text[] := ARRAY['pops', 'wirecenters', 'colo', 'datacenters'];
BEGIN
  -- ── ROUTE KPIs ──────────────────────────────────────────────────────────
  -- A "route" is any asset whose type is non-null and NOT a facility type.
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE COALESCE(a.operational_status, 'online') = 'online')::int,
    COALESCE(SUM(a.length_km), 0),
    COALESCE(SUM(a.length_km) FILTER (WHERE LOWER(COALESCE(a.status, '')) = 'planned'), 0)
  INTO v_total_routes, v_active_routes_n, v_total_length_km, v_planned_length_km
  FROM assets a
  WHERE a.type IS NOT NULL
    AND LOWER(a.type) <> ALL (v_facility_types);

  -- ── ALL-ASSET TOTAL COST ────────────────────────────────────────────────
  SELECT COALESCE(SUM(a.total_cost), 0) INTO v_total_cost FROM assets a;

  -- ── YoY TRENDS (routes only) ────────────────────────────────────────────
  SELECT
    COALESCE(SUM(a.length_km)  FILTER (WHERE a.created_at >= NOW() - INTERVAL '1 year'), 0),
    COALESCE(SUM(a.length_km)  FILTER (WHERE a.created_at >= NOW() - INTERVAL '2 year'
                                         AND a.created_at <  NOW() - INTERVAL '1 year'), 0),
    COALESCE(SUM(a.total_cost) FILTER (WHERE a.created_at >= NOW() - INTERVAL '1 year'), 0),
    COALESCE(SUM(a.total_cost) FILTER (WHERE a.created_at >= NOW() - INTERVAL '2 year'
                                         AND a.created_at <  NOW() - INTERVAL '1 year'), 0)
  INTO v_miles_this_year, v_miles_last_year, v_cost_this_year, v_cost_last_year
  FROM assets a
  WHERE a.type IS NOT NULL
    AND LOWER(a.type) <> ALL (v_facility_types);

  -- ── COMPOSITION (route type → miles/count/share) ────────────────────────
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
    WHERE a.type IS NOT NULL
      AND LOWER(a.type) <> ALL (v_facility_types)
    GROUP BY LOWER(a.type)
  ) c;

  -- ── OWNED vs LEASED (derived from composition) ──────────────────────────
  SELECT
    COALESCE(SUM(a.length_km) FILTER (WHERE LOWER(COALESCE(a.type, '')) = 'owned'),  0),
    COALESCE(SUM(a.length_km) FILTER (WHERE LOWER(COALESCE(a.type, '')) = 'leased'), 0)
  INTO v_owned_miles, v_leased_miles
  FROM assets a;

  -- ── VENDOR COSTS (top 8 by cost) ────────────────────────────────────────
  SELECT COALESCE(json_agg(row_to_json(v) ORDER BY v.cost DESC), '[]'::json)
  INTO v_vendor_costs_json
  FROM (
    SELECT
      COALESCE(ven.name, 'Vendor #' || a.vendor_id) AS name,
      COALESCE(SUM(a.total_cost), 0)::numeric  AS cost,
      COALESCE(SUM(a.length_km),  0)::numeric  AS miles
    FROM assets a
    LEFT JOIN vendors ven ON ven.id = a.vendor_id
    WHERE a.vendor_id IS NOT NULL
    GROUP BY a.vendor_id, ven.name
    ORDER BY cost DESC
    LIMIT 8
  ) v;

  -- ── COST PER MILE (top 8 routes) ────────────────────────────────────────
  SELECT COALESCE(json_agg(row_to_json(cpm) ORDER BY cpm.cost_per_mile DESC), '[]'::json)
  INTO v_cost_per_mile_json
  FROM (
    SELECT
      a.id,
      COALESCE(a.name, 'Route #' || a.id) AS name,
      COALESCE(ven.name, '—')             AS vendor,
      ROUND((a.length_km * 0.621371)::numeric * 10) / 10 AS distance_mi,
      ROUND(COALESCE(a.total_cost, 0)::numeric) AS total_cost,
      CASE
        WHEN a.cost_per_km IS NOT NULL
          THEN ROUND((a.cost_per_km / 0.621371)::numeric)::int
        ELSE
          ROUND((COALESCE(a.total_cost, 0) / GREATEST(a.length_km * 0.621371, 0.01))::numeric)::int
      END AS cost_per_mile,
      COALESCE(a.status, 'active') AS status,
      a.utilization_pct
    FROM assets a
    LEFT JOIN vendors ven ON ven.id = a.vendor_id
    WHERE a.type IS NOT NULL
      AND LOWER(a.type) <> ALL (v_facility_types)
      AND a.length_km IS NOT NULL
      AND a.length_km > 0
      AND (a.total_cost IS NOT NULL OR a.cost_per_km IS NOT NULL)
    ORDER BY cost_per_mile DESC
    LIMIT 8
  ) cpm;

  -- ── FACILITIES (per facility type) ──────────────────────────────────────
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
    WHERE a.type IS NOT NULL
      AND LOWER(a.type) = ANY (v_facility_types)
    GROUP BY LOWER(a.type)
  ) f;

  -- ── PLANS ────────────────────────────────────────────────────────────────
  SELECT COALESCE(json_agg(row_to_json(p) ORDER BY p.target_year ASC), '[]'::json)
  INTO v_plans_json
  FROM plans p;

  -- Active plan: first plan with target_year >= current year, else earliest.
  SELECT row_to_json(p) INTO v_active_plan_json
  FROM (
    SELECT *
    FROM plans
    WHERE target_year >= EXTRACT(YEAR FROM NOW())::int
    ORDER BY target_year ASC
    LIMIT 1
  ) p;

  IF v_active_plan_json IS NULL THEN
    SELECT row_to_json(p) INTO v_active_plan_json
    FROM (SELECT * FROM plans ORDER BY target_year ASC LIMIT 1) p;
  END IF;

  -- ── ASSEMBLE FINAL JSON ──────────────────────────────────────────────────
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

-- 3. Grant execution to the anon + authenticated roles -----------------------
-- Supabase uses these roles for client + service-key access.
GRANT EXECUTE ON FUNCTION dashboard_summary() TO anon, authenticated, service_role;

COMMENT ON FUNCTION dashboard_summary IS
  'Returns the executive dashboard JSON payload. Aggregates the assets, vendors, and plans tables server-side so the API only ships ~1 KB instead of every row.';

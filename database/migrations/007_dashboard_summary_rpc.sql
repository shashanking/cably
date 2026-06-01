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
  -- Route-only aggregates
  total_routes        int;
  active_routes_n     int;
  total_length_km     numeric;
  planned_length_km   numeric;

  -- All-asset aggregates
  total_cost          numeric;

  -- YoY (route assets only)
  miles_this_year     numeric;
  miles_last_year     numeric;
  cost_this_year      numeric;
  cost_last_year      numeric;

  -- Composition derivatives
  owned_miles         numeric;
  leased_miles        numeric;

  -- Sub-aggregates assembled as JSON
  composition_json    json;
  vendor_costs_json   json;
  cost_per_mile_json  json;
  facilities_json     json;
  plans_json          json;
  active_plan_json    json;

  result              json;

  -- The set of asset types we treat as "facilities" (matches the Node code).
  facility_types CONSTANT text[] := ARRAY['pops', 'wirecenters', 'colo', 'datacenters'];
BEGIN
  -- ── ROUTE KPIs ──────────────────────────────────────────────────────────
  -- A "route" is any asset whose type is non-null and NOT a facility type.
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE COALESCE(operational_status, 'online') = 'online')::int,
    COALESCE(SUM(length_km), 0),
    COALESCE(SUM(length_km) FILTER (WHERE LOWER(COALESCE(status, '')) = 'planned'), 0)
  INTO total_routes, active_routes_n, total_length_km, planned_length_km
  FROM assets
  WHERE type IS NOT NULL
    AND LOWER(type) <> ALL (facility_types);

  -- ── ALL-ASSET TOTAL COST ────────────────────────────────────────────────
  SELECT COALESCE(SUM(total_cost), 0) INTO total_cost FROM assets;

  -- ── YoY TRENDS (routes only) ────────────────────────────────────────────
  SELECT
    COALESCE(SUM(length_km)  FILTER (WHERE created_at >= NOW() - INTERVAL '1 year'), 0),
    COALESCE(SUM(length_km)  FILTER (WHERE created_at >= NOW() - INTERVAL '2 year'
                                       AND created_at <  NOW() - INTERVAL '1 year'), 0),
    COALESCE(SUM(total_cost) FILTER (WHERE created_at >= NOW() - INTERVAL '1 year'), 0),
    COALESCE(SUM(total_cost) FILTER (WHERE created_at >= NOW() - INTERVAL '2 year'
                                       AND created_at <  NOW() - INTERVAL '1 year'), 0)
  INTO miles_this_year, miles_last_year, cost_this_year, cost_last_year
  FROM assets
  WHERE type IS NOT NULL
    AND LOWER(type) <> ALL (facility_types);

  -- ── COMPOSITION (route type → miles/count/share) ────────────────────────
  SELECT COALESCE(json_agg(row_to_json(c) ORDER BY c.miles DESC), '[]'::json)
  INTO composition_json
  FROM (
    SELECT
      LOWER(type) AS type,
      ROUND(SUM(COALESCE(length_km, 0))::numeric * 10) / 10 AS miles,
      COUNT(*)::int AS count,
      CASE WHEN total_length_km > 0
           THEN ROUND(SUM(COALESCE(length_km, 0))::numeric / total_length_km * 1000) / 10
           ELSE 0 END AS share
    FROM assets
    WHERE type IS NOT NULL
      AND LOWER(type) <> ALL (facility_types)
    GROUP BY LOWER(type)
  ) c;

  -- ── OWNED vs LEASED (derived from composition) ──────────────────────────
  SELECT
    COALESCE(SUM(length_km) FILTER (WHERE LOWER(COALESCE(type, '')) = 'owned'),  0),
    COALESCE(SUM(length_km) FILTER (WHERE LOWER(COALESCE(type, '')) = 'leased'), 0)
  INTO owned_miles, leased_miles
  FROM assets;

  -- ── VENDOR COSTS (top 8 by cost) ────────────────────────────────────────
  SELECT COALESCE(json_agg(row_to_json(v) ORDER BY v.cost DESC), '[]'::json)
  INTO vendor_costs_json
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
  INTO cost_per_mile_json
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
      AND LOWER(a.type) <> ALL (facility_types)
      AND a.length_km IS NOT NULL
      AND a.length_km > 0
      AND (a.total_cost IS NOT NULL OR a.cost_per_km IS NOT NULL)
    ORDER BY cost_per_mile DESC
    LIMIT 8
  ) cpm;

  -- ── FACILITIES (per facility type) ──────────────────────────────────────
  SELECT COALESCE(json_agg(row_to_json(f)), '[]'::json)
  INTO facilities_json
  FROM (
    SELECT
      LOWER(type) AS type,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE COALESCE(operational_status, 'online') = 'online')::int AS online,
      COUNT(*) FILTER (WHERE operational_status = 'offline')::int AS offline,
      COUNT(*) FILTER (WHERE operational_status IS NOT NULL
                         AND operational_status NOT IN ('online','offline'))::int AS warning,
      COALESCE(ROUND(AVG(capacity_pct))::int,    0) AS capacity,
      COALESCE(ROUND(AVG(utilization_pct))::int, 0) AS utilization
    FROM assets
    WHERE type IS NOT NULL
      AND LOWER(type) = ANY (facility_types)
    GROUP BY LOWER(type)
  ) f;

  -- ── PLANS ────────────────────────────────────────────────────────────────
  SELECT COALESCE(json_agg(row_to_json(p) ORDER BY p.target_year ASC), '[]'::json)
  INTO plans_json
  FROM plans p;

  -- Active plan: first plan with target_year >= current year, else earliest.
  SELECT row_to_json(p) INTO active_plan_json
  FROM (
    SELECT *
    FROM plans
    WHERE target_year >= EXTRACT(YEAR FROM NOW())::int
    ORDER BY target_year ASC
    LIMIT 1
  ) p;

  IF active_plan_json IS NULL THEN
    SELECT row_to_json(p) INTO active_plan_json
    FROM (SELECT * FROM plans ORDER BY target_year ASC LIMIT 1) p;
  END IF;

  -- ── ASSEMBLE FINAL JSON ──────────────────────────────────────────────────
  result := json_build_object(
    'generatedAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'kpis', json_build_object(
      'networkCoveragePct',
        CASE WHEN total_routes > 0
             THEN ROUND(active_routes_n::numeric / total_routes * 1000) / 10
             ELSE 0 END,
      'activeRoutes',  active_routes_n,
      'totalCost',     ROUND(total_cost)::bigint,
      'totalLengthKm', ROUND(total_length_km * 10) / 10,
      'plannedLengthKm', ROUND(planned_length_km * 10) / 10,
      'costPerMile',
        CASE WHEN total_length_km > 0
             THEN ROUND(total_cost / (total_length_km * 0.621371))::bigint
             ELSE 0 END
    ),
    'trends', json_build_object(
      'milesYoyPct',
        CASE WHEN miles_last_year > 0
             THEN ROUND((miles_this_year - miles_last_year) / miles_last_year * 1000) / 10
             ELSE NULL END,
      'costYoyPct',
        CASE WHEN cost_last_year > 0
             THEN ROUND((cost_this_year - cost_last_year) / cost_last_year * 1000) / 10
             ELSE NULL END,
      'milesAddedYtd', ROUND(miles_this_year * 0.621371)::bigint
    ),
    'composition',   composition_json,
    'ownedVsLeased', json_build_object(
      'ownedPct',
        CASE WHEN total_length_km > 0
             THEN ROUND(owned_miles / total_length_km * 1000) / 10
             ELSE 0 END,
      'leasedPct',
        CASE WHEN total_length_km > 0
             THEN ROUND(leased_miles / total_length_km * 1000) / 10
             ELSE 0 END
    ),
    'vendorCosts',   vendor_costs_json,
    'costPerMile',   cost_per_mile_json,
    'facilities',    facilities_json,
    'activePlan',    active_plan_json,
    'plans',         plans_json
  );

  RETURN result;
END;
$$;

-- 3. Grant execution to the anon + authenticated roles -----------------------
-- Supabase uses these roles for client + service-key access.
GRANT EXECUTE ON FUNCTION dashboard_summary() TO anon, authenticated, service_role;

COMMENT ON FUNCTION dashboard_summary IS
  'Returns the executive dashboard JSON payload. Aggregates the assets, vendors, and plans tables server-side so the API only ships ~1 KB instead of every row.';

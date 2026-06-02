-- Module 8: Dashboard facets as a Postgres function.
-- Replaces the dashboard's client-side facets useMemo (which required pulling
-- every asset row to the browser) with a single SQL call.
--
-- Run in the Supabase SQL editor (or psql). Safe to re-run.

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
  -- ── VENDORS — count per vendor_id ──────────────────────────────────────
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

  -- ── OWNERS — explicit owner-like keys in properties, else vendor name ──
  -- Mirrors lib/styling.ts getOwnerValue but using a fixed key list (covers
  -- the common cases without scanning every JSONB key per row).
  SELECT COALESCE(json_agg(row_to_json(o) ORDER BY o.count DESC), '[]'::json)
  INTO v_owners_json
  FROM (
    SELECT owner AS name, COUNT(*)::int AS count
    FROM (
      SELECT NULLIF(TRIM(COALESCE(
        a.properties->>'Owner',
        a.properties->>'owner',
        a.properties->>'OwnerName',
        a.properties->>'owner_name',
        a.properties->>'Owned_by',
        a.properties->>'owned_by',
        a.properties->>'OwnedBy',
        a.properties->>'maintainedby',
        a.properties->>'maintained_by',
        a.properties->>'Operator',
        a.properties->>'operator',
        a.properties->>'Carrier',
        a.properties->>'carrier',
        a.properties->>'Provider',
        a.properties->>'provider',
        a.properties->>'Company',
        a.properties->>'company',
        a.properties->>'Organization',
        a.properties->>'organization',
        ven.name
      )), '') AS owner
      FROM assets a
      LEFT JOIN vendors ven ON ven.id = a.vendor_id
    ) src
    WHERE owner IS NOT NULL
      AND owner NOT IN ('None', 'none', 'N/A', 'n/a', 'NULL', 'null', 'Unknown', 'unknown', 'TBD', 'tbd', '-')
    GROUP BY owner
  ) o;

  SELECT COUNT(*)::int INTO v_no_owner
  FROM assets a
  LEFT JOIN vendors ven ON ven.id = a.vendor_id
  WHERE NULLIF(TRIM(COALESCE(
    a.properties->>'Owner',
    a.properties->>'owner',
    a.properties->>'OwnerName',
    a.properties->>'owner_name',
    a.properties->>'Owned_by',
    a.properties->>'owned_by',
    a.properties->>'OwnedBy',
    a.properties->>'maintainedby',
    a.properties->>'maintained_by',
    a.properties->>'Operator',
    a.properties->>'operator',
    a.properties->>'Carrier',
    a.properties->>'carrier',
    a.properties->>'Provider',
    a.properties->>'provider',
    a.properties->>'Company',
    a.properties->>'company',
    a.properties->>'Organization',
    a.properties->>'organization',
    ven.name
  )), '') IS NULL;

  -- ── GROUPS — properties.Group or properties.group ──────────────────────
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

  -- ── FACILITIES — properties.Facility or properties.facility ────────────
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

COMMENT ON FUNCTION dashboard_facets IS
  'Returns dashboard facet counts (vendors, owners, groups, facilities) computed server-side so the dashboard does not need to pull every asset row.';

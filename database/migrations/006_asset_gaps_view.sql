-- Module 7: Support view for the Fill Data Gaps endpoint.
-- A row "has gaps" if any required attribute is NULL. Expressing it as a
-- boolean column lets us combine it with other filters using simple .eq()
-- calls (AND-ing) instead of chained .or() calls (which override in PostgREST).

CREATE OR REPLACE VIEW asset_gaps_v AS
SELECT
  id, dataset_id, type, name, status, vendor_id,
  cost_per_km, total_cost, length_km,
  operational_status, utilization_pct, capacity_pct,
  region, installed_year, properties,
  (
    vendor_id          IS NULL
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

-- Grant the same RLS posture as assets (anon read). Supabase views inherit
-- policies from the base table when created with security invoker.
ALTER VIEW asset_gaps_v SET (security_invoker = on);

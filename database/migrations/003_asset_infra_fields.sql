-- Module 3: Infrastructure management fields on assets
ALTER TABLE assets ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';
ALTER TABLE assets ADD COLUMN IF NOT EXISTS vendor_id INTEGER;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS cost_per_km NUMERIC(12,2);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS total_cost NUMERIC(14,2);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS length_km NUMERIC(10,3);

CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
CREATE INDEX IF NOT EXISTS idx_assets_vendor ON assets(vendor_id);
CREATE INDEX IF NOT EXISTS idx_assets_name ON assets(name);

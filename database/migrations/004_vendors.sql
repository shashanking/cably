-- Module 5: Vendor management
CREATE TABLE IF NOT EXISTS vendors (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  contact_email TEXT,
  contact_phone TEXT,
  address TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Link assets to vendors
ALTER TABLE assets ADD CONSTRAINT fk_assets_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL;

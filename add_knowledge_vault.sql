
-- Knowledge Vault Tables

-- 1. Vault Documents (Vision, Mission, etc.)
CREATE TABLE IF NOT EXISTS vault_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  version INTEGER DEFAULT 1,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. R&D Library
CREATE TABLE IF NOT EXISTS rd_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT DEFAULT 'Draft',
  tags TEXT[] DEFAULT '{}',
  attachments TEXT[] DEFAULT '{}',
  photos TEXT[] DEFAULT '{}',
  videos TEXT[] DEFAULT '{}',
  voice_notes TEXT[] DEFAULT '{}',
  ai_summary TEXT,
  ai_recommendations TEXT[] DEFAULT '{}',
  version INTEGER DEFAULT 1,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Founder Timeline
CREATE TABLE IF NOT EXISTS timeline_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'Future',
  sort_order INTEGER NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Phase Unlock Engine
CREATE TABLE IF NOT EXISTS phases (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'Locked',
  conditions TEXT[] DEFAULT '{}',
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Decision Records (Founder Memory)
CREATE TABLE IF NOT EXISTS decision_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  context TEXT,
  why TEXT,
  alternatives TEXT[] DEFAULT '{}',
  risks TEXT[] DEFAULT '{}',
  expected_outcome TEXT,
  actual_outcome TEXT,
  lessons_learned TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS (even though user said No Auth, it's good practice for Supabase migration)
ALTER TABLE vault_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE rd_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeline_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_records ENABLE ROW LEVEL SECURITY;

-- Allow public access for "Single Founder Mode" if needed, or restricted to auth user
CREATE POLICY "Public Read Access" ON vault_documents FOR SELECT USING (true);
CREATE POLICY "Public Read Access" ON rd_library FOR SELECT USING (true);
CREATE POLICY "Public Read Access" ON timeline_milestones FOR SELECT USING (true);
CREATE POLICY "Public Read Access" ON phases FOR SELECT USING (true);
CREATE POLICY "Public Read Access" ON decision_records FOR SELECT USING (true);

-- Insert Initial Timeline Milestones
INSERT INTO timeline_milestones (title, description, status, sort_order) VALUES
('Business Idea', 'Initial concept for ICECRAFT', 'Completed', 1),
('Research', 'Deep market and technical R&D', 'Completed', 2),
('Supplier Discovery', 'Identifying high-quality suppliers', 'Completed', 3),
('Wine Shop Survey', 'Field research on existing retail points', 'Current', 4),
('Prototype', 'First physical product prototype', 'Future', 5),
('First Order', 'Initial commercial sale', 'Future', 6),
('First Repeat Order', 'Verification of product market fit', 'Future', 7),
('Monthly Break-even', 'Financial stability milestone', 'Future', 8),
('VyaparSethu Funding', 'Seed stage investment', 'Future', 9),
('Expansion', 'Scale beyond initial market', 'Future', 10),
('Hotels', 'B2B luxury hotel partnership launch', 'Future', 11),
('White Label', 'Manufacturing for external brands', 'Future', 12),
('Premium Ice', 'Specialized clear ice products', 'Future', 13),
('Luxury Diamond Ice', 'The ICECRAFT Diamond signature launch', 'Future', 14),
('Export', 'International shipping expansion', 'Future', 15),
('Manufacturing Plant', 'Own industrial facility', 'Future', 16),
('Multiple Cities', 'National footprint', 'Future', 17),
('International Expansion', 'Global brand presence', 'Future', 18)
ON CONFLICT DO NOTHING;

-- Insert Initial Phases
INSERT INTO phases (id, title, status, description, conditions) VALUES
(0, 'Phase 0', 'Unlocked', 'Initial Foundation', '{}'),
(1, 'Phase 1', 'Locked', 'Market Entry', '{"Survey Target Achieved", "Supplier Approved", "Budget Approved"}'),
(2, 'Phase 2', 'Locked', 'Operational Scale', '{"Monthly Sales Target Achieved", "Repeat Order Target Achieved", "Positive Cash Flow"}')
ON CONFLICT DO NOTHING;

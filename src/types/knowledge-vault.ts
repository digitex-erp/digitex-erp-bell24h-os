
export type KnowledgeCategory = 
  | 'Vision' 
  | 'Mission' 
  | 'Purpose' 
  | 'Principles' 
  | 'Goals' 
  | 'Philosophy' 
  | 'Strategy' 
  | 'Financial';

export interface VaultDocument {
  id: string;
  title: string;
  category: KnowledgeCategory;
  content: string;
  lastUpdated: string;
  version: number;
  tags: string[];
}

export type RdCategory = 
  | 'Ice Cup'
  | 'Packaging'
  | 'Cold Chain'
  | 'Manufacturing'
  | 'Supplier'
  | 'White Label'
  | 'Premium Diamond Ice'
  | 'Hotel'
  | 'Luxury Ice'
  | 'Brand'
  | 'Financial Models'
  | 'Logistics'
  | 'Customer'
  | 'Government & FSSAI'
  | 'Future Innovation';

export interface RdDocument {
  id: string;
  title: string;
  category: RdCategory;
  content: string;
  status: 'Draft' | 'Final' | 'Archived';
  tags: string[];
  attachments: string[];
  photos: string[];
  videos: string[];
  voiceNotes: string[];
  aiSummary: string;
  aiRecommendations: string[];
  lastUpdated: string;
  version: number;
}

export interface TimelineMilestone {
  id: string;
  title: string;
  description: string;
  status: 'Completed' | 'Current' | 'Future';
  order: number;
  completedAt?: string;
}

export interface Phase {
  id: number;
  title: string;
  status: 'Unlocked' | 'Locked';
  conditions: string[];
  description: string;
}

export interface DecisionRecord {
  id: string;
  title: string;
  context: string;
  why: string;
  alternatives: string[];
  risks: string[];
  expectedOutcome: string;
  actualOutcome?: string;
  lessonsLearned?: string;
  createdAt: string;
}

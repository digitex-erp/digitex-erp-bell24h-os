import { createClient } from '@supabase/supabase-js'

// Helper to validate URL
const isValidUrl = (url: string) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

// Try multiple common environment variable names for Supabase
const rawUrl = 
  import.meta.env.VITE_SUPABASE_URL || 
  import.meta.env.SUPABASE_URL || 
  'https://placeholder.supabase.co';

const supabaseUrl = isValidUrl(rawUrl) ? rawUrl : 'https://placeholder.supabase.co';

const supabaseAnonKey = 
  import.meta.env.VITE_SUPABASE_KEY || 
  import.meta.env.VITE_SUPABASE_ANON_KEY || 
  import.meta.env.SUPABASE_KEY || 
  import.meta.env.SUPABASE_ANON_KEY || 
  'placeholder-anon-key';

export const SUPABASE_CONFIGURED = 
  !!supabaseUrl && 
  supabaseUrl !== 'https://placeholder.supabase.co' && 
  !!supabaseAnonKey && 
  supabaseAnonKey !== 'placeholder-anon-key';

console.log("Supabase URL detected:", supabaseUrl);
if (!SUPABASE_CONFIGURED) {
  console.warn("Supabase configuration missing or using placeholders.");
} else {
  console.log("Supabase client initialized with provided credentials.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

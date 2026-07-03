import { createClient } from '@supabase/supabase-js'

// Helper to validate URL and ensure it's HTTP/HTTPS
const isValidSupabaseUrl = (url: any) => {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

// Helper to extract project ID from a postgres URL if accidentally provided
const tryRecoverUrl = (url: string) => {
  if (url.includes('db.') && url.includes('.supabase.co')) {
    const match = url.match(/db\.([^.]+)\.supabase\.co/);
    if (match && match[1]) {
      return `https://${match[1]}.supabase.co`;
    }
  }
  return url;
};

const PLACEHOLDER_URL = 'https://placeholder.supabase.co';
const PLACEHOLDER_KEY = 'placeholder-anon-key';

// Try multiple common environment variable names for Supabase
// Explicitly check for strings and avoid placeholders if they are just placeholders
const getEnv = (key: string) => {
  const val = (import.meta.env as any)[key];
  return (val && typeof val === 'string' && val.length > 0) ? val : null;
};

let rawUrl = getEnv('VITE_SUPABASE_URL') || getEnv('SUPABASE_URL') || '';
const rawKey = getEnv('VITE_SUPABASE_KEY') || getEnv('VITE_SUPABASE_ANON_KEY') || getEnv('SUPABASE_KEY') || getEnv('SUPABASE_ANON_KEY') || '';

// Attempt recovery if it looks like a DB string
if (rawUrl.startsWith('postgresql://') || rawUrl.includes(':5432')) {
  console.warn("[Runtime] Detected Database URL instead of API URL. Attempting recovery...");
  rawUrl = tryRecoverUrl(rawUrl);
}

export const supabaseUrl = isValidSupabaseUrl(rawUrl) ? rawUrl : PLACEHOLDER_URL;
export const supabaseAnonKey = rawKey || PLACEHOLDER_KEY;

export const SUPABASE_CONFIGURED = 
  isValidSupabaseUrl(rawUrl) && 
  !!rawKey && 
  rawKey !== PLACEHOLDER_KEY;

if (!SUPABASE_CONFIGURED) {
  console.warn("Supabase is NOT configured or has an invalid URL. Using placeholders to prevent crash.");
}

console.log("[Runtime] Supabase initialization: Starting", { 
  url: supabaseUrl,
  isValid: isValidSupabaseUrl(supabaseUrl),
  isRecovered: rawUrl !== (getEnv('VITE_SUPABASE_URL') || getEnv('SUPABASE_URL'))
});

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
console.log("[Runtime] Supabase initialization: Client created");

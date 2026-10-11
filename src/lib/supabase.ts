import { createClient } from '@supabase/supabase-js'

// Helper to validate URL and ensure it's HTTP/HTTPS
const isValidSupabaseUrl = (url: any) => {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    const valid = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    if (!valid && url !== PLACEHOLDER_URL) console.warn("[Runtime] Supabase URL has invalid protocol:", parsed.protocol);
    return valid;
  } catch {
    return false;
  }
};

// Helper to validate that the key looks like a Supabase JWT
const isValidSupabaseKey = (key: any) => {
  if (!key || typeof key !== 'string') return false;
  // Supabase keys are JWTs, which usually have 3 parts separated by dots
  const parts = key.split('.');
  if (parts.length !== 3 && key !== PLACEHOLDER_KEY) {
     console.warn("[Runtime] Supabase Key does not appear to be a valid JWT. Check your VITE_SUPABASE_KEY.");
     return false;
  }
  return true;
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
const getEnv = (key: string) => {
  const val = (import.meta.env as any)[key];
  return (val && typeof val === 'string' && val.length > 0) ? val : null;
};

// Helper to extract project ID from a supabase URL
const extractProjectId = (url: string) => {
  if (!url || url === PLACEHOLDER_URL) return 'none';
  try {
    const parsed = new URL(url);
    const hostParts = parsed.hostname.split('.');
    if (hostParts.length >= 3 && hostParts[1] === 'supabase' && hostParts[2] === 'co') {
      return hostParts[0];
    }
    return 'custom/unknown';
  } catch {
    return 'invalid';
  }
};

let rawUrl = getEnv('VITE_SUPABASE_URL') || getEnv('SUPABASE_URL') || '';
const rawKey = 
  getEnv('VITE_SUPABASE_KEY') || 
  getEnv('VITE_SUPABASE_ANON_KEY') || 
  getEnv('VITE_SUPABASE_ANO') || // Specifically handle the user's secret typo found in logs
  getEnv('SUPABASE_KEY') || 
  getEnv('SUPABASE_ANON_KEY') || 
  '';

let finalUrl = rawUrl;
// Attempt recovery if it looks like a DB string (Development only)
if (import.meta.env.DEV && (rawUrl.startsWith('postgresql://') || rawUrl.includes(':5432'))) {
  finalUrl = tryRecoverUrl(rawUrl);
}

export const supabaseUrl = isValidSupabaseUrl(finalUrl) ? finalUrl : PLACEHOLDER_URL;
export const supabaseAnonKey = rawKey || PLACEHOLDER_KEY;
export const supabaseProjectId = extractProjectId(supabaseUrl);

export const SUPABASE_CONFIGURED = 
  isValidSupabaseUrl(finalUrl) && 
  isValidSupabaseKey(rawKey) &&
  rawKey !== PLACEHOLDER_KEY;

if (!SUPABASE_CONFIGURED) {
  console.warn("Supabase is NOT configured or has an invalid URL. Using placeholders to prevent crash.");
}

console.log("[Runtime] Supabase Client Initialized:", {
  projectId: supabaseProjectId,
  configured: SUPABASE_CONFIGURED,
  isRecovered: finalUrl !== rawUrl
});

// Captured before createClient() below constructs the client and triggers
// _initialize() -> _getSessionFromURL(), which (for the default implicit flow)
// clears window.location.hash as soon as it extracts the session. This is the
// only point in the app guaranteed to see the URL exactly as the email link
// delivered it. Presence only (parameter NAMES) — never the token values, never
// persisted to localStorage, never logged.
const initialUrlPasswordRecovery = (() => {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.substring(1));
  return params.get('type') === 'recovery' || hash.get('type') === 'recovery' || params.has('code');
})();

export const isInitialUrlPasswordRecovery = initialUrlPasswordRecovery;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key'

// This is a placeholder client.
// In a real application, ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set.
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

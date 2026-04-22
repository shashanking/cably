import { createClient } from '@supabase/supabase-js'

// Use placeholder fallbacks so the module can be imported during `next build`
// (Vercel evaluates routes at build time). Real requests at runtime will fail
// cleanly with a Supabase network error if env vars aren't configured.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'placeholder-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
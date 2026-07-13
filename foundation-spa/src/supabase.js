import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL || 'https://invalid.example.com';
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || 'invalid-anon-key';

if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  console.error('[RSO] Missing Supabase config. Copy .env.example to .env.local and fill in your values.');
}

export const supabase = createClient(
  url,
  key,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);

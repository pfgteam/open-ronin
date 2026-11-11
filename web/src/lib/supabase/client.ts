// Browser-side Supabase client.
// Use in 'use client' components and React hooks.
// For server components / route handlers / middleware, use the server.ts client.

import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
	return createBrowserClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL!,
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
	);
}

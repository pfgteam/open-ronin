// Server-side Supabase client for server components, route handlers, and server actions.
// Reads + writes the session cookie via next/headers.

import { cache } from 'react';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { Profile } from '@/stores/auth';

interface CookieToSet {
	name: string;
	value: string;
	options?: CookieOptions;
}

export async function createClient() {
	const cookieStore = await cookies();

	return createServerClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL!,
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
		{
			cookies: {
				getAll() {
					return cookieStore.getAll();
				},
				setAll(cookiesToSet: CookieToSet[]) {
					try {
						cookiesToSet.forEach(({ name, value, options }) =>
							cookieStore.set(name, value, options),
						);
					} catch {
						// `setAll` was called from a Server Component. Server Components can't
						// write cookies; safe to ignore if middleware is refreshing sessions.
					}
				},
			},
		},
	);
}

// ---------------------------------------------------------------------------
// Request-memoized viewer lookups (React cache — one RSC render scope).
//
// However many callers need the viewer in a single request (AppLayout,
// loadLayout, pages), the Auth round-trip and the profiles SELECT each run at
// most ONCE. Prefer these over calling supabase.auth.getUser() directly in
// server components.
// ---------------------------------------------------------------------------

export const getAuthUser = cache(async (): Promise<User | null> => {
	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	return user;
});

export const getAuthProfile = cache(async (): Promise<Profile | null> => {
	const user = await getAuthUser();
	if (!user) return null;
	const supabase = await createClient();
	const { data } = await supabase
		.from('profiles')
		.select('*')
		.eq('id', user.id)
		.maybeSingle();
	return (data as Profile | null) ?? null;
});

// Service-role client for trusted server operations (sync jobs, audit log inserts).
// NEVER expose this to the browser.
import { createClient as createServiceClient } from '@supabase/supabase-js';

export function createServiceRoleClient() {
	return createServiceClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL!,
		process.env.SUPABASE_SERVICE_ROLE_KEY!,
		{
			auth: {
				autoRefreshToken: false,
				persistSession: false,
			},
		},
	);
}

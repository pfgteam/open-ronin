'use client';

// Seeds the client auth store with the server-fetched user/profile passed by
// AppLayout, so TopNav/SideNav render with the viewer already known — no
// client-side getUser() + profiles SELECT on mount.
//
// The seed runs during the FIRST client render (guarded, idempotent) rather
// than in an effect: this component is AppLayout's first child, so the store
// is populated before TopNav/SideNav read it — no "Loading…" flash and their
// init() fallback becomes a no-op. The auth-change listener (login/logout/
// token refresh) is attached once, in an effect.

import { useEffect, useRef } from 'react';
import type { User } from '@supabase/supabase-js';
import { useAuthStore, type Profile } from '@/stores/auth';
import type { ModuleKey } from '@/lib/permissions/constants';

interface Props {
	user: User | null;
	profile: Profile | null;
	modules?: ModuleKey[] | null;
}

export default function AuthHydrator({ user, profile, modules = null }: Props) {
	const seeded = useRef(false);
	if (typeof window !== 'undefined' && !seeded.current) {
		seeded.current = true;
		useAuthStore.getState().hydrate(user, profile, modules);
	}

	useEffect(() => {
		useAuthStore.getState().listen();
	}, []);

	return null;
}

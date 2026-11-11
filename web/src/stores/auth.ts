'use client';

// Auth store — thin client-side wrapper over Supabase Auth.
// Tracks the auth.users row and the public.profiles row in one place
// so client components can read `user` / `profile` without prop drilling.
//
// The store is normally seeded by <AuthHydrator> (rendered by AppLayout) with
// the server-fetched user/profile — zero client-side auth round-trips on page
// load. init() remains as a fallback for trees without AppLayout and is
// single-flight: concurrent calls (TopNav + SideNav mounting together) share
// one getUser() + one profiles SELECT instead of firing twice.
//
// Server components should use getAuthUser()/getAuthProfile() from
// @/lib/supabase/server — don't import this store from server components
// (it's marked 'use client').

import { create } from 'zustand';
import type { User, AuthChangeEvent, Session } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import {
	MODULE_KEYS,
	isElevatedRole,
	legacyDefaultModules,
	type ModuleKey,
} from '@/lib/permissions/constants';

export interface Profile {
	id: string;
	email: string;
	first_name: string | null;
	last_name: string | null;
	title: string | null;
	department: string | null;
	/** Uploaded avatar (0054 avatars bucket, written by team/[id]/avatarActions).
	 *  This is the authoritative photo — avatar_url is the legacy/OAuth one.
	 *  Read them as `photo_url ?? avatar_url`, the order every other surface
	 *  uses (team directory, profile page, org chart). */
	photo_url: string | null;
	avatar_url: string | null;
	in_office: boolean;
	airtable_user_id: string | null;
	role: 'exec' | 'admin' | 'manager' | 'contributor';
	is_active: boolean;
	created_at: string;
	updated_at: string;
}

interface AuthState {
	user: User | null;
	profile: Profile | null;
	/** Accessible module keys from the role_permissions matrix (0024).
	 *  null = not resolved yet → navConfig falls back to legacy role rules. */
	modules: ModuleKey[] | null;
	error: string | null;
	isLoading: boolean;
	initialized: boolean;

	init: () => Promise<void>;
	hydrate: (user: User | null, profile: Profile | null, modules?: ModuleKey[] | null) => void;
	listen: () => void;
	login: (email: string, password: string) => Promise<void>;
	signup: (
		email: string,
		password: string,
		firstName?: string,
		lastName?: string,
	) => Promise<boolean>;
	signInWithGoogle: (hd?: string) => Promise<void>;
	resetPassword: (email: string) => Promise<void>;
	logout: () => Promise<void>;
	refreshProfile: () => Promise<void>;
	clearError: () => void;
}

async function fetchProfile(userId: string): Promise<Profile | null> {
	const supabase = createClient();
	const { data, error } = await supabase
		.from('profiles')
		.select('*')
		.eq('id', userId)
		.single();
	if (error) {
		// Don't throw — profile may not be created yet right after signup.
		return null;
	}
	return data as Profile;
}

// Resolve the viewer's accessible modules from the matrix (client-side
// fallback for trees without AppLayout). null = query failed (e.g. migration
// 0024 not applied yet) → callers fall back to legacy role rules.
async function fetchModules(profile: Profile | null): Promise<ModuleKey[] | null> {
	if (!profile || profile.is_active === false) return [];
	if (isElevatedRole(profile.role)) return [...MODULE_KEYS];
	const supabase = createClient();
	const { data, error } = await supabase
		.from('role_permissions')
		.select('module_key')
		.eq('role', profile.role)
		.eq('allowed', true);
	if (error) return legacyDefaultModules(profile.role);
	return (data ?? [])
		.map((r) => r.module_key as ModuleKey)
		.filter((k) => (MODULE_KEYS as readonly string[]).includes(k));
}

// Module-level guards shared by init()/hydrate()/listen().
let initInFlight: Promise<void> | null = null;
let listenerAttached = false;

export const useAuthStore = create<AuthState>((set, get) => ({
	user: null,
	profile: null,
	modules: null,
	error: null,
	isLoading: false,
	initialized: false,

	init: async () => {
		if (get().initialized) {
			get().listen();
			return;
		}
		initInFlight ??= (async () => {
			const supabase = createClient();
			const {
				data: { user },
			} = await supabase.auth.getUser();
			const profile = user ? await fetchProfile(user.id) : null;
			const modules = user ? await fetchModules(profile) : null;
			set({ user, profile, modules, initialized: true });
			get().listen();
		})().finally(() => {
			initInFlight = null;
		});
		await initInFlight;
	},

	// Seed state from server-fetched values (AppLayout → AuthHydrator).
	// Safe to call during render: it's a plain store write, no fetches.
	hydrate: (user, profile, modules = null) => {
		if (get().initialized) return;
		set({ user, profile, modules, initialized: true });
	},

	// Attach the Supabase auth listener exactly once (login/logout/refresh).
	listen: () => {
		if (listenerAttached) return;
		listenerAttached = true;
		const supabase = createClient();
		supabase.auth.onAuthStateChange(async (_event: AuthChangeEvent, session: Session | null) => {
			const nextUser = session?.user ?? null;
			const { user: prevUser, profile: prevProfile } = get();
			// Same signed-in user with a profile already loaded (INITIAL_SESSION
			// replay, hourly TOKEN_REFRESHED ticks): update the user object only —
			// don't refetch the profiles row on every refresh.
			if (nextUser && prevUser && nextUser.id === prevUser.id && prevProfile) {
				set({ user: nextUser });
				return;
			}
			const nextProfile = nextUser ? await fetchProfile(nextUser.id) : null;
			const nextModules = nextUser ? await fetchModules(nextProfile) : null;
			set({ user: nextUser, profile: nextProfile, modules: nextModules });
		});
	},

	login: async (email, password) => {
		set({ isLoading: true, error: null });
		try {
			const supabase = createClient();
			const { error } = await supabase.auth.signInWithPassword({ email, password });
			if (error) throw error;
			set({ isLoading: false });
		} catch (err) {
			set({
				error: err instanceof Error ? err.message : 'Login failed',
				isLoading: false,
			});
			throw err;
		}
	},

	signup: async (email, password, firstName, lastName) => {
		set({ isLoading: true, error: null });
		try {
			const supabase = createClient();
			const { data, error } = await supabase.auth.signUp({
				email,
				password,
				options: {
					data: {
						first_name: firstName ?? '',
						last_name: lastName ?? '',
					},
					emailRedirectTo:
						typeof window !== 'undefined'
							? `${window.location.origin}/auth/callback`
							: undefined,
				},
			});
			if (error) throw error;
			set({ isLoading: false });
			// True when Supabase signed the user straight in (email confirmation
			// off); false when a confirmation email is pending.
			return !!data.session;
		} catch (err) {
			set({
				error: err instanceof Error ? err.message : 'Signup failed',
				isLoading: false,
			});
			throw err;
		}
	},

	signInWithGoogle: async (hd) => {
		set({ isLoading: true, error: null });
		try {
			const supabase = createClient();
			const { error } = await supabase.auth.signInWithOAuth({
				provider: 'google',
				options: {
					redirectTo: `${window.location.origin}/auth/callback`,
					// `hd` hints Google to pre-select the org's Workspace (first
					// allowed sign-in domain). Others get the normal chooser.
					...(hd ? { queryParams: { hd } } : {}),
				},
			});
			if (error) throw error;
			// OAuth redirects away; loading state cleared by destination
		} catch (err) {
			set({
				error: err instanceof Error ? err.message : 'Google sign-in failed',
				isLoading: false,
			});
			throw err;
		}
	},

	resetPassword: async (email) => {
		set({ isLoading: true, error: null });
		try {
			const supabase = createClient();
			const { error } = await supabase.auth.resetPasswordForEmail(email, {
				redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
			});
			if (error) throw error;
			set({ isLoading: false });
		} catch (err) {
			set({
				error: err instanceof Error ? err.message : 'Reset failed',
				isLoading: false,
			});
			throw err;
		}
	},

	logout: async () => {
		const supabase = createClient();
		await supabase.auth.signOut();
		set({ user: null, profile: null, modules: null });
		if (typeof window !== 'undefined') {
			window.location.href = '/auth/login';
		}
	},

	refreshProfile: async () => {
		const { user } = get();
		if (!user) return;
		const profile = await fetchProfile(user.id);
		const modules = await fetchModules(profile);
		set({ profile, modules });
	},

	clearError: () => set({ error: null }),
}));

'use client';

// Runtime nav facts the profile alone cannot answer: the viewer's own
// capabilities (user_capabilities, 0055). Growth › Acquisitions is "only
// available to direct permission access users" (sheet row 60), so the row
// shows only to holders of the acquisitions capability. RLS lets a user
// read their own rows; any error = no capabilities (deny, like the server
// helper in lib/permissions/capabilities.ts).

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { NavFlags } from './navConfig';

const EMPTY: NavFlags = {};

export function useNavFlags(userId: string | undefined): NavFlags {
	const [flags, setFlags] = useState<NavFlags>(EMPTY);
	useEffect(() => {
		if (!userId) return;
		let cancelled = false;
		void createClient()
			.from('user_capabilities')
			.select('capability')
			.eq('user_id', userId)
			.then(({ data, error }) => {
				if (cancelled) return;
				setFlags({ capabilities: error ? [] : (data ?? []).map((r) => String(r.capability)) });
			});
		return () => {
			cancelled = true;
		};
	}, [userId]);
	return userId ? flags : EMPTY;
}

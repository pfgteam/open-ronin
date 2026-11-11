'use client';

// Per-button pending state for the Calls and Closing tabs (spec 2026-10-20
// §5, §6). One shared useTransition put every button into its spinner at
// once; here each action runs under a key and only its button spins. Keys are
// a set, so overlapping actions don't release each other's spinner.

import { useCallback, useState } from 'react';
import { withKey, withoutKey } from '@/lib/ui/pendingKeys';

export function usePendingKey(): { isPending: (key: string) => boolean; run: (key: string, fn: () => Promise<void>) => void } {
	const [keys, setKeys] = useState<Set<string>>(() => new Set());
	const run = useCallback((key: string, fn: () => Promise<void>) => {
		setKeys((s) => withKey(s, key));
		void fn().finally(() => setKeys((s) => withoutKey(s, key)));
	}, []);
	const isPending = useCallback((key: string) => keys.has(key), [keys]);
	return { isPending, run };
}

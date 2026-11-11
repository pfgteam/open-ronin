'use client';

// Client picker for The Work. The active-client list loads once per page
// session (shared promise) the first time any picker mounts. A client that is
// no longer active but is already set on the item stays selectable, labelled
// with the name the caller knows.

import { useEffect, useState } from 'react';
import Select from '@/components/ui/Select';
import { listActiveClients } from '@/app/(app)/the-work/clientActions';

type ClientOption = { id: string; name: string };

let cache: Promise<ClientOption[]> | null = null;

export function useClientOptions(): ClientOption[] | null {
	const [options, setOptions] = useState<ClientOption[] | null>(null);
	useEffect(() => {
		let alive = true;
		cache ??= listActiveClients().catch(() => {
			cache = null;
			return [];
		});
		void cache.then((o) => alive && setOptions(o));
		return () => {
			alive = false;
		};
	}, []);
	return options;
}

export default function ClientSelect({ value, onChange, label = 'Client', currentName, emptyLabel = 'No client', size, className, id }: {
	value: string;
	onChange: (clientId: string) => void;
	label?: string;
	/** Name of the client already on the item, for one that is not in the active list. */
	currentName?: string | null;
	emptyLabel?: string;
	size?: 'sm' | 'md';
	className?: string;
	id?: string;
}) {
	const options = useClientOptions();
	const missing = !!value && !!options && !options.some((o) => o.id === value);
	return (
		<Select id={id} label={label || undefined} aria-label={label ? undefined : 'Client'} value={value} onChange={(e) => onChange(e.target.value)} size={size} className={className} disabled={!options}>
			<option value="">{options ? emptyLabel : 'Loading clients…'}</option>
			{missing && <option value={value}>{currentName ?? 'Current client'}</option>}
			{options?.map((o) => (
				<option key={o.id} value={o.id}>
					{o.name}
				</option>
			))}
		</Select>
	);
}

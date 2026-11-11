'use client';

// ProviderPicker: configured providers for one capability with the cost
// note under the control. Presence only; no key ever reaches this component.

import Select from '@/components/ui/Select';
import type { ProviderOption } from '@/lib/content-studio/shared';

interface Props {
	label: string;
	providers: ProviderOption[];
	value: string;
	onChange: (id: string) => void;
	disabled?: boolean;
	/** Copy shown when nothing is configured for the capability. */
	emptyHint?: string;
}

export default function ProviderPicker({ label, providers, value, onChange, disabled, emptyHint }: Props) {
	if (providers.length === 0) {
		return (
			<div className="flex flex-col gap-1">
				<span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
				<p className="text-xs text-slate-500 dark:text-slate-400">
					{emptyHint ?? 'No provider is configured for this yet. An admin adds keys on /admin/providers.'}
				</p>
			</div>
		);
	}
	const current = providers.find((p) => p.id === value) ?? providers[0];
	return (
		<div className="flex flex-col gap-1">
			<Select label={label} value={current.id} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
				{providers.map((p) => (
					<option key={p.id} value={p.id}>
						{p.label}
						{p.async ? ' (async)' : ''}
					</option>
				))}
			</Select>
			<p className="text-2xs text-slate-500 dark:text-slate-400">{current.costNote}</p>
		</div>
	);
}

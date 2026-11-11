'use client';

// KeyValueRows — row editor for the JSON maps (form answer map, connector
// field map): left = intake key from a grouped Select, right = a Select of
// known values (form questions) or free text (vendor payload paths).
// Serialization and validation live in adminOptions.serializeRows.

import { clsx } from 'clsx';
import { Plus, X } from 'lucide-react';
import Select from '@/components/ui/Select';
import { controlFocus, fieldFocus } from '@/components/ui/focus';
import type { IntakeKeyGroup } from '@/lib/revenue/adminOptions';

export type KvRow = { key: string; value: string };

export function rowsFromMap(map: Record<string, unknown> | null | undefined): KvRow[] {
	return Object.entries(map ?? {}).map(([key, value]) => ({ key, value: String(value ?? '') }));
}

export default function KeyValueRows({ rows, onChange, keyGroups, extraKeys = [], valueOptions, valuePlaceholder, disabled, keyLabel, valueLabel }: {
	rows: KvRow[];
	onChange: (rows: KvRow[]) => void;
	keyGroups: IntakeKeyGroup[];
	/** Keys allowed outside the groups (e.g. external_id). */
	extraKeys?: { value: string; label: string }[];
	valueOptions?: { value: string; label: string }[];
	valuePlaceholder?: string;
	disabled?: boolean;
	keyLabel: string;
	valueLabel: string;
}) {
	const set = (i: number, patch: Partial<KvRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
	const known = new Set([...keyGroups.flatMap((g) => g.keys.map((k) => k.value)), ...extraKeys.map((k) => k.value)]);
	return (
		<div className="space-y-1.5">
			<div className="grid grid-cols-[1fr_1fr_28px] gap-2 text-2xs font-medium uppercase tracking-wide text-slate-500">
				<span>{keyLabel}</span>
				<span>{valueLabel}</span>
				<span />
			</div>
			{rows.map((r, i) => (
				<div key={i} className="grid grid-cols-[1fr_1fr_28px] items-center gap-2">
					<Select size="sm" aria-label={`${keyLabel} ${i + 1}`} value={r.key} disabled={disabled} onChange={(e) => set(i, { key: e.target.value })}>
						<option value="">Pick…</option>
						{!known.has(r.key) && r.key && <option value={r.key}>{r.key} (custom)</option>}
						{extraKeys.map((k) => (
							<option key={k.value} value={k.value}>{k.label}</option>
						))}
						{keyGroups.map((g) => (
							<optgroup key={g.group} label={g.group}>
								{g.keys.map((k) => (
									<option key={k.value} value={k.value}>{k.label}</option>
								))}
							</optgroup>
						))}
					</Select>
					{valueOptions ? (
						<Select size="sm" aria-label={`${valueLabel} ${i + 1}`} value={r.value} disabled={disabled} onChange={(e) => set(i, { value: e.target.value })}>
							<option value="">Pick…</option>
							{r.value && !valueOptions.some((o) => o.value === r.value) && <option value={r.value}>{r.value} (not on the form)</option>}
							{valueOptions.map((o) => (
								<option key={o.value} value={o.value}>{o.label}</option>
							))}
						</Select>
					) : (
						<input
							value={r.value}
							disabled={disabled}
							onChange={(e) => set(i, { value: e.target.value })}
							placeholder={valuePlaceholder}
							aria-label={`${valueLabel} ${i + 1}`}
							className={clsx('w-full rounded-md border border-slate-300 bg-white px-2 py-1 font-mono text-xs dark:border-slate-600 dark:bg-slate-800', fieldFocus)}
						/>
					)}
					{!disabled && (
						<button type="button" aria-label={`Remove row ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))} className={clsx('rounded-md p-1 text-slate-500 hover:bg-hover', controlFocus)}>
							<X className="h-3.5 w-3.5" />
						</button>
					)}
				</div>
			))}
			{!disabled && (
				<button type="button" onClick={() => onChange([...rows, { key: '', value: '' }])} className={clsx('inline-flex items-center gap-1 rounded-md px-1 text-xs font-semibold text-primary-800 dark:text-primary-300', controlFocus)}>
					<Plus className="h-3.5 w-3.5" /> Add row
				</button>
			)}
		</div>
	);
}

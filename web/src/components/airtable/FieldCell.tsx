// Generic Airtable field renderer.
// Reads a FieldSchema + raw cell value and renders an appropriate display.
//
// Read-only for now. Inline editing comes in Phase 2 of BaseExplorer.

import Badge from '@/components/ui/Badge';
import { Paperclip, Link2, Check, X } from 'lucide-react';
import {
	formatCurrency,
	formatDate,
	formatNumber,
	formatPercent,
} from '@/lib/format';
import type { FieldSchema } from '@/lib/data';

interface Collaborator {
	id?: string;
	email?: string;
	name?: string;
}

interface Attachment {
	id?: string;
	url?: string;
	filename?: string;
	thumbnails?: { small?: { url: string }; large?: { url: string } };
	type?: string;
}

interface LinkedRecord {
	id: string;
	name?: string;
}

interface FieldCellProps {
	field: FieldSchema;
	value: unknown;
	dense?: boolean;
}

const EMPTY = <span className="text-slate-300 dark:text-slate-600">—</span>;

export default function FieldCell({ field, value, dense = false }: FieldCellProps) {
	if (value == null || value === '') return EMPTY;

	switch (field.type) {
		case 'singleLineText':
		case 'multilineText':
		case 'richText':
		case 'phoneNumber':
		case 'barcode': {
			const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
			return (
				<span className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">
					{dense && text.length > 60 ? text.slice(0, 60) + '…' : text}
				</span>
			);
		}

		case 'email':
			return (
				<a
					href={`mailto:${value}`}
					className="text-primary-600 hover:underline dark:text-primary-400"
				>
					{String(value)}
				</a>
			);

		case 'url': {
			const url = String(value);
			return (
				<a
					href={url}
					target="_blank"
					rel="noopener noreferrer"
					className="text-primary-600 hover:underline dark:text-primary-400 truncate inline-block max-w-xs"
				>
					{url}
				</a>
			);
		}

		case 'number':
		case 'count':
		case 'autoNumber':
		case 'duration':
			return (
				<span className="font-mono text-slate-900 dark:text-slate-100">
					{formatNumber(Number(value))}
				</span>
			);

		case 'currency':
			return (
				<span className="font-mono text-slate-900 dark:text-slate-100">
					{formatCurrency(Number(value))}
				</span>
			);

		case 'percent':
			return (
				<span className="font-mono text-slate-900 dark:text-slate-100">
					{formatPercent(Number(value))}
				</span>
			);

		case 'date':
			return (
				<span className="whitespace-nowrap text-slate-700 dark:text-slate-300">
					{formatDate(String(value))}
				</span>
			);

		case 'dateTime':
		case 'createdTime':
		case 'lastModifiedTime':
			return (
				<span className="whitespace-nowrap text-slate-700 dark:text-slate-300">
					{formatDate(String(value), 'MMM d, yyyy h:mm a')}
				</span>
			);

		case 'checkbox':
			return value ? (
				<Check className="w-4 h-4 text-green-600 dark:text-green-400" />
			) : (
				<X className="w-4 h-4 text-slate-300 dark:text-slate-600" />
			);

		case 'rating': {
			const n = Math.max(0, Math.min(5, Number(value)));
			return (
				<span className="text-amber-500">
					{'★'.repeat(n)}
					<span className="text-slate-200 dark:text-slate-700">{'★'.repeat(5 - n)}</span>
				</span>
			);
		}

		case 'singleSelect':
			return <Badge>{String(value)}</Badge>;

		case 'multipleSelects': {
			const arr = Array.isArray(value) ? (value as string[]) : [];
			const shown = arr.slice(0, dense ? 1 : 3);
			return (
				<div className="flex flex-wrap gap-1">
					{shown.map((s) => (
						<Badge key={s}>{s}</Badge>
					))}
					{arr.length > shown.length && (
						<span
							className="text-xs text-slate-400"
							title={arr.slice(shown.length).join(', ')}
						>
							+{arr.length - shown.length}
						</span>
					)}
				</div>
			);
		}

		case 'singleCollaborator':
		case 'createdBy':
		case 'lastModifiedBy': {
			const c = value as Collaborator;
			return (
				<span className="text-slate-700 dark:text-slate-300 truncate inline-block max-w-[180px]">
					{c.name ?? c.email ?? '—'}
				</span>
			);
		}

		case 'multipleCollaborators': {
			const arr = Array.isArray(value) ? (value as Collaborator[]) : [];
			const names = arr.map((c) => c.name ?? c.email ?? '').filter(Boolean);
			return (
				<span className="text-slate-700 dark:text-slate-300 truncate inline-block max-w-[180px]">
					{names.slice(0, 2).join(', ')}
					{names.length > 2 && ` +${names.length - 2}`}
				</span>
			);
		}

		case 'multipleRecordLinks': {
			const arr = Array.isArray(value) ? (value as (LinkedRecord | string)[]) : [];
			// Sometimes Airtable returns just the ID string array (when names aren't joined in)
			const names = arr
				.map((r) => (typeof r === 'string' ? r : (r.name ?? r.id)))
				.filter(Boolean);
			return (
				<span className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-300">
					<Link2 className="w-3 h-3 text-slate-400 shrink-0" />
					<span className="truncate max-w-[200px]" title={names.join(', ')}>
						{names.length} linked
						{!dense && names[0] && `: ${names[0]}`}
						{!dense && names.length > 1 && ` +${names.length - 1}`}
					</span>
				</span>
			);
		}

		case 'multipleAttachments': {
			const arr = Array.isArray(value) ? (value as Attachment[]) : [];
			return (
				<span className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-300">
					<Paperclip className="w-3 h-3 text-slate-400" />
					{arr.length}
				</span>
			);
		}

		case 'formula':
		case 'lookup':
		case 'rollup': {
			// These can be any underlying type; check shape and render best-effort
			if (typeof value === 'object' && value !== null && 'error' in value) {
				return <span className="text-amber-600 text-xs">#ERROR</span>;
			}
			if (Array.isArray(value)) {
				const arr = value as unknown[];
				return (
					<span className="text-slate-700 dark:text-slate-300 truncate inline-block max-w-[200px]">
						{arr.slice(0, 3).map(String).join(', ')}
						{arr.length > 3 && ` +${arr.length - 3}`}
					</span>
				);
			}
			if (typeof value === 'number') {
				return (
					<span className="font-mono text-slate-900 dark:text-slate-100">
						{formatNumber(value)}
					</span>
				);
			}
			if (typeof value === 'boolean') {
				return value ? (
					<Check className="w-4 h-4 text-green-600" />
				) : (
					<X className="w-4 h-4 text-slate-300" />
				);
			}
			return (
				<span className="text-slate-700 dark:text-slate-300">{String(value)}</span>
			);
		}

		case 'multipleLookupValues': {
			const arr = Array.isArray(value) ? (value as unknown[]) : [value];
			return (
				<span className="text-slate-700 dark:text-slate-300 truncate inline-block max-w-[200px]">
					{arr
						.slice(0, 3)
						.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v)))
						.join(', ')}
					{arr.length > 3 && ` +${arr.length - 3}`}
				</span>
			);
		}

		case 'button':
			return <span className="text-slate-400 text-xs">[button]</span>;

		default: {
			// Unknown field type — render defensively
			const display =
				typeof value === 'object' ? JSON.stringify(value).slice(0, 40) : String(value);
			return (
				<span
					className="text-slate-500 dark:text-slate-400 text-xs"
					title={`Unknown field type: ${field.type}`}
				>
					{display}
				</span>
			);
		}
	}
}

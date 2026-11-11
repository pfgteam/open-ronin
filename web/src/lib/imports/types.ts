// Data Imports: the shared vocabulary for the wizard, the engine and the
// target registry. Pure types, no server imports, so client components can
// read them.

export type ColumnType =
	| 'text'
	| 'email'
	| 'phone'
	| 'url'
	| 'number'
	/** A whole number (integer column): a fractional value is rejected, never rounded. */
	| 'integer'
	/** Same, for a bigint column (JS safe-integer range). */
	| 'bigint'
	| 'currency_cents'
	| 'date'
	| 'month'
	| 'boolean'
	| 'enum'
	| 'list'
	| 'uuid';

export interface ColumnSpec {
	/** Column key in the target (or the Airtable field name). */
	key: string;
	label: string;
	type: ColumnType;
	required?: boolean;
	/** Part of the natural key used to match existing rows. */
	naturalKey?: boolean;
	/** Allowed values for `enum`, or allowed items for `list` when constrained. */
	values?: readonly string[];
	/** Extra header names the auto matcher accepts for this column. */
	aliases?: readonly string[];
	help?: string;
}

export type TargetKey = 'contacts' | 'prospects' | 'media_outlets' | 'client_aliases' | 'metrics' | 'media_opportunities' | 'rev_prospects' | 'airtable';

export const TARGET_KEYS: readonly TargetKey[] = [
	'contacts',
	'prospects',
	'media_outlets',
	'client_aliases',
	'metrics',
	'media_opportunities',
	'rev_prospects',
	'airtable',
] as const;

export interface TargetInfo {
	key: TargetKey;
	label: string;
	description: string;
	/** Which columns identify a row. Shown on the Target step. */
	naturalKeyLabel: string;
	columns: ColumnSpec[];
}

/** { targetColumnKey: fileHeader } . An absent key means "not mapped". */
export type Mapping = Record<string, string>;

export type RowAction = 'insert' | 'update' | 'reject' | 'skip';

export interface PlannedRow {
	rowNumber: number;
	action: RowAction;
	targetId: string | null;
	before: Record<string, unknown> | null;
	after: Record<string, unknown> | null;
	reason: string | null;
}

export type BatchStatus =
	| 'draft'
	| 'uploaded'
	| 'targeted'
	| 'mapped'
	| 'dry_run'
	| 'committing'
	| 'committed'
	| 'rolled_back'
	| 'failed';

export interface BatchRow {
	id: string;
	target: TargetKey | null;
	target_ref: string | null;
	/**
	 * Where the rows came from. 'upload' is a file in the imports bucket;
	 * 'airtable' means the file was written by the server from an Airtable
	 * table pull (options.source = { baseId, table, fields }).
	 */
	file_path: string | null;
	file_name: string | null;
	file_size: number | null;
	headers: string[];
	sample: string[][];
	mapping: Mapping;
	options: Record<string, unknown>;
	status: BatchStatus;
	row_count: number;
	insert_count: number;
	update_count: number;
	reject_count: number;
	progress: number;
	error: string | null;
	requested_by: string;
	created_at: string;
	updated_at: string;
	committed_at: string | null;
	rolled_back_at: string | null;
	rolled_back_by: string | null;
}

export const WIZARD_STEPS = ['upload', 'target', 'map', 'dry-run', 'commit'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** The furthest step a batch in this status may show. */
export function stepForStatus(status: BatchStatus): WizardStep {
	switch (status) {
		case 'draft':
			return 'upload';
		case 'uploaded':
			return 'target';
		case 'targeted':
			return 'map';
		case 'mapped':
			return 'dry-run';
		default:
			return 'commit';
	}
}

export function stepIndex(step: WizardStep): number {
	return WIZARD_STEPS.indexOf(step);
}

/** Rows per server action call for dry run and commit. */
export const CHUNK_SIZE = 500;

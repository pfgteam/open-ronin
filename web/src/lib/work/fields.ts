// The Planning field set per kind (rework D4, D11): the schema of record for
// what the item drawer shows and edits, what the full create form asks for,
// and which fields a type change hides. Derived from the old Planning form
// (WorkItemForm.tsx: showLeadLag, showTarget, showTimeframe, showQuarter,
// showProjectLead, showDeptSubDept, showProcessAction, showMultiOwner) plus
// the 0162 additions (bug fields, discipline, manual progress / health).
//
// Rework 8.1: Alex walks this list per kind before phase 4 ships; the CSV
// in Vault/code/openronin/ is generated from KIND_FIELDS (planningFieldsCsv).

import type { EditableField } from '@/app/(app)/the-work/b/actions';
import type { StatusDef, WorkRow } from '@/lib/work/boards/types';
import { PARENT_KIND_FOR, CHILD_KINDS_FOR_PARENT } from '@/app/(app)/the-work/hierarchy';
import { categoryOf } from '@/lib/work/hub/rows';

/**
 * 5.6: map a status onto another kind's set by CATEGORY (not started,
 * active, done, cancelled): the same slug when the target has it, else the
 * first status of the same category, else the target's initial status.
 */
export function mapStatus(from: Pick<StatusDef, 'slug' | 'is_terminal' | 'is_initial' | 'category'>, to: StatusDef[]): StatusDef | null {
	if (!to.length) return null;
	const same = to.find((s) => s.slug === from.slug);
	if (same) return same;
	const cat = categoryOf(from);
	const inCat = to.filter((s) => categoryOf(s) === cat && s.slug !== 'backlog');
	if (inCat.length) return inCat[0];
	if (from.slug === 'backlog') return to.find((s) => s.slug === 'backlog') ?? to[0];
	return to.find((s) => s.is_initial) ?? to[0];
}

export type FieldType =
	| 'text' | 'markdown' | 'person' | 'date' | 'status' | 'urgency' | 'quarter' | 'department' | 'subdept' | 'client' | 'discipline'
	| 'severity' | 'boolean' | 'number' | 'progress' | 'health' | 'timeframe' | 'parent' | 'tags' | 'owners';

export interface FieldDef {
	key: string;
	/** projects column the field writes (null = written elsewhere: tags, co-owners). */
	column: EditableField | null;
	label: string;
	type: FieldType;
	help?: string;
}

export const FIELDS: Record<string, FieldDef> = {
	status: { key: 'status', column: 'status', label: 'Status', type: 'status' },
	owner: { key: 'owner', column: 'owner_id', label: 'Owner', type: 'person' },
	owners: { key: 'owners', column: null, label: 'Co-owners', type: 'owners', help: 'Everyone who shares the work; the owner is always one of them.' },
	lead: { key: 'lead', column: 'project_lead_id', label: 'Lead', type: 'person' },
	urgency: { key: 'urgency', column: 'priority', label: 'Urgency', type: 'urgency' },
	parent: { key: 'parent', column: 'parent_id', label: 'Parent', type: 'parent' },
	quarter: { key: 'quarter', column: 'quarter_id', label: 'Quarter', type: 'quarter' },
	timeframe: { key: 'timeframe', column: 'timeframe_grain', label: 'Timeframe', type: 'timeframe' },
	start: { key: 'start', column: 'starts_at', label: 'Start', type: 'date' },
	due: { key: 'due', column: 'ends_at', label: 'Due', type: 'date' },
	department: { key: 'department', column: 'department_tag_id', label: 'Department', type: 'department' },
	subdept: { key: 'subdept', column: 'sub_team_tag_id', label: 'Sub-department', type: 'subdept' },
	client: { key: 'client', column: 'client_id', label: 'Client', type: 'client' },
	discipline: { key: 'discipline', column: 'discipline_id', label: 'Discipline', type: 'discipline' },
	severity: { key: 'severity', column: 'severity', label: 'Severity', type: 'severity' },
	environment: { key: 'environment', column: 'environment', label: 'Environment', type: 'text', help: 'Where it happens: production, a browser, a device.' },
	regression: { key: 'regression', column: 'is_regression', label: 'Regression', type: 'boolean', help: 'It used to work.' },
	progress: { key: 'progress', column: 'manual_progress', label: 'Progress', type: 'progress', help: 'Automatic from what sits under it. Drag to set it by hand; one click goes back to automatic.' },
	health: { key: 'health', column: 'manual_health', label: 'Health', type: 'health' },
	lead_measure: { key: 'lead_measure', column: 'lead_measure_md', label: 'Lead measure', type: 'markdown' },
	lag_measure: { key: 'lag_measure', column: 'lag_measure_md', label: 'Lag measure', type: 'markdown' },
	target_value: { key: 'target_value', column: 'target_value', label: 'Target', type: 'number' },
	target_progress: { key: 'target_progress', column: 'target_progress', label: 'Current value', type: 'number' },
	target_unit: { key: 'target_unit', column: 'target_unit', label: 'Unit', type: 'text' },
	recurrence: { key: 'recurrence', column: 'recurrence_rule', label: 'Repeats', type: 'text', help: 'For example: every Monday, first business day of the month.' },
	process_action: { key: 'process_action', column: 'process_action_md', label: 'Create / update notes', type: 'markdown' },
	estimate: { key: 'estimate', column: 'estimated_hours', label: 'Estimated hours', type: 'number' },
	description: { key: 'description', column: 'description_md', label: 'Description', type: 'markdown' },
	notes: { key: 'notes', column: 'notes_md', label: 'Notes', type: 'markdown' },
	tags: { key: 'tags', column: null, label: 'Tags', type: 'tags' },
};

const BASE = ['status', 'owner', 'urgency', 'start', 'due', 'tags', 'description', 'notes'];

/** Field order per kind (the drawer renders in this order). */
export const KIND_FIELDS: Record<string, string[]> = {
	goal: ['status', 'owner', 'health', 'progress', 'timeframe', 'quarter', 'start', 'due', 'lead_measure', 'lag_measure', 'tags', 'description', 'notes'],
	priority: ['status', 'owner', 'parent', 'health', 'progress', 'quarter', 'urgency', 'start', 'due', 'tags', 'description', 'notes'],
	project: ['status', 'owner', 'lead', 'owners', 'parent', 'health', 'progress', 'quarter', 'department', 'subdept', 'urgency', 'start', 'due', 'estimate', 'tags', 'description', 'notes'],
	task: ['status', 'owner', 'owners', 'parent', 'urgency', 'start', 'due', 'estimate', 'tags', 'description', 'notes'],
	recurring: ['status', 'owner', 'recurrence', 'department', 'urgency', 'start', 'due', 'tags', 'description', 'notes'],
	process: ['status', 'owner', 'department', 'subdept', 'process_action', 'urgency', 'start', 'due', 'tags', 'description', 'notes'],
	bug: ['status', 'owner', 'severity', 'environment', 'regression', 'urgency', 'due', 'tags', 'description', 'notes'],
	strategy: ['status', 'owner', 'client', 'start', 'due', 'tags', 'description', 'notes'],
	twelve_week_plan: ['status', 'owner', 'client', 'parent', 'quarter', 'progress', 'start', 'due', 'tags', 'description', 'notes'],
	campaign: ['status', 'owner', 'lead', 'owners', 'client', 'parent', 'health', 'progress', 'quarter', 'department', 'subdept', 'start', 'due', 'tags', 'description', 'notes'],
	assignment: ['status', 'owner', 'owners', 'client', 'discipline', 'parent', 'urgency', 'start', 'due', 'estimate', 'tags', 'description', 'notes'],
	target: ['status', 'owner', 'client', 'target_value', 'target_progress', 'target_unit', 'due', 'tags', 'description', 'notes'],
	event: [...BASE],
};

export function fieldsFor(kind: string): FieldDef[] {
	const keys = (KIND_FIELDS[kind] ?? BASE).filter((k) => k !== 'parent' || !!PARENT_KIND_FOR[kind]);
	// Progress / health only make sense on containers (kinds with children).
	return keys.filter((k) => !(k === 'progress' || k === 'health') || !!CHILD_KINDS_FOR_PARENT[kind]).map((k) => FIELDS[k]).filter(Boolean);
}

/** Kinds the type picker offers (the hub kinds plus the client chain). */
export const TYPE_CHOICES = ['goal', 'priority', 'project', 'task', 'recurring', 'process', 'bug', 'strategy', 'twelve_week_plan', 'campaign', 'assignment'];

function hasValue(row: WorkRow, f: FieldDef): boolean {
	if (!f.column) return false;
	const v = (row as unknown as Record<string, unknown>)[f.column];
	return v !== null && v !== undefined && v !== '' && v !== false;
}

/**
 * 5.6: fields the new kind does not show that carry a value now. Nothing is
 * deleted: the value stays in the row and comes back if the type is changed
 * back. The confirm dialog lists these.
 */
export function hiddenOnTypeChange(row: WorkRow, toKind: string): FieldDef[] {
	const keep = new Set(fieldsFor(toKind).map((f) => f.key));
	return fieldsFor(row.kind).filter((f) => !keep.has(f.key) && hasValue(row, f));
}

/** 8.1: the field list per kind as CSV for Alex's review. */
export function planningFieldsCsv(): string {
	const lines = ['kind,order,field,label,type,writes_column,notes'];
	for (const kind of Object.keys(KIND_FIELDS)) {
		fieldsFor(kind).forEach((f, i) => {
			const note = (f.help ?? '').replace(/"/g, '""');
			lines.push(`${kind},${i + 1},${f.key},"${f.label}",${f.type},${f.column ?? '(junction table)'},"${note}"`);
		});
	}
	return lines.join('\n') + '\n';
}

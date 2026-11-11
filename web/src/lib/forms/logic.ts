// Forms: field vocabulary + the conditional-logic engine (0086). No server
// imports; the builder, the renderer and the submit action all use this so
// "show field B only if field A = X" means the same thing everywhere.

// `phone` and `file` arrived with 0158 (public forms). A `file` value is the
// storage path the upload door returned (string); the submit verifies it
// sits under the form's own prefix before it is stored.
export const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'multiselect', 'checkbox', 'email', 'phone', 'url', 'file'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
	text: 'Short text',
	textarea: 'Long text',
	number: 'Number',
	date: 'Date',
	select: 'Pick one',
	multiselect: 'Pick many',
	checkbox: 'Yes / no',
	email: 'Email',
	phone: 'Phone',
	url: 'Link',
	file: 'File upload',
};

export const OPS = ['eq', 'neq', 'in', 'not_empty', 'empty'] as const;
export type Op = (typeof OPS)[number];
export const OP_LABELS: Record<Op, string> = {
	eq: 'equals',
	neq: 'does not equal',
	in: 'is one of',
	not_empty: 'is filled in',
	empty: 'is empty',
};

export interface ShowIf {
	field: string;
	op: Op;
	/** For eq/neq a single value; for `in` a comma-separated list. Ignored for empty/not_empty. */
	value?: string;
}

export interface FormField {
	key: string;
	label: string;
	type: FieldType;
	required?: boolean;
	/** For select / multiselect. */
	options?: string[];
	help?: string;
	show_if?: ShowIf | null;
}

export type FormValues = Record<string, string | string[] | boolean | number | null | undefined>;

function asList(v: FormValues[string]): string[] {
	if (Array.isArray(v)) return v.map(String);
	if (v === null || v === undefined || v === '') return [];
	return [String(v)];
}

/** Does `rule` hold against the current values? Missing rule = always shown. */
export function ruleHolds(rule: ShowIf | null | undefined, values: FormValues): boolean {
	if (!rule || !rule.field) return true;
	const cur = asList(values[rule.field]);
	switch (rule.op) {
		case 'empty': return cur.length === 0 || cur.every((x) => x === '' || x === 'false');
		case 'not_empty': return cur.some((x) => x !== '' && x !== 'false');
		case 'eq': return cur.includes(String(rule.value ?? ''));
		case 'neq': return !cur.includes(String(rule.value ?? ''));
		case 'in': {
			const wanted = String(rule.value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
			return cur.some((x) => wanted.includes(x));
		}
	}
}

/**
 * Which fields are visible given the values. A field whose controlling
 * field is itself hidden is hidden too (rules chain), evaluated in order so
 * a rule can only point at an earlier field.
 */
export function visibleFields(fields: FormField[], values: FormValues): FormField[] {
	const hidden = new Set<string>();
	const out: FormField[] = [];
	for (const f of fields) {
		const controller = f.show_if?.field;
		const shown = ruleHolds(f.show_if, values) && !(controller && hidden.has(controller));
		if (shown) out.push(f);
		else hidden.add(f.key);
	}
	return out;
}

/** Strip values of hidden fields and validate required visible ones. */
export function finalizeSubmission(fields: FormField[], values: FormValues): { data: FormValues; errors: string[] } {
	const shown = visibleFields(fields, values);
	const data: FormValues = {};
	const errors: string[] = [];
	for (const f of shown) {
		const v = values[f.key];
		const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) || v === false;
		if (f.required && empty) errors.push(`${f.label} is required.`);
		if (!empty) {
			if (f.type === 'number' && Number.isNaN(Number(v))) errors.push(`${f.label} must be a number.`);
			if (f.type === 'email' && typeof v === 'string' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) errors.push(`${f.label} must be an email.`);
			if (f.type === 'phone' && typeof v === 'string' && !/^[+()\d\s.-]{6,24}$/.test(v)) errors.push(`${f.label} must be a phone number.`);
			if (f.type === 'url' && typeof v === 'string' && !/^(https?:\/\/)?[^\s/$.?#].[^\s]*$/i.test(v)) errors.push(`${f.label} must be a link.`);
			if (f.type === 'file' && typeof v !== 'string') errors.push(`${f.label}: upload did not finish.`);
			if ((f.type === 'select') && typeof v === 'string' && f.options && !f.options.includes(v)) errors.push(`${f.label}: "${v}" is not an option.`);
			data[f.key] = f.type === 'number' ? Number(v) : v;
		}
	}
	return { data, errors };
}

const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

/** Builder-side validation of a field list: unique keys, rules point backwards. */
export function validateFields(fields: FormField[]): string[] {
	const errors: string[] = [];
	const seen = new Set<string>();
	fields.forEach((f, i) => {
		if (!KEY_RE.test(f.key)) errors.push(`Field ${i + 1}: key must be a lowercase identifier (a-z, 0-9, _).`);
		if (seen.has(f.key)) errors.push(`Field ${i + 1}: key "${f.key}" is repeated.`);
		seen.add(f.key);
		if (!f.label?.trim()) errors.push(`Field ${i + 1}: needs a label.`);
		if (!FIELD_TYPES.includes(f.type)) errors.push(`Field ${i + 1}: unknown type.`);
		if ((f.type === 'select' || f.type === 'multiselect') && !(f.options && f.options.length)) errors.push(`Field ${i + 1}: needs options.`);
		if (f.show_if?.field) {
			const idx = fields.findIndex((g) => g.key === f.show_if!.field);
			if (idx === -1) errors.push(`Field ${i + 1}: rule points at unknown field "${f.show_if.field}".`);
			else if (idx >= i) errors.push(`Field ${i + 1}: a rule can only depend on a field above it.`);
			if (!OPS.includes(f.show_if.op)) errors.push(`Field ${i + 1}: unknown rule operator.`);
		}
	});
	return errors;
}

/** Parse the builder's JSON safely into FormField[] (or throw a friendly error). */
export function parseFields(raw: unknown): FormField[] {
	if (!Array.isArray(raw)) throw new Error('fields must be a list');
	return raw.map((f, i) => {
		if (!f || typeof f !== 'object') throw new Error(`field ${i + 1} is not an object`);
		const o = f as Record<string, unknown>;
		const rule = o.show_if && typeof o.show_if === 'object' ? (o.show_if as Record<string, unknown>) : null;
		return {
			key: String(o.key ?? ''),
			label: String(o.label ?? ''),
			type: String(o.type ?? 'text') as FieldType,
			required: !!o.required,
			options: Array.isArray(o.options) ? o.options.map(String) : undefined,
			help: o.help ? String(o.help) : undefined,
			show_if: rule && rule.field ? { field: String(rule.field), op: String(rule.op ?? 'eq') as Op, value: rule.value === undefined ? undefined : String(rule.value) } : null,
		};
	});
}

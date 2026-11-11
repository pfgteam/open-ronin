/**
 * Airtable -> native table mapping for the phase 6 mirror
 * (AIRTABLE_SUNSET_PLAN.md). Pure: field schema in, column spec out; record
 * fields in, cell values out. The server action in data/bases/actions.ts
 * drives the Airtable adapter and the nt_* writes.
 */
import type { FieldSchema, FieldType } from '@/lib/data/adapter';
import type { ColumnType, CellValue } from './values';

export interface MirrorColumnSpec {
  airtable_field_id: string;
  airtable_field_name: string;
  airtable_type: FieldType;
  name: string;
  type: ColumnType;
  config: Record<string, unknown>;
}

const TYPE_MAP: Partial<Record<FieldType, ColumnType>> = {
  singleLineText: 'text',
  multilineText: 'long_text',
  richText: 'long_text',
  email: 'email',
  url: 'url',
  phoneNumber: 'phone',
  number: 'number',
  currency: 'currency',
  percent: 'percent',
  duration: 'duration',
  rating: 'rating',
  singleSelect: 'select',
  multipleSelects: 'select',
  date: 'datetime',
  dateTime: 'datetime',
  createdTime: 'datetime',
  lastModifiedTime: 'datetime',
  checkbox: 'boolean',
  barcode: 'text',
  multipleRecordLinks: 'link',
  multipleAttachments: 'url',
  formula: 'text',
  lookup: 'text',
  rollup: 'text',
  count: 'number',
  multipleLookupValues: 'text',
  createdBy: 'text',
  lastModifiedBy: 'text',
  singleCollaborator: 'text',
  multipleCollaborators: 'text',
  autoNumber: 'number',
  button: 'text',
};

/**
 * Map one Airtable field to a native column. Computed Airtable fields
 * (formula, lookup, rollup, count) become plain snapshot columns of the
 * value at mirror time: their `config.airtable_computed` flag tells the
 * UI why they will not recompute. Links become `link` columns whose
 * `config.target_airtable_table_id` is set; `target_table_id` is filled in
 * when that table has been mirrored too (see linkMirroredTargets()).
 */
export function mapField(field: FieldSchema): MirrorColumnSpec {
  const type = TYPE_MAP[field.type] ?? 'text';
  const config: Record<string, unknown> = { airtable_field_id: field.id, airtable_type: field.type };
  const opts = (field.options ?? {}) as Record<string, unknown>;
  if (field.type === 'singleSelect' || field.type === 'multipleSelects') {
    const choices = Array.isArray(opts.choices) ? (opts.choices as Array<{ name?: string }>).map((c) => String(c.name ?? '')).filter(Boolean) : [];
    config.options = choices;
    config.multiple = field.type === 'multipleSelects';
  }
  if (field.type === 'currency' && typeof opts.symbol === 'string') config.currency = opts.symbol === '$' ? 'USD' : opts.symbol;
  if (field.type === 'multipleRecordLinks' && typeof opts.linkedTableId === 'string') config.target_airtable_table_id = opts.linkedTableId;
  if (['formula', 'lookup', 'rollup', 'count', 'multipleLookupValues'].includes(field.type)) config.airtable_computed = true;
  return { airtable_field_id: field.id, airtable_field_name: field.name, airtable_type: field.type, name: field.name.slice(0, 255), type, config };
}

/** Airtable record field value -> nt_cells.value for the mapped column. null = leave the cell empty. */
export function mapCell(spec: MirrorColumnSpec, raw: unknown, linkIds?: (airtableIds: string[]) => string[]): CellValue | null {
  if (raw === null || raw === undefined || raw === '') return null;
  switch (spec.type) {
    case 'number':
    case 'currency':
    case 'percent':
    case 'rating':
    case 'duration': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[$,%]/g, ''));
      return isNaN(n) ? null : n;
    }
    case 'boolean':
      return raw === true;
    case 'datetime': {
      const d = new Date(String(raw));
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    case 'select':
      if (Array.isArray(raw)) return raw.map((x) => String(x)).filter(Boolean);
      return [String(raw)];
    case 'link': {
      const ids = Array.isArray(raw) ? raw.map(String) : [String(raw)];
      const mapped = linkIds ? linkIds(ids) : [];
      return mapped.length ? mapped : null;
    }
    case 'url':
      if (spec.airtable_type === 'multipleAttachments' && Array.isArray(raw)) {
        const first = raw[0] as { url?: string } | undefined;
        return first?.url ?? null;
      }
      return String(raw);
    default:
      if (Array.isArray(raw)) {
        return raw.map((x) => (x && typeof x === 'object' ? String((x as { name?: string; email?: string; url?: string }).name ?? (x as { email?: string }).email ?? (x as { url?: string }).url ?? JSON.stringify(x)) : String(x))).join(', ');
      }
      if (raw && typeof raw === 'object') {
        const o = raw as { name?: string; email?: string; text?: string; url?: string };
        return String(o.name ?? o.email ?? o.text ?? o.url ?? JSON.stringify(raw));
      }
      return String(raw);
  }
}

/** Skip Airtable's system/UI-only field types when mirroring. */
export function isMirrorable(field: FieldSchema): boolean {
  return field.type !== 'button';
}

'use server';

import { revalidatePath } from 'next/cache';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { hasModuleAccess } from '@/lib/permissions/modules';
import { z } from 'zod';
import { parseCsv } from '@/lib/imports/parse';
import { COLUMN_TYPES, inferColumnType, coerceValue } from '@/lib/native-tables/values';
import type { ColumnType, CellValue } from '@/lib/native-tables/values';
import { validateQuery, isEmptyQuery, toRpcPayload, EMPTY_QUERY } from '@/lib/native-tables/query';
import type { GridQuery } from '@/lib/native-tables/query';
import { keyBetween } from '@/lib/native-tables/orderKey';
import { parseFormula, evaluateFormula, cellToFormulaValue } from '@/lib/native-tables/formula';
import { mapField, mapCell, isMirrorable } from '@/lib/native-tables/airtableMirror';
import type { MirrorColumnSpec } from '@/lib/native-tables/airtableMirror';
import { getAdapter, DataAdapterError } from '@/lib/data';
import { isSensitiveBase } from '@/lib/data/sensitiveBases';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';

// ============================================================================
// Gate
// ============================================================================

async function gate(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const profile = await getAuthProfile();
  if (!profile) return { ok: false, error: 'Not signed in.' };
  if (!(await hasManageNativeTables())) return { ok: false, error: 'You do not have permission to manage native tables.' };
  return { ok: true, userId: profile.id };
}

/**
 * Mirrors public.can_manage_native_tables() (0096) for a readable refusal.
 * RLS is the real guard: Data module access AND (admin/exec or the
 * manage_native_tables capability).
 */
export async function hasManageNativeTables(): Promise<boolean> {
  const profile = await getAuthProfile();
  if (!profile) return false;
  if (!(await hasModuleAccess('data'))) return false;
  if (profile.role === 'admin' || profile.role === 'exec') return true;
  const supabase = await createClient();
  const { data } = await supabase
    .from('user_capabilities')
    .select('capability')
    .eq('user_id', profile.id)
    .eq('capability', 'manage_native_tables')
    .maybeSingle();
  return Boolean(data);
}

// ============================================================================
// nt_tables
// ============================================================================

/** PostgREST returns `relation(count)` as `[{ count }]`; normalise to a number. */
function countOf(rel: unknown): number {
  if (Array.isArray(rel)) return Number((rel[0] as { count?: number } | undefined)?.count ?? 0);
  if (rel && typeof rel === 'object') return Number((rel as { count?: number }).count ?? 0);
  return 0;
}

const TableSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullable().default(null),
});

export async function listTables(): Promise<{ ok: true; tables: Array<{ id: string; name: string; description: string | null; row_count: number; column_count: number; created_at: string }> } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('nt_tables')
    .select(`
      id,
      name,
      description,
      created_at,
      nt_columns(count),
      nt_rows(count)
    `)
    .order('order_key');
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    tables: (data ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      row_count: countOf(t.nt_rows),
      column_count: countOf(t.nt_columns),
      created_at: t.created_at,
    })),
  };
}

export async function createTable(input: { name: string; description?: string }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const parsed = TableSchema.safeParse({ ...input, description: input.description ?? null });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('nt_tables')
    .insert({ name: parsed.data.name, description: parsed.data.description, created_by: g.userId })
    .select('id')
    .single();
  if (error) return { ok: false, error: error.message };
  await recordAudit({ actor_id: g.userId, entity_kind: 'supabase', entity_ref: `nt_tables:${data.id}`, action: 'create', diff: { name: parsed.data.name } });
  revalidatePath('/data/bases');
  return { ok: true, id: data.id };
}

export async function updateTable(id: string, input: { name?: string; description?: string | null; order_key?: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const supabase = await createClient();
  const existing = await supabase.from('nt_tables').select('name').eq('id', id).single();
  if (existing.error || !existing.data) return { ok: false, error: 'Table not found.' };
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const n = TableSchema.shape.name.parse(input.name);
    patch.name = n;
  }
  if (input.description !== undefined) patch.description = input.description;
  if (input.order_key !== undefined) patch.order_key = input.order_key;
  if (Object.keys(patch).length === 0) return { ok: true };
  const { error } = await supabase.from('nt_tables').update(patch).eq('id', id);
  if (error) return { ok: false, error: error.message };
  await recordAudit({ actor_id: g.userId, entity_kind: 'supabase', entity_ref: `nt_tables:${id}`, action: 'update', diff: patch });
  revalidatePath('/data/bases');
  return { ok: true };
}

export async function deleteTable(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const supabase = await createClient();
  const { error } = await supabase.from('nt_tables').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  await recordAudit({ actor_id: g.userId, entity_kind: 'supabase', entity_ref: `nt_tables:${id}`, action: 'delete' });
  revalidatePath('/data/bases');
  return { ok: true };
}

// ============================================================================
// nt_columns
// ============================================================================

const ColumnSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(COLUMN_TYPES),
  config: z.record(z.unknown()).default({}),
});

const AUDIENCE_ROLES = ['exec', 'admin', 'manager', 'contributor'] as const;

/**
 * Type-specific config validation (phase 4): formula expressions must parse,
 * link targets must be a real table, visible_to must be roles. Returns the
 * cleaned config.
 */
async function checkColumnConfig(supabase: Awaited<ReturnType<typeof createClient>>, type: ColumnType, config: Record<string, unknown>): Promise<{ ok: true; config: Record<string, unknown> } | { ok: false; error: string }> {
  const out: Record<string, unknown> = { ...config };
  if (out.visible_to !== undefined) {
    if (!Array.isArray(out.visible_to)) return { ok: false, error: 'visible_to must be a list of roles.' };
    const roles = out.visible_to.map(String).filter((r) => (AUDIENCE_ROLES as readonly string[]).includes(r));
    if (roles.length === 0) delete out.visible_to;
    else out.visible_to = roles;
  }
  if (type === 'formula') {
    const expr = typeof out.expression === 'string' ? out.expression.trim() : '';
    if (!expr) return { ok: false, error: 'Formula columns need an expression.' };
    try {
      parseFormula(expr);
    } catch (e) {
      return { ok: false, error: `Formula: ${e instanceof Error ? e.message : String(e)}` };
    }
    out.expression = expr;
  }
  if (type === 'link') {
    const target = typeof out.target_table_id === 'string' ? out.target_table_id : '';
    if (!z.string().uuid().safeParse(target).success) return { ok: false, error: 'Link columns need a target table.' };
    const t = await supabase.from('nt_tables').select('id').eq('id', target).maybeSingle();
    if (!t.data) return { ok: false, error: 'Link target table not found.' };
  }
  return { ok: true, config: out };
}

/**
 * Reference cell values (phase 4): a `link` cell is an array of row ids that
 * must belong to the target table; `user` is {id, name} for an active
 * profile; `brand` is {id, name} for a brands row. Anything else is refused
 * so a forged picker cannot point at rows the viewer never saw.
 */
async function checkRefValue(supabase: Awaited<ReturnType<typeof createClient>>, type: ColumnType, config: Record<string, unknown>, value: CellValue): Promise<{ ok: true; value: CellValue } | { ok: false; error: string }> {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (type === 'link') {
    const ids = Array.isArray(value) ? value.map(String) : [];
    if (ids.length === 0) return { ok: true, value: null };
    if (ids.length > 100) return { ok: false, error: 'At most 100 linked rows.' };
    const target = String(config.target_table_id ?? '');
    const { data } = await supabase.from('nt_rows').select('id').eq('table_id', target).in('id', ids);
    const found = new Set((data ?? []).map((r) => r.id));
    const kept = ids.filter((i) => found.has(i));
    return { ok: true, value: kept.length ? kept : null };
  }
  if (type === 'user') {
    const id = typeof value === 'object' && !Array.isArray(value) ? String((value as { id?: unknown }).id ?? '') : String(value);
    if (!z.string().uuid().safeParse(id).success) return { ok: false, error: 'Pick a user.' };
    const { data } = await supabase.from('profiles').select('id, first_name, last_name, email').eq('id', id).maybeSingle();
    if (!data) return { ok: false, error: 'User not found.' };
    return { ok: true, value: { id: data.id, name: [data.first_name, data.last_name].filter(Boolean).join(' ') || data.email } };
  }
  if (type === 'brand') {
    const id = typeof value === 'object' && !Array.isArray(value) ? String((value as { id?: unknown }).id ?? '') : String(value);
    if (!z.string().uuid().safeParse(id).success) return { ok: false, error: 'Pick a brand.' };
    const { data } = await supabase.from('brands').select('id, brand_name').eq('id', id).maybeSingle();
    if (!data) return { ok: false, error: 'Brand not found.' };
    return { ok: true, value: { id: data.id, name: data.brand_name } };
  }
  return { ok: true, value };
}

export async function listColumns(tableId: string): Promise<{ ok: true; columns: Array<{ id: string; name: string; type: ColumnType; config: Record<string, unknown>; order_key: string; is_hidden: boolean; width: number; created_at: string }> } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('nt_columns')
    .select('*')
    .eq('table_id', tableId)
    .order('order_key');
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    columns: (data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      config: (c.config ?? {}) as Record<string, unknown>,
      order_key: c.order_key,
      is_hidden: c.is_hidden,
      width: c.width,
      created_at: c.created_at,
    })),
  };
}

export async function createColumn(tableId: string, input: { name: string; type: ColumnType; config?: Record<string, unknown> }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const supabase = await createClient();
  const table = await supabase.from('nt_tables').select('id').eq('id', tableId).single();
  if (table.error || !table.data) return { ok: false, error: 'Table not found.' };
  const parsed = ColumnSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid column.' };
  const nameCheck = await supabase.from('nt_columns').select('id').eq('table_id', tableId).eq('name', parsed.data.name).maybeSingle();
  if (nameCheck.data) return { ok: false, error: 'A column with that name already exists.' };
  const cfg = await checkColumnConfig(supabase, parsed.data.type, parsed.data.config ?? {});
  if (!cfg.ok) return cfg;
  const last = await supabase.from('nt_columns').select('order_key').eq('table_id', tableId).order('order_key', { ascending: false }).limit(1).single();
  const orderKey = last.data?.order_key ? last.data.order_key + 'z' : 'z';
  const { data, error } = await supabase
    .from('nt_columns')
    .insert({ table_id: tableId, name: parsed.data.name, type: parsed.data.type, config: cfg.config, order_key: orderKey, created_by: g.userId })
    .select('id')
    .single();
  if (error) return { ok: false, error: error.message };
  await recordAudit({ actor_id: g.userId, entity_kind: 'supabase', entity_ref: `nt_columns:${data.id}`, action: 'create', diff: { table_id: tableId, name: parsed.data.name, type: parsed.data.type } });
  revalidatePath('/data/bases');
  return { ok: true, id: data.id };
}

export async function updateColumn(columnId: string, input: { name?: string; type?: ColumnType; config?: Record<string, unknown>; is_hidden?: boolean; width?: number; order_key?: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const supabase = await createClient();
  const existing = await supabase.from('nt_columns').select('id, table_id, name, type').eq('id', columnId).single();
  if (existing.error || !existing.data) return { ok: false, error: 'Column not found.' };
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const n = TableSchema.shape.name.parse(input.name);
    const check = await supabase.from('nt_columns').select('id').eq('table_id', existing.data.table_id).eq('name', n).neq('id', columnId).maybeSingle();
    if (check.data) return { ok: false, error: 'A column with that name already exists.' };
    patch.name = n;
  }
  if (input.type !== undefined) patch.type = input.type;
  if (input.config !== undefined) {
    const cfg = await checkColumnConfig(supabase, (input.type ?? existing.data.type) as ColumnType, input.config);
    if (!cfg.ok) return cfg;
    patch.config = cfg.config;
  }
  if (input.is_hidden !== undefined) patch.is_hidden = input.is_hidden;
  if (input.width !== undefined) patch.width = input.width;
  if (input.order_key !== undefined) patch.order_key = input.order_key;
  if (Object.keys(patch).length === 0) return { ok: true };
  const { error } = await supabase.from('nt_columns').update(patch).eq('id', columnId);
  if (error) return { ok: false, error: error.message };
  await recordAudit({ actor_id: g.userId, entity_kind: 'supabase', entity_ref: `nt_columns:${columnId}`, action: 'update', diff: patch });
  revalidatePath('/data/bases');
  return { ok: true };
}

export async function deleteColumn(columnId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const supabase = await createClient();
  const { error } = await supabase.from('nt_columns').delete().eq('id', columnId);
  if (error) return { ok: false, error: error.message };
  await recordAudit({ actor_id: g.userId, entity_kind: 'supabase', entity_ref: `nt_columns:${columnId}`, action: 'delete' });
  revalidatePath('/data/bases');
  return { ok: true };
}

// ============================================================================
// nt_rows + nt_cells (grid data)
// ============================================================================

// CellValue / ColumnType come from @/lib/native-tables/values (imported above).

export interface GridRow {
  id: string;
  cells: Record<string, CellValue>;
  created_at: string;
  order_key: string;
}

export interface GridColumnInfo {
  id: string;
  name: string;
  type: ColumnType;
  config: Record<string, unknown>;
  width: number;
  is_hidden: boolean;
  order_key: string;
}

export interface GridData {
  columns: GridColumnInfo[];
  rows: GridRow[];
  total_rows: number;
  has_more: boolean;
  /** False when 0109 is not applied yet: filters/sorts/search were ignored and the paged 0096 read was used. */
  server_query: boolean;
  /** Present when the table mirrors an Airtable table (0109 nt_tables.source). */
  source: Record<string, unknown> | null;
}

const RPC_MISSING_RE = /nt_query_rows|schema cache|does not exist|PGRST202/i;

/**
 * Serialization step shared by every grid read: evaluate formula columns and
 * apply `visible_to` audience gating (Beacon pattern: gating happens here,
 * never in the query builder). A column with config.visible_to =
 * ['admin','exec','manager'] is dropped from the payload for a contributor,
 * cells included; the formula evaluator still sees it so totals stay right.
 */
function serializeRows(columns: GridColumnInfo[], rows: Array<{ id: string; created_at: string; order_key: string; cells: Record<string, CellValue> }>, viewerRole: string): { columns: GridColumnInfo[]; rows: GridRow[] } {
  const byName = new Map(columns.map((c) => [c.name, c.id]));
  const formulas = columns
    .filter((c) => c.type === 'formula' && typeof c.config.expression === 'string')
    .map((c) => {
      try {
        return { id: c.id, node: parseFormula(String(c.config.expression)) };
      } catch {
        return { id: c.id, node: null };
      }
    });
  const visible = columns.filter((c) => canSeeColumn(c, viewerRole));
  const visibleIds = new Set(visible.map((c) => c.id));
  const outRows = rows.map((r) => {
    const cells: Record<string, CellValue> = { ...r.cells };
    for (const f of formulas) {
      cells[f.id] = f.node
        ? (evaluateFormula(f.node, (name) => {
          const id = byName.get(name);
          return id ? cellToFormulaValue(cells[id]) : null;
        }) as CellValue)
        : null;
    }
    const gated: Record<string, CellValue> = {};
    for (const [k, v] of Object.entries(cells)) if (visibleIds.has(k)) gated[k] = v;
    return { id: r.id, cells: gated, created_at: r.created_at, order_key: r.order_key };
  });
  return { columns: visible, rows: outRows };
}

function canSeeColumn(c: GridColumnInfo, viewerRole: string): boolean {
  const aud = c.config.visible_to;
  if (!Array.isArray(aud) || aud.length === 0) return true;
  return aud.map(String).includes(viewerRole);
}

async function loadColumns(supabase: Awaited<ReturnType<typeof createClient>>, tableId: string, includeHidden: boolean): Promise<{ ok: true; columns: GridColumnInfo[] } | { ok: false; error: string }> {
  let q = supabase.from('nt_columns').select('id, name, type, config, width, is_hidden, order_key').eq('table_id', tableId);
  if (!includeHidden) q = q.eq('is_hidden', false);
  const { data, error } = await q.order('order_key');
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    columns: (data ?? []).map((c) => ({ id: c.id, name: c.name, type: c.type, config: (c.config ?? {}) as Record<string, unknown>, width: c.width, is_hidden: c.is_hidden, order_key: c.order_key })),
  };
}

export async function getGridData(tableId: string, limit = 100, offset = 0, query: GridQuery = EMPTY_QUERY, includeHidden = false): Promise<{ ok: true; data: GridData } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const supabase = await createClient();
  const table = await supabase.from('nt_tables').select('id, source').eq('id', tableId).maybeSingle();
  if (table.error && !/source/.test(table.error.message)) return { ok: false, error: table.error.message };
  let source: Record<string, unknown> | null = (table.data?.source as Record<string, unknown> | null) ?? null;
  if (table.error) {
    // 0109 not applied: nt_tables.source does not exist yet.
    const t2 = await supabase.from('nt_tables').select('id').eq('id', tableId).maybeSingle();
    if (t2.error || !t2.data) return { ok: false, error: 'Table not found.' };
    source = null;
  } else if (!table.data) {
    return { ok: false, error: 'Table not found.' };
  }
  const colsRes = await loadColumns(supabase, tableId, includeHidden);
  if (!colsRes.ok) return colsRes;
  const columns = colsRes.columns;
  const validated = validateQuery(query, columns);
  if (!validated.ok) return validated;
  const q = validated.query;
  const wantsQuery = !isEmptyQuery(q);

  let rawRows: Array<{ id: string; created_at: string; order_key: string; cells: Record<string, CellValue> }> = [];
  let total = 0;
  let serverQuery = true;

  const rpc = await supabase.rpc('nt_query_rows', { p_table_id: tableId, p_query: toRpcPayload(q), p_limit: limit, p_offset: offset });
  if (rpc.error && RPC_MISSING_RE.test(rpc.error.message)) {
    // 0109 not applied: fall back to the 0096 paged read (no filter/sort/search).
    serverQuery = false;
    const { data: rows, error: rowsError } = await supabase
      .from('nt_rows')
      .select('id, created_at, order_key, nt_cells(column_id, value)')
      .eq('table_id', tableId)
      .order('order_key')
      .order('created_at')
      .order('id')
      .range(offset, offset + limit - 1);
    if (rowsError) return { ok: false, error: rowsError.message };
    const { count } = await supabase.from('nt_rows').select('*', { count: 'exact', head: true }).eq('table_id', tableId);
    total = count ?? 0;
    rawRows = (rows ?? []).map((r) => {
      const cells: Record<string, CellValue> = {};
      for (const cell of (r.nt_cells ?? []) as Array<{ column_id: string; value: CellValue }>) cells[cell.column_id] = cell.value;
      return { id: r.id, created_at: r.created_at, order_key: r.order_key, cells };
    });
  } else if (rpc.error) {
    return { ok: false, error: rpc.error.message };
  } else {
    const data = (rpc.data ?? []) as Array<{ id: string; created_at: string; order_key: string; cells: Record<string, CellValue>; total: number | string }>;
    total = data.length ? Number(data[0].total) : 0;
    rawRows = data.map((r) => ({ id: r.id, created_at: r.created_at, order_key: r.order_key, cells: r.cells ?? {} }));
    if (!wantsQuery && offset === 0 && data.length === 0) total = 0;
  }
  const profile = await getAuthProfile();
  const serialized = serializeRows(columns, rawRows, profile?.role ?? 'contributor');
  return {
    ok: true,
    data: {
      columns: serialized.columns,
      rows: serialized.rows,
      total_rows: total,
      has_more: (offset + limit) < total,
      server_query: serverQuery,
      source,
    },
  };
}

export async function createRow(tableId: string, cellValues: Record<string, CellValue>): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const supabase = await createClient();
  const table = await supabase.from('nt_tables').select('id').eq('id', tableId).single();
  if (table.error || !table.data) return { ok: false, error: 'Table not found.' };
  const { data: row, error: rowError } = await supabase
    .from('nt_rows')
    .insert({ table_id: tableId, created_by: g.userId })
    .select('id')
    .single();
  if (rowError) return { ok: false, error: rowError.message };
  const cells = Object.entries(cellValues).filter(([, v]) => v !== null && v !== undefined);
  if (cells.length > 0) {
    const cellRows = cells.map(([columnId, value]) => ({
      table_id: tableId,
      row_id: row.id,
      column_id: columnId,
      value: value,
      updated_by: g.userId,
    }));
    const { error: cellError } = await supabase.from('nt_cells').insert(cellRows);
    if (cellError) {
      await supabase.from('nt_rows').delete().eq('id', row.id);
      return { ok: false, error: cellError.message };
    }
  }
  await recordAudit({ actor_id: g.userId, entity_kind: 'supabase', entity_ref: `nt_rows:${row.id}`, action: 'create', diff: { table_id: tableId, cell_count: cells.length } });
  revalidatePath('/data/bases');
  return { ok: true, id: row.id };
}

export async function updateCell(tableId: string, rowId: string, columnId: string, value: CellValue): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const supabase = await createClient();
  const col = await supabase.from('nt_columns').select('type, config').eq('id', columnId).eq('table_id', tableId).maybeSingle();
  if (col.error || !col.data) return { ok: false, error: 'Column not found.' };
  if (col.data.type === 'formula') return { ok: false, error: 'Formula columns are read-only.' };
  const checked = await checkRefValue(supabase, col.data.type, (col.data.config ?? {}) as Record<string, unknown>, value);
  if (!checked.ok) return checked;
  value = checked.value;
  if (value === null || value === undefined) {
    const { error } = await supabase
      .from('nt_cells')
      .delete()
      .eq('table_id', tableId)
      .eq('row_id', rowId)
      .eq('column_id', columnId);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase
      .from('nt_cells')
      .upsert({ table_id: tableId, row_id: rowId, column_id: columnId, value, updated_by: g.userId }, { onConflict: 'table_id,row_id,column_id' });
    if (error) return { ok: false, error: error.message };
  }
  await recordAudit({ actor_id: g.userId, entity_kind: 'supabase', entity_ref: `nt_rows:${rowId}:nt_cells:${columnId}`, action: value === null ? 'delete' : 'update', diff: { table_id: tableId, row_id: rowId, column_id: columnId } });
  revalidatePath('/data/bases');
  return { ok: true };
}

export async function deleteRow(tableId: string, rowId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const supabase = await createClient();
  const { error } = await supabase
    .from('nt_rows')
    .delete()
    .eq('id', rowId)
    .eq('table_id', tableId);
  if (error) return { ok: false, error: error.message };
  await recordAudit({ actor_id: g.userId, entity_kind: 'supabase', entity_ref: `nt_rows:${rowId}`, action: 'delete', diff: { table_id: tableId } });
  revalidatePath('/data/bases');
  return { ok: true };
}

// ============================================================================
// Import (reuses Module 4 CSV parser)
// ============================================================================

export async function importCsv(tableId: string, fileContent: string, hasHeader = true): Promise<{ ok: true; columns_created: number; columns_mapped: number; rows_created: number; cells_written: number; cells_skipped: number } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const supabase = await createClient();
  const table = await supabase.from('nt_tables').select('id').eq('id', tableId).single();
  if (table.error || !table.data) return { ok: false, error: 'Table not found.' };
  let parsed;
  try {
    parsed = parseCsv(fileContent);
  } catch (e) {
    return { ok: false, error: `CSV parse error: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (parsed.headers.length === 0) return { ok: false, error: 'The CSV file has no header row.' };
  if (parsed.rows.length === 0) return { ok: false, error: 'The CSV file has a header row and no data rows.' };
  if (parsed.headers.length > 50) return { ok: false, error: 'CSV has more than 50 columns.' };
  if (parsed.rows.length > 10000) return { ok: false, error: 'CSV has more than 10,000 rows.' };

  const dataRows = hasHeader ? parsed.rows.slice(1) : parsed.rows;
  const columnCount = hasHeader ? parsed.headers.length : Math.max(0, ...parsed.rows.map((r) => r.length));
  const effectiveHeaders = hasHeader ? parsed.headers : Array.from({ length: columnCount }, (_, i) => `Column ${i + 1}`);

  const existingColsResult = await supabase
    .from('nt_columns')
    .select('id, name, type')
    .eq('table_id', tableId);
  if (existingColsResult.error) return { ok: false, error: 'Failed to read columns.' };
  const existingByName = new Map((existingColsResult.data ?? []).map((c) => [String(c.name).toLowerCase(), c]));
  const columnsToUse: Array<{ id: string; name: string; type: ColumnType; is_new: boolean }> = [];
  let columnsCreated = 0;

  for (let i = 0; i < effectiveHeaders.length; i++) {
    const name = effectiveHeaders[i].trim() || `Column ${i + 1}`;
    const existing = existingByName.get(name.toLowerCase());
    if (existing) {
      columnsToUse.push({ id: existing.id, name: existing.name, type: existing.type, is_new: false });
    } else {
      const sampleValues = dataRows.slice(0, 10).map((r) => r[i] ?? '');
      const inferredType = inferColumnType(sampleValues);
      const { data: newCol, error: colError } = await supabase
        .from('nt_columns')
        .insert({
          table_id: tableId,
          name,
          type: inferredType,
          config: inferredType === 'select' ? { options: [] } : {},
          created_by: g.userId,
        })
        .select('id, type')
        .single();
      if (colError) return { ok: false, error: `Failed to create column "${name}": ${colError.message}` };
      columnsToUse.push({ id: newCol.id, name, type: newCol.type, is_new: true });
      columnsCreated++;
    }
  }

  let rowsCreated = 0;
  let cellsWritten = 0;
  let cellsSkipped = 0;

  // Bulk path: one insert per chunk of rows, one per chunk of cells. The
  // previous per-cell round trip was 10k rows x 50 cols = 500k requests.
  const nonEmptyRows = dataRows.filter((row) => !row.every((v) => v.trim() === ''));
  const ROW_CHUNK = 500;
  const CELL_CHUNK = 1000;
  for (let start = 0; start < nonEmptyRows.length; start += ROW_CHUNK) {
    const chunk = nonEmptyRows.slice(start, start + ROW_CHUNK);
    const { data: newRows, error: rowError } = await supabase
      .from('nt_rows')
      .insert(chunk.map(() => ({ table_id: tableId, created_by: g.userId })))
      .select('id');
    if (rowError || !newRows || newRows.length !== chunk.length) {
      return { ok: false, error: `Failed to create rows: ${rowError?.message ?? 'row count mismatch'}` };
    }
    rowsCreated += newRows.length;

    const cellRows: Array<{ table_id: string; row_id: string; column_id: string; value: CellValue; updated_by: string }> = [];
    chunk.forEach((row, ri) => {
      for (let i = 0; i < columnsToUse.length; i++) {
        const raw = row[i] ?? '';
        if (raw.trim() === '') continue;
        const coerced = coerceValue(columnsToUse[i].type, raw);
        if (coerced === null) {
          cellsSkipped++;
          continue;
        }
        cellRows.push({ table_id: tableId, row_id: newRows[ri].id, column_id: columnsToUse[i].id, value: coerced, updated_by: g.userId });
      }
    });
    for (let cs = 0; cs < cellRows.length; cs += CELL_CHUNK) {
      const slice = cellRows.slice(cs, cs + CELL_CHUNK);
      const { error: cellError } = await supabase.from('nt_cells').insert(slice);
      if (cellError) {
        cellsSkipped += slice.length;
        continue;
      }
      cellsWritten += slice.length;
    }
  }

  await recordAudit({
    actor_id: g.userId,
    entity_kind: 'supabase',
    entity_ref: `nt_tables:${tableId}`,
    action: 'import_csv',
    diff: { columns_created: columnsCreated, columns_mapped: columnsToUse.length - columnsCreated, rows_created: rowsCreated, cells_written: cellsWritten, cells_skipped: cellsSkipped },
  });
  revalidatePath('/data/bases');
  return { ok: true, columns_created: columnsCreated, columns_mapped: columnsToUse.length - columnsCreated, rows_created: rowsCreated, cells_written: cellsWritten, cells_skipped: cellsSkipped };
}

// ============================================================================
// Phase 3: row reorder (one fractional key per move) + TSV paste
// ============================================================================

/**
 * Move a row between two neighbours. The client sends the ids of the rows
 * that will sit before/after the moved row in the CURRENT unfiltered order
 * (null = start/end). Exactly one order_key is written; when the neighbours
 * still share the 'z' default the table is renumbered once via
 * nt_renumber_rows() (0109) and the move retried.
 */
export async function moveRow(tableId: string, rowId: string, beforeRowId: string | null, afterRowId: string | null): Promise<{ ok: true; order_key: string; renumbered: boolean } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const supabase = await createClient();
  const ids = [rowId, beforeRowId, afterRowId].filter((x): x is string => Boolean(x));
  const load = async () => {
    const { data, error } = await supabase.from('nt_rows').select('id, order_key').eq('table_id', tableId).in('id', ids);
    if (error) return { ok: false as const, error: error.message };
    const m = new Map((data ?? []).map((r) => [r.id, r.order_key]));
    if (!m.has(rowId)) return { ok: false as const, error: 'Row not found.' };
    if ((beforeRowId && !m.has(beforeRowId)) || (afterRowId && !m.has(afterRowId))) return { ok: false as const, error: 'Neighbour row not found.' };
    return { ok: true as const, before: beforeRowId ? m.get(beforeRowId)! : null, after: afterRowId ? m.get(afterRowId)! : null };
  };
  let keys = await load();
  if (!keys.ok) return keys;
  let renumbered = false;
  let key: string;
  try {
    key = keyBetween(keys.before, keys.after);
  } catch {
    // Neighbours tie (fresh table, every row still 'z') or the gap is not
    // representable: renumber once (0109) and retry with real keys.
    const r = await supabase.rpc('nt_renumber_rows', { p_table_id: tableId });
    if (r.error) return { ok: false, error: RPC_MISSING_RE.test(r.error.message) ? 'Row reorder needs migration 0109 (pending apply).' : r.error.message };
    renumbered = true;
    keys = await load();
    if (!keys.ok) return keys;
    try {
      key = keyBetween(keys.before, keys.after);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Could not compute a position.' };
    }
  }
  const { error } = await supabase.from('nt_rows').update({ order_key: key }).eq('id', rowId).eq('table_id', tableId);
  if (error) return { ok: false, error: error.message };
  await recordAudit({ actor_id: g.userId, entity_kind: 'supabase', entity_ref: `nt_rows:${rowId}`, action: 'reorder', diff: { table_id: tableId, order_key: key, renumbered } });
  return { ok: true, order_key: key, renumbered };
}

/**
 * Paste a TSV block starting at (rowId, columnId) in the visible column
 * order. Overflowing rows are created; overflowing columns are ignored.
 * Values go through coerceValue() for the target column's type; formula and
 * reference columns are skipped (they need the picker).
 */
export async function pasteCells(tableId: string, startRowId: string, startColumnId: string, tsv: string, visibleRowIds: string[], visibleColumnIds: string[]): Promise<{ ok: true; cells_written: number; rows_created: number; cells_skipped: number } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  if (tsv.length > 500_000) return { ok: false, error: 'Paste is too large (500 KB max).' };
  const supabase = await createClient();
  const colsRes = await loadColumns(supabase, tableId, false);
  if (!colsRes.ok) return colsRes;
  const colById = new Map(colsRes.columns.map((c) => [c.id, c]));
  const colOrder = visibleColumnIds.filter((id) => colById.has(id));
  const ci = colOrder.indexOf(startColumnId);
  const ri = visibleRowIds.indexOf(startRowId);
  if (ci < 0 || ri < 0) return { ok: false, error: 'Paste anchor is not in the grid.' };
  const lines = tsv.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (lines.length === 0) return { ok: true, cells_written: 0, rows_created: 0, cells_skipped: 0 };
  if (lines.length > 2000) return { ok: false, error: 'Paste at most 2,000 rows at a time.' };
  const grid = lines.map((l) => l.split('\t'));

  // Verify the anchor rows belong to this table (ids come from the client).
  const targetRowIds = visibleRowIds.slice(ri, ri + grid.length);
  const { data: owned } = await supabase.from('nt_rows').select('id').eq('table_id', tableId).in('id', targetRowIds);
  const ownedSet = new Set((owned ?? []).map((r) => r.id));
  const rowIds: string[] = targetRowIds.filter((id) => ownedSet.has(id));
  let rowsCreated = 0;
  const missing = grid.length - rowIds.length;
  if (missing > 0) {
    const { data: newRows, error } = await supabase.from('nt_rows').insert(Array.from({ length: missing }, () => ({ table_id: tableId, created_by: g.userId }))).select('id');
    if (error || !newRows) return { ok: false, error: error?.message ?? 'Could not add rows.' };
    rowIds.push(...newRows.map((r) => r.id));
    rowsCreated = newRows.length;
  }

  const upserts: Array<{ table_id: string; row_id: string; column_id: string; value: CellValue; updated_by: string }> = [];
  const deletes: Array<{ row_id: string; column_id: string }> = [];
  let skipped = 0;
  grid.forEach((line, r) => {
    line.forEach((raw, c) => {
      const colId = colOrder[ci + c];
      if (!colId) return;
      const col = colById.get(colId)!;
      if (col.type === 'formula' || col.type === 'link' || col.type === 'user' || col.type === 'brand') { skipped++; return; }
      if (raw.trim() === '') { deletes.push({ row_id: rowIds[r], column_id: colId }); return; }
      const v = coerceValue(col.type, raw);
      if (v === null) { skipped++; return; }
      upserts.push({ table_id: tableId, row_id: rowIds[r], column_id: colId, value: v, updated_by: g.userId });
    });
  });
  let written = 0;
  for (let i = 0; i < upserts.length; i += 1000) {
    const slice = upserts.slice(i, i + 1000);
    const { error } = await supabase.from('nt_cells').upsert(slice, { onConflict: 'table_id,row_id,column_id' });
    if (error) return { ok: false, error: error.message };
    written += slice.length;
  }
  for (const d of deletes) {
    await supabase.from('nt_cells').delete().eq('table_id', tableId).eq('row_id', d.row_id).eq('column_id', d.column_id);
  }
  await recordAudit({ actor_id: g.userId, entity_kind: 'supabase', entity_ref: `nt_tables:${tableId}`, action: 'paste', diff: { cells_written: written, rows_created: rowsCreated, cells_skipped: skipped, cells_cleared: deletes.length } });
  revalidatePath('/data/bases');
  return { ok: true, cells_written: written, rows_created: rowsCreated, cells_skipped: skipped };
}

// ============================================================================
// Phase 4: pickers for link / user / brand columns
// ============================================================================

export interface PickerOption { id: string; label: string; hint?: string }

/** Rows of a link column's target table for the picker: first text-like column as the label. */
export async function searchLinkTargets(targetTableId: string, q: string, limit = 25): Promise<{ ok: true; options: PickerOption[]; label_column: string | null } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const supabase = await createClient();
  const colsRes = await loadColumns(supabase, targetTableId, false);
  if (!colsRes.ok) return colsRes;
  const labelCol = colsRes.columns.find((c) => ['text', 'email', 'url', 'phone'].includes(c.type)) ?? colsRes.columns[0] ?? null;
  const query: GridQuery = { ...EMPTY_QUERY, search: q.trim() };
  const res = await getGridData(targetTableId, limit, 0, query);
  if (!res.ok) return res;
  const options = res.data.rows.map((r) => {
    const raw = labelCol ? r.cells[labelCol.id] : null;
    const label = raw == null ? '' : Array.isArray(raw) ? raw.join(', ') : typeof raw === 'object' ? String((raw as { name?: unknown }).name ?? '') : String(raw);
    return { id: r.id, label: label || `(row ${r.id.slice(0, 8)})` };
  });
  const filtered = res.data.server_query || !q.trim() ? options : options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()));
  return { ok: true, options: filtered, label_column: labelCol?.name ?? null };
}

/** Labels for already-linked row ids (so a link cell renders names, not uuids). */
export async function resolveLinkLabels(targetTableId: string, rowIds: string[]): Promise<{ ok: true; labels: Record<string, string> } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  if (rowIds.length === 0) return { ok: true, labels: {} };
  const supabase = await createClient();
  const colsRes = await loadColumns(supabase, targetTableId, false);
  if (!colsRes.ok) return colsRes;
  const labelCol = colsRes.columns.find((c) => ['text', 'email', 'url', 'phone'].includes(c.type)) ?? colsRes.columns[0] ?? null;
  if (!labelCol) return { ok: true, labels: Object.fromEntries(rowIds.map((id) => [id, `(row ${id.slice(0, 8)})`])) };
  const { data, error } = await supabase.from('nt_cells').select('row_id, value').eq('table_id', targetTableId).eq('column_id', labelCol.id).in('row_id', rowIds.slice(0, 200));
  if (error) return { ok: false, error: error.message };
  const labels: Record<string, string> = {};
  for (const id of rowIds) labels[id] = `(row ${id.slice(0, 8)})`;
  for (const c of data ?? []) labels[c.row_id] = String(c.value ?? '') || labels[c.row_id];
  return { ok: true, labels };
}

export async function searchUsers(q: string, limit = 25): Promise<{ ok: true; options: PickerOption[] } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const supabase = await createClient();
  let query = supabase.from('profiles').select('id, first_name, last_name, email').eq('is_active', true).order('first_name').limit(limit);
  const s = q.trim();
  if (s) query = query.or(`first_name.ilike.%${s.replace(/[%,]/g, '')}%,last_name.ilike.%${s.replace(/[%,]/g, '')}%,email.ilike.%${s.replace(/[%,]/g, '')}%`);
  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };
  return { ok: true, options: (data ?? []).map((p) => ({ id: p.id, label: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email, hint: p.email })) };
}

export async function searchBrands(q: string, limit = 25): Promise<{ ok: true; options: PickerOption[] } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const supabase = await createClient();
  let query = supabase.from('brands').select('id, brand_name, active').order('brand_name').limit(limit);
  const s = q.trim();
  if (s) query = query.ilike('brand_name', `%${s.replace(/%/g, '')}%`);
  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };
  return { ok: true, options: (data ?? []).map((b) => ({ id: b.id, label: b.brand_name, hint: b.active === false ? 'inactive' : undefined })) };
}

// ============================================================================
// Phase 5: saved views (nt_views, 0109)
// ============================================================================

export interface ViewInfo {
  id: string;
  table_id: string;
  name: string;
  kind: 'grid' | 'kanban';
  query: GridQuery;
  hidden_column_ids: string[];
  group_by_column_id: string | null;
  created_at: string;
}

function rowToView(v: Record<string, unknown>): ViewInfo {
  const q = (v.query ?? {}) as Partial<GridQuery>;
  return {
    id: String(v.id),
    table_id: String(v.table_id),
    name: String(v.name),
    kind: v.kind === 'kanban' ? 'kanban' : 'grid',
    query: { filters: Array.isArray(q.filters) ? q.filters : [], conjunction: q.conjunction === 'or' ? 'or' : 'and', sorts: Array.isArray(q.sorts) ? q.sorts : [], search: typeof q.search === 'string' ? q.search : '' },
    hidden_column_ids: Array.isArray(v.hidden_column_ids) ? v.hidden_column_ids.map(String) : [],
    group_by_column_id: v.group_by_column_id ? String(v.group_by_column_id) : null,
    created_at: String(v.created_at),
  };
}

export async function listViews(tableId: string): Promise<{ ok: true; views: ViewInfo[]; available: boolean } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const supabase = await createClient();
  const { data, error } = await supabase.from('nt_views').select('*').eq('table_id', tableId).order('order_key').order('created_at');
  if (error) {
    if (RPC_MISSING_RE.test(error.message) || /nt_views/.test(error.message)) return { ok: true, views: [], available: false };
    return { ok: false, error: error.message };
  }
  return { ok: true, views: (data ?? []).map((v) => rowToView(v as Record<string, unknown>)), available: true };
}

const ViewSchema = z.object({
  name: z.string().min(1).max(255),
  kind: z.enum(['grid', 'kanban']).default('grid'),
  hidden_column_ids: z.array(z.string().uuid()).default([]),
  group_by_column_id: z.string().uuid().nullable().default(null),
});

export async function saveView(tableId: string, input: { id?: string; name: string; kind?: 'grid' | 'kanban'; query: GridQuery; hidden_column_ids?: string[]; group_by_column_id?: string | null }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const supabase = await createClient();
  const parsed = ViewSchema.safeParse({ name: input.name, kind: input.kind ?? 'grid', hidden_column_ids: input.hidden_column_ids ?? [], group_by_column_id: input.group_by_column_id ?? null });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid view.' };
  const colsRes = await loadColumns(supabase, tableId, true);
  if (!colsRes.ok) return colsRes;
  const validated = validateQuery(input.query, colsRes.columns);
  if (!validated.ok) return validated;
  const colIds = new Set(colsRes.columns.map((c) => c.id));
  if (parsed.data.hidden_column_ids.some((id) => !colIds.has(id))) return { ok: false, error: 'Hidden column is not in this table.' };
  if (parsed.data.kind === 'kanban') {
    const gb = colsRes.columns.find((c) => c.id === parsed.data.group_by_column_id);
    if (!gb || gb.type !== 'select') return { ok: false, error: 'Kanban views group by a select column.' };
  }
  const payload = { table_id: tableId, name: parsed.data.name, kind: parsed.data.kind, query: validated.query, hidden_column_ids: parsed.data.hidden_column_ids, group_by_column_id: parsed.data.kind === 'kanban' ? parsed.data.group_by_column_id : null };
  if (input.id) {
    const { error } = await supabase.from('nt_views').update(payload).eq('id', input.id).eq('table_id', tableId);
    if (error) return { ok: false, error: error.message };
    await recordAudit({ actor_id: g.userId, entity_kind: 'supabase', entity_ref: `nt_views:${input.id}`, action: 'update', diff: { name: payload.name, kind: payload.kind } });
    return { ok: true, id: input.id };
  }
  const { data, error } = await supabase.from('nt_views').insert({ ...payload, created_by: g.userId }).select('id').single();
  if (error) return { ok: false, error: /duplicate|unique/i.test(error.message) ? 'A view with that name already exists.' : RPC_MISSING_RE.test(error.message) || /nt_views/.test(error.message) ? 'Saved views need migration 0109 (pending apply).' : error.message };
  await recordAudit({ actor_id: g.userId, entity_kind: 'supabase', entity_ref: `nt_views:${data.id}`, action: 'create', diff: { table_id: tableId, name: payload.name, kind: payload.kind } });
  return { ok: true, id: data.id };
}

export async function deleteView(viewId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const supabase = await createClient();
  const { error } = await supabase.from('nt_views').delete().eq('id', viewId);
  if (error) return { ok: false, error: error.message };
  await recordAudit({ actor_id: g.userId, entity_kind: 'supabase', entity_ref: `nt_views:${viewId}`, action: 'delete' });
  return { ok: true };
}

// ============================================================================
// Phase 6: mirror an Airtable table into a native table (lib/data adapter)
// ============================================================================

export interface MirrorResult {
  table_id: string;
  columns_created: number;
  rows_created: number;
  cells_written: number;
  links_unresolved: number;
  records_read: number;
}

/**
 * One-click mirror: reads the Airtable table schema + every record through
 * the existing adapter, creates a native table (or refreshes one already
 * mirrored from the same source), maps field types via airtableMirror.ts,
 * and bulk-inserts rows/cells. Link fields resolve to native row ids when
 * their target table has already been mirrored (config.target_airtable_table_id
 * matches another nt_tables.source.table_id); otherwise they stay empty and
 * are counted in links_unresolved so the caller can mirror the target and
 * re-run. Re-running replaces the rows (snapshot semantics), never merges.
 */
export async function mirrorAirtableTable(baseId: string, airtableTableId: string, opts: { name?: string; maxRecords?: number } = {}): Promise<{ ok: true; result: MirrorResult } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  if (isSensitiveBase(baseId) && !canManagePeople(await loadSensitiveAccessContext())) return { ok: false, error: 'That base is restricted to people managers.' };
  const supabase = await createClient();
  const maxRecords = Math.min(Math.max(opts.maxRecords ?? 50_000, 1), 50_000);

  let adapter;
  try {
    adapter = getAdapter();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Airtable is not configured.' };
  }
  let schema;
  try {
    schema = await adapter.getBaseSchema(baseId);
  } catch (e) {
    return { ok: false, error: e instanceof DataAdapterError ? e.message : String(e) };
  }
  const at = schema.tables.find((t) => t.id === airtableTableId || t.name === airtableTableId);
  if (!at) return { ok: false, error: 'Airtable table not found in that base.' };

  // Existing mirror of the same source? Refresh it in place.
  const existing = await supabase.from('nt_tables').select('id, source').contains('source', { kind: 'airtable', base_id: baseId, table_id: at.id }).maybeSingle();
  if (existing.error && /source/.test(existing.error.message)) return { ok: false, error: 'Airtable mirroring needs migration 0109 (pending apply).' };
  let tableId: string;
  const name = (opts.name ?? `${schema.name} / ${at.name}`).slice(0, 255);
  if (!existing.data?.id) {
    const { data, error } = await supabase.from('nt_tables').insert({ name, description: `Mirrored from Airtable ${schema.name} (${baseId}) table ${at.name} (${at.id}).`, created_by: g.userId }).select('id').single();
    if (error) return { ok: false, error: error.message };
    tableId = data.id;
  } else {
    tableId = existing.data.id as string;
    // Snapshot semantics: drop the previous rows, keep column ids stable.
    const { error } = await supabase.from('nt_rows').delete().eq('table_id', tableId);
    if (error) return { ok: false, error: error.message };
  }

  // Columns: reuse by airtable_field_id, create the rest.
  const specs: MirrorColumnSpec[] = at.fields.filter(isMirrorable).map(mapField);
  const existingCols = await supabase.from('nt_columns').select('id, name, config').eq('table_id', tableId);
  if (existingCols.error) return { ok: false, error: existingCols.error.message };
  const byFieldId = new Map<string, string>();
  const usedNames = new Set<string>();
  for (const c of existingCols.data ?? []) {
    usedNames.add(String(c.name).toLowerCase());
    const fid = (c.config as { airtable_field_id?: string } | null)?.airtable_field_id;
    if (fid) byFieldId.set(fid, c.id);
  }
  // Other mirrored tables, for link resolution.
  const mirrored = await supabase.from('nt_tables').select('id, source').not('source', 'is', null);
  const nativeByAirtableTable = new Map<string, string>();
  for (const t of mirrored.data ?? []) {
    const src = t.source as { kind?: string; table_id?: string } | null;
    if (src?.kind === 'airtable' && src.table_id) nativeByAirtableTable.set(src.table_id, t.id);
  }
  let columnsCreated = 0;
  const colIdBySpec = new Map<string, string>();
  for (const spec of specs) {
    let nm = spec.name;
    const config = { ...spec.config };
    if (spec.type === 'link') {
      const target = nativeByAirtableTable.get(String(config.target_airtable_table_id ?? ''));
      if (target) config.target_table_id = target;
    }
    const have = byFieldId.get(spec.airtable_field_id);
    if (have) {
      await supabase.from('nt_columns').update({ config }).eq('id', have);
      colIdBySpec.set(spec.airtable_field_id, have);
      continue;
    }
    let n = 2;
    while (usedNames.has(nm.toLowerCase())) nm = `${spec.name} (${n++})`.slice(0, 255);
    usedNames.add(nm.toLowerCase());
    // Link columns without a mirrored target fall back to text snapshots so the
    // column config passes the same validation the UI editor goes through.
    const type: ColumnType = spec.type === 'link' && !config.target_table_id ? 'text' : spec.type;
    const { data, error } = await supabase.from('nt_columns').insert({ table_id: tableId, name: nm, type, config, created_by: g.userId }).select('id').single();
    if (error) return { ok: false, error: `Column "${nm}": ${error.message}` };
    colIdBySpec.set(spec.airtable_field_id, data.id);
    columnsCreated++;
  }
  const colTypes = new Map<string, ColumnType>();
  {
    const { data } = await supabase.from('nt_columns').select('id, type').eq('table_id', tableId);
    for (const c of data ?? []) colTypes.set(c.id, c.type);
  }

  // Records: page through Airtable (noCache so iterators stay valid).
  const records: Array<{ id: string; fields: Record<string, unknown> }> = [];
  let cursor: string | undefined;
  try {
    do {
      const page = await adapter.list(baseId, at.id, { pageSize: 100, cursor, noCache: true });
      records.push(...page.rows.map((r) => ({ id: r.id, fields: r.fields })));
      cursor = page.cursor;
    } while (cursor && records.length < maxRecords);
  } catch (e) {
    return { ok: false, error: `Airtable read failed after ${records.length} records: ${e instanceof DataAdapterError ? e.message : String(e)}` };
  }

  // Rows: create in chunks, remember airtable record id -> native row id.
  const rowIdByRecord = new Map<string, string>();
  let rowsCreated = 0;
  for (let i = 0; i < records.length; i += 500) {
    const chunk = records.slice(i, i + 500);
    const { data, error } = await supabase.from('nt_rows').insert(chunk.map(() => ({ table_id: tableId, created_by: g.userId }))).select('id');
    if (error || !data || data.length !== chunk.length) return { ok: false, error: `Row insert failed: ${error?.message ?? 'count mismatch'}` };
    chunk.forEach((r, k) => rowIdByRecord.set(r.id, data[k].id));
    rowsCreated += data.length;
  }
  // Cross-table link resolution needs the target's record->row map; build lazily.
  const targetMaps = new Map<string, Map<string, string>>();
  const targetMap = async (nativeTableId: string): Promise<Map<string, string>> => {
    const cached = targetMaps.get(nativeTableId);
    if (cached) return cached;
    const m = new Map<string, string>();
    const { data: cols } = await supabase.from('nt_columns').select('id').eq('table_id', nativeTableId).contains('config', { airtable_record_id: true }).limit(1);
    const idCol = cols?.[0]?.id;
    if (idCol) {
      const { data } = await supabase.from('nt_cells').select('row_id, value').eq('table_id', nativeTableId).eq('column_id', idCol);
      for (const c of data ?? []) m.set(String(c.value), c.row_id);
    }
    targetMaps.set(nativeTableId, m);
    return m;
  };
  // Keep the Airtable record id on each row (hidden column) so links from
  // other mirrors can resolve to this table and re-runs stay traceable.
  let recIdCol = (existingCols.data ?? []).find((c) => (c.config as { airtable_record_id?: boolean } | null)?.airtable_record_id)?.id;
  if (!recIdCol) {
    let nm = 'Airtable record id';
    let n = 2;
    while (usedNames.has(nm.toLowerCase())) nm = `Airtable record id (${n++})`;
    const { data, error } = await supabase.from('nt_columns').insert({ table_id: tableId, name: nm, type: 'text', config: { airtable_record_id: true }, is_hidden: true, created_by: g.userId }).select('id').single();
    if (error) return { ok: false, error: error.message };
    recIdCol = data.id;
    columnsCreated++;
  }

  let cellsWritten = 0;
  let linksUnresolved = 0;
  const cellRows: Array<{ table_id: string; row_id: string; column_id: string; value: CellValue; updated_by: string }> = [];
  for (const rec of records) {
    const rowId = rowIdByRecord.get(rec.id)!;
    cellRows.push({ table_id: tableId, row_id: rowId, column_id: recIdCol, value: rec.id, updated_by: g.userId });
    for (const spec of specs) {
      const colId = colIdBySpec.get(spec.airtable_field_id);
      if (!colId) continue;
      const raw = rec.fields[spec.airtable_field_name];
      const effectiveType = colTypes.get(colId) ?? spec.type;
      let value: CellValue | null;
      if (spec.type === 'link' && effectiveType === 'link') {
        const nativeTarget = nativeByAirtableTable.get(String(spec.config.target_airtable_table_id ?? ''));
        const m = nativeTarget ? await targetMap(nativeTarget) : new Map<string, string>();
        const ids = Array.isArray(raw) ? raw.map(String) : [];
        const resolved = ids.map((i) => m.get(i)).filter((x): x is string => Boolean(x));
        linksUnresolved += ids.length - resolved.length;
        value = resolved.length ? resolved : null;
      } else if (spec.type === 'link') {
        // Target not mirrored: snapshot the record ids as text.
        value = Array.isArray(raw) && raw.length ? raw.map(String).join(', ') : null;
        linksUnresolved += Array.isArray(raw) ? raw.length : 0;
      } else {
        value = mapCell({ ...spec, type: effectiveType }, raw);
      }
      if (value === null) continue;
      cellRows.push({ table_id: tableId, row_id: rowId, column_id: colId, value, updated_by: g.userId });
    }
  }
  for (let i = 0; i < cellRows.length; i += 1000) {
    const slice = cellRows.slice(i, i + 1000);
    const { error } = await supabase.from('nt_cells').insert(slice);
    if (error) return { ok: false, error: `Cell insert failed at ${i}: ${error.message}` };
    cellsWritten += slice.length;
  }

  const source = { kind: 'airtable', base_id: baseId, base_name: schema.name, table_id: at.id, table_name: at.name, mirrored_at: new Date().toISOString(), record_count: records.length, mirrored_by: g.userId };
  const upd = await supabase.from('nt_tables').update({ source, name: existing.data ? undefined : name }).eq('id', tableId);
  if (upd.error) return { ok: false, error: upd.error.message };
  await recordAudit({ actor_id: g.userId, entity_kind: 'supabase', entity_ref: `nt_tables:${tableId}`, action: 'mirror_airtable', diff: { base_id: baseId, airtable_table_id: at.id, columns_created: columnsCreated, rows_created: rowsCreated, cells_written: cellsWritten, links_unresolved: linksUnresolved } });
  revalidatePath('/data/bases');
  revalidatePath('/data');
  return { ok: true, result: { table_id: tableId, columns_created: columnsCreated, rows_created: rowsCreated, cells_written: cellsWritten, links_unresolved: linksUnresolved, records_read: records.length } };
}

/** Airtable tables of one base, for the mirror picker (sensitive bases gated like /data/[baseId]). */
export async function listAirtableTables(baseId: string): Promise<{ ok: true; base_name: string; tables: Array<{ id: string; name: string; field_count: number; mirrored_table_id: string | null }> } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  if (isSensitiveBase(baseId) && !canManagePeople(await loadSensitiveAccessContext())) return { ok: false, error: 'That base is restricted to people managers.' };
  try {
    const schema = await getAdapter().getBaseSchema(baseId);
    const supabase = await createClient();
    const mirrored = await supabase.from('nt_tables').select('id, source').not('source', 'is', null);
    const byAt = new Map<string, string>();
    for (const t of mirrored.data ?? []) {
      const src = t.source as { kind?: string; table_id?: string } | null;
      if (src?.kind === 'airtable' && src.table_id) byAt.set(src.table_id, t.id);
    }
    return { ok: true, base_name: schema.name, tables: schema.tables.map((t) => ({ id: t.id, name: t.name, field_count: t.fields.length, mirrored_table_id: byAt.get(t.id) ?? null })) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ============================================================================
// Helpers live in @/lib/native-tables/* (pure, unit-tested).
// ============================================================================


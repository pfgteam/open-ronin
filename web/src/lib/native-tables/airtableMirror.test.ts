import { describe, it, expect } from 'vitest';
import { mapField, mapCell, isMirrorable } from './airtableMirror';
import type { FieldSchema } from '@/lib/data/adapter';

const f = (type: FieldSchema['type'], options?: Record<string, unknown>): FieldSchema => ({ id: `fld_${type}`, name: `F ${type}`, type, options });

describe('airtableMirror', () => {
  it('maps field types onto the nt_column_type enum with config', () => {
    expect(mapField(f('singleLineText')).type).toBe('text');
    expect(mapField(f('multilineText')).type).toBe('long_text');
    expect(mapField(f('checkbox')).type).toBe('boolean');
    expect(mapField(f('dateTime')).type).toBe('datetime');
    const sel = mapField(f('multipleSelects', { choices: [{ name: 'A' }, { name: 'B' }] }));
    expect(sel.type).toBe('select');
    expect(sel.config.options).toEqual(['A', 'B']);
    expect(sel.config.multiple).toBe(true);
    const cur = mapField(f('currency', { symbol: '$' }));
    expect(cur.type).toBe('currency');
    expect(cur.config.currency).toBe('USD');
    const link = mapField(f('multipleRecordLinks', { linkedTableId: 'tblX' }));
    expect(link.type).toBe('link');
    expect(link.config.target_airtable_table_id).toBe('tblX');
    const formula = mapField(f('formula'));
    expect(formula.type).toBe('text');
    expect(formula.config.airtable_computed).toBe(true);
    expect(mapField(f('lastModifiedBy')).type).toBe('text');
    expect(isMirrorable(f('button'))).toBe(false);
  });

  it('maps record values to cell JSON', () => {
    expect(mapCell(mapField(f('number')), 12)).toBe(12);
    expect(mapCell(mapField(f('number')), '')).toBeNull();
    expect(mapCell(mapField(f('checkbox')), true)).toBe(true);
    expect(mapCell(mapField(f('checkbox')), undefined)).toBeNull();
    expect(mapCell(mapField(f('date')), '2026-09-01')).toBe('2026-09-01T00:00:00.000Z');
    expect(mapCell(mapField(f('singleSelect')), 'Open')).toEqual(['Open']);
    expect(mapCell(mapField(f('multipleSelects')), ['A', 'B'])).toEqual(['A', 'B']);
    expect(mapCell(mapField(f('multipleAttachments')), [{ url: 'https://x/y.png' }])).toBe('https://x/y.png');
    expect(mapCell(mapField(f('singleCollaborator')), { id: 'usr', email: 'a@b.c', name: 'Ada' })).toBe('Ada');
    expect(mapCell(mapField(f('multipleLookupValues')), ['x', 'y'])).toBe('x, y');
  });

  it('link cells resolve through the id map and drop unknown targets', () => {
    const link = mapField(f('multipleRecordLinks', { linkedTableId: 'tblX' }));
    const resolve = (ids: string[]) => ids.filter((i) => i === 'recA').map(() => 'uuid-a');
    expect(mapCell(link, ['recA', 'recZ'], resolve)).toEqual(['uuid-a']);
    expect(mapCell(link, ['recZ'], resolve)).toBeNull();
    expect(mapCell(link, ['recA'])).toBeNull();
  });
});

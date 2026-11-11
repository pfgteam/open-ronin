// The merge queue moved to Admin → Prospects → Duplicates (spec 2026-10-19 §11).
import { redirect } from 'next/navigation';

export default function DuplicatesMoved() {
	redirect('/admin/prospects/duplicates');
}

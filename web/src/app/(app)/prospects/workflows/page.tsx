// Prospect automation rules are created and edited in Data → Pipeline; the
// read-only diagram that lived here was a dead end for most readers (spec
// 2026-10-19 §8).
import { redirect } from 'next/navigation';

export default function WorkflowsMoved() {
	redirect('/data/pipeline');
}

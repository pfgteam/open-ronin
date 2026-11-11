'use server';

// Survivors of the retired /the-work/my-work and /the-work/projects routes
// (both consolidated into Home + /the-work/priorities — see middleware.ts).
//
// - completeLegacyTask / reopenLegacyTask: the Home queue merges public.projects
//   (new model) with the legacy public.tasks table; legacy rows have no drawer,
//   so these give them the one action that matters day-to-day.

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { explainAndLog } from '@/lib/errors';

export async function completeLegacyTask(id: string) {
	const supabase = await createClient();
	const { error } = await supabase
		.from('tasks')
		.update({ status: 'done', completed_at: new Date().toISOString() })
		.eq('id', id);
	if (error) return { ok: false as const, error: explainAndLog(error, 'the-work.homeActions') };
	revalidatePath('/');
	return { ok: true as const };
}

// Undo counterpart for the toast's Undo button.
export async function reopenLegacyTask(id: string) {
	const supabase = await createClient();
	const { error } = await supabase
		.from('tasks')
		.update({ status: 'todo', completed_at: null }) // legacy tasks table: check constraint slug is 'todo', not 'to_do'
		.eq('id', id);
	if (error) return { ok: false as const, error: explainAndLog(error, 'the-work.homeActions') };
	revalidatePath('/');
	return { ok: true as const };
}


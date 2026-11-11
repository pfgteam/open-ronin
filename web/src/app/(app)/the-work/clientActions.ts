'use server';

// Active clients for the Client pickers in The Work (new item, item panel,
// board settings). Loaded on demand by useClientOptions so the pickers work
// on every screen that opens them without each page loading the list.

import { createClient } from '@/lib/supabase/server';

export async function listActiveClients(): Promise<{ id: string; name: string }[]> {
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth.user) return [];
	const { data } = await supabase.from('clients_v2').select('id, display_name').eq('status', 'active').order('display_name').range(0, 999);
	return ((data ?? []) as { id: string; display_name: string }[]).map((c) => ({ id: c.id, name: c.display_name }));
}

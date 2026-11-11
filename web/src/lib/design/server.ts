// Server reader for the design system settings (0161). Read with the
// service role so public pages (login, public forms) get the theme too, and
// cached across requests: the row changes only when an admin saves, and the
// save calls revalidateTag(DESIGN_TAG). Fails soft to {} (= globals.css
// defaults) when the table is missing or the read fails, so a theming bug can
// never take the app down.

import { unstable_cache } from 'next/cache';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { parseDesignSettings, type DesignSettings } from './settings';

export const DESIGN_TAG = 'design-settings';

async function read(): Promise<DesignSettings> {
	try {
		if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) return {};
		const supabase = createServiceRoleClient();
		const { data, error } = await supabase.from('design_settings').select('settings').order('created_at').limit(1).maybeSingle();
		if (error || !data) return {};
		return parseDesignSettings(data.settings);
	} catch {
		return {};
	}
}

export const getDesignSettings = unstable_cache(read, ['design-settings-v1'], { tags: [DESIGN_TAG], revalidate: 600 });

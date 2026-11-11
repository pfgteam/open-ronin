// /admin/design-system — the design system settings (Alex, 2026-11-05):
// fonts, colour tokens (light and dark), button style, corner radius and the
// app's identity. Stored in design_settings (0161) as overrides on top of the
// globals.css defaults and applied as CSS variables at runtime. Admin only
// (the /admin ModuleGate, requireAdmin in the action, is_admin() in RLS).
// Live preview, reset to defaults, and a WCAG contrast guard.

import PageHeader from '@/components/ui/PageHeader';
import Callout from '@/components/ui/Callout';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { parseDesignSettings } from '@/lib/design/settings';
import DesignSystemForm from './DesignSystemForm';

export const metadata = { title: 'Design system' };
export const dynamic = 'force-dynamic';

export default async function DesignSystemPage() {
	const viewer = await getAuthProfile();
	const canEdit = !!viewer && viewer.is_active && ['admin', 'exec'].includes(viewer.role);
	const supabase = await createClient();
	const { data, error } = await supabase.from('design_settings').select('settings, updated_at').order('created_at').limit(1).maybeSingle();
	const applied = !error;
	return (
		<>
			<PageHeader
				title="Design system"
				description="Fonts, colours, buttons, corners and the app's name and logo. Changes apply to everyone after you save; the preview shows them first."
			/>
			{!applied && <Callout tone="warning" className="mb-4">Migration 0161 (design_settings) is not applied, so changes cannot be saved yet.</Callout>}
			{!canEdit && <Callout className="mb-4">Only admin and exec accounts can change the design system. You can look around.</Callout>}
			<DesignSystemForm initial={parseDesignSettings(data?.settings)} canEdit={canEdit && applied} updatedAt={(data?.updated_at as string | undefined) ?? null} />
		</>
	);
}

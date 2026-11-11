// /hiring/positions/new — the position builder for a fresh role (manage_hiring).

import { redirect } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { hasCapability } from '@/lib/permissions/capabilities';
import { loadCatalogs, loadHiringConfig, loadStaff } from '@/lib/hiring/server';
import NotAppliedCard from '../../NotAppliedCard';
import PositionBuilder from '../PositionBuilder';

export const metadata = { title: 'New position · Hiring' };
export const dynamic = 'force-dynamic';

export default async function NewPositionPage() {
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const [config, canManage] = await Promise.all([loadHiringConfig(supabase), hasCapability('manage_hiring')]);
	if (config.notApplied) return <NotAppliedCard />;
	const [templates, people, catalogs] = await Promise.all([
		supabase.from('four_r_templates').select('slug, position_label, department, reports_to, role_md, responsibilities_md, results_md, requirements_md').eq('is_active', true).order('sort'),
		loadStaff(supabase),
		loadCatalogs(supabase),
	]);
	return (
		<>
			<PageHeader title="New position" description="Draft the role here, then file a position request from it so Alex can approve the budget. Saved as a draft." />
			<PositionBuilder position={null} comp={null} config={config} templates={(templates.data ?? []) as never} people={people} catalogs={catalogs} canManage={canManage} canSeeComp={false} />
		</>
	);
}

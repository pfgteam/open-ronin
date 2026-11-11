// Admin → Prospects → Team & targets (spec 2026-10-19 §9): who works which
// lane, daily / weekly targets (metric from a list of tracked metrics) and
// the Self → Sales queue priorities.

import { createClient } from '@/lib/supabase/server';
import { hasCapability } from '@/lib/permissions/capabilities';
import { loadConfig, loadLanes, loadStaff } from '@/lib/revenue/server';
import NotAppliedCard from '@/app/(app)/prospects/NotAppliedCard';
import TeamSection from './TeamSection';

export const metadata = { title: 'Team & targets · Prospects settings' };
export const dynamic = 'force-dynamic';

export default async function TeamPage() {
	const supabase = await createClient();
	const [config, canManage, lanes, staff] = await Promise.all([loadConfig(supabase), hasCapability('manage_revenue'), loadLanes(supabase), loadStaff(supabase)]);
	if (config.notApplied) return <NotAppliedCard />;
	return <TeamSection people={lanes.people} targets={lanes.targets} rules={lanes.rules} staff={staff} canManage={canManage} />;
}

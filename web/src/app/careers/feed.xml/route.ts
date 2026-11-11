// GET /careers/feed.xml — the aggregator feed (0129, round 3: Jooble,
// Adzuna, Talent.com, Careerjet). Indeed-style XML, one <job> per open
// role, cached 10 minutes at the edge. Submit this URL once per aggregator.

import { createServiceRoleClient } from '@/lib/supabase/server';
import { loadBrandProfiles, loadOpenPositions } from '@/lib/hiring/server';
import { jobsFeedXml } from '@/lib/hiring/careers';

export const dynamic = 'force-dynamic';

export async function GET() {
	const svc = createServiceRoleClient();
	const [positions, brands] = await Promise.all([loadOpenPositions(svc), loadBrandProfiles(svc)]);
	const xml = jobsFeedXml(positions, brands, process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com');
	return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=600, s-maxage=600' } });
}

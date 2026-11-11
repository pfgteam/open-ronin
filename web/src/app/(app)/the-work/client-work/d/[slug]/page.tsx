// /the-work/client-work/d/<discipline> — assignments of one discipline
// (rework D9). Disciplines come from work_disciplines (0162), so a new one
// added in admin gets its tab without a migration or a deploy.
import HubPage, { type HubSearchParams } from '../../../_hub/HubPage';

export const dynamic = 'force-dynamic';

export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: HubSearchParams }) {
	const { slug } = await params;
	return <HubPage mode="client" hubKey={`d-${slug.replace(/[^a-z0-9_]/g, '')}`} searchParams={searchParams} />;
}

// /the-work/client-work/twelve-week — Client Work hub, 12 Week Plan (rework 5.7, D9).
// Same list screen as The Work hub; native client links only (client_id).
import HubPage, { type HubSearchParams } from '../../_hub/HubPage';

export const dynamic = 'force-dynamic';
export const metadata = { title: '12 Week Plan' };

export default function Page({ searchParams }: { searchParams: HubSearchParams }) {
	return <HubPage mode="client" hubKey="twelve-week" searchParams={searchParams} />;
}

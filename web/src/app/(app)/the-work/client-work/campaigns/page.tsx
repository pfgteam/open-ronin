// /the-work/client-work/campaigns — Client Work hub, Campaigns (rework 5.7, D9).
// Same list screen as The Work hub; native client links only (client_id).
import HubPage, { type HubSearchParams } from '../../_hub/HubPage';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Campaigns' };

export default function Page({ searchParams }: { searchParams: HubSearchParams }) {
	return <HubPage mode="client" hubKey="campaigns" searchParams={searchParams} />;
}

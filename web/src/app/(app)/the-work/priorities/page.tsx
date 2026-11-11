// /the-work/priorities — The Work hub, Priorities tab (rework D1). See ../_hub/HubPage.tsx.
import HubPage, { type HubSearchParams } from '../_hub/HubPage';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Priorities' };

export default function Page({ searchParams }: { searchParams: HubSearchParams }) {
	return <HubPage mode="tab" hubKey="priorities" searchParams={searchParams} />;
}

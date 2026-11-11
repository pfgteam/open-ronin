// /the-work/goals — The Work hub, Goals tab (rework D1). See ../_hub/HubPage.tsx.
import HubPage, { type HubSearchParams } from '../_hub/HubPage';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Goals' };

export default function Page({ searchParams }: { searchParams: HubSearchParams }) {
	return <HubPage mode="tab" hubKey="goals" searchParams={searchParams} />;
}

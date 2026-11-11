// /the-work/projects — The Work hub, Projects tab (rework D1). See ../_hub/HubPage.tsx.
import HubPage, { type HubSearchParams } from '../_hub/HubPage';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Projects' };

export default function Page({ searchParams }: { searchParams: HubSearchParams }) {
	return <HubPage mode="tab" hubKey="projects" searchParams={searchParams} />;
}

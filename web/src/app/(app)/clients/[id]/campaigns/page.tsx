// /clients/[id]/campaigns → /clients/[id]/delivery (308).
//
// The Campaigns tab was assignments-by-status plus a "schema not built"
// placeholder; the Delivery tab (2026-09-21 spec) replaced it and Sam
// ruled Assignments out of scope. The path survives so old links land
// somewhere real. [id] may still be a legacy Airtable record id — the
// Delivery page's requireClient() issues the second hop to the client id.

import { permanentRedirect } from 'next/navigation';

export default async function CampaignsRedirect({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	permanentRedirect(`/clients/${id}/delivery`);
}

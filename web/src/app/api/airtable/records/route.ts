// /api/airtable/records — paginated record fetch for the BaseExplorer.
//
// Requires an authenticated Supabase session. The PAT lives server-side
// and is never exposed to the browser.
//
// Query params:
//   baseId   — Airtable base ID
//   tableId  — Airtable table ID or name
//   cursor   — opaque pagination cursor returned by the previous call
//   view     — optional Airtable view ID or name
//   pageSize — optional, default 100, capped at 100 by Airtable

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getAdapter, DataAdapterError } from '@/lib/data';
import { getAuthUser } from '@/lib/supabase/server';
import { hasModuleAccess } from '@/lib/permissions/modules';
import { isSensitiveBase, AIRTABLE_BASE_ID_RE } from '@/lib/data/sensitiveBases';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';

export const dynamic = 'force-dynamic';

const QuerySchema = z.object({
	baseId: z.string().regex(AIRTABLE_BASE_ID_RE, 'not an Airtable base id'),
	// Airtable accepts a table id OR a table name here, so this can only be
	// length-bounded rather than pattern-matched.
	tableId: z.string().min(1).max(200),
	cursor: z.string().min(1).max(4096).optional(),
	view: z.string().min(1).max(200).optional(),
	pageSize: z.coerce.number().int().min(1).max(100).default(100),
});

export async function GET(request: NextRequest) {
	// Auth gate — must be authenticated AND admin/exec (this endpoint backs
	// BaseExplorer; non-admin module pages use server-fetched data instead).
	const user = await getAuthUser();
	if (!user) {
		return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
	}
	// Same gate as the /data pages (ModuleGate + RLS): the module × role
	// matrix from migration 0024 — a manager granted the Data module used to
	// see page 1 then get 403 here on scroll (hardcoded exec/admin check).
	const allowed = await hasModuleAccess('data');
	if (!allowed) {
		return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
	}

	// Shape-validate before anything reaches the adapter. These params used to
	// be passed straight through, which made this endpoint a general-purpose
	// proxy for every base the server PAT can see.
	const { searchParams } = request.nextUrl;
	const parsed = QuerySchema.safeParse({
		baseId: searchParams.get('baseId'),
		tableId: searchParams.get('tableId'),
		cursor: searchParams.get('cursor') ?? undefined,
		view: searchParams.get('view') ?? undefined,
		pageSize: searchParams.get('pageSize') ?? undefined,
	});

	if (!parsed.success) {
		return NextResponse.json(
			{ error: 'Invalid request', details: parsed.error.flatten().fieldErrors },
			{ status: 400 },
		);
	}

	const { baseId, tableId, cursor, view, pageSize } = parsed.data;

	// Personnel bases need people-management standing, not just the Data
	// module — a manager granted Data is not thereby granted HR.
	if (isSensitiveBase(baseId)) {
		const ctx = await loadSensitiveAccessContext();
		if (!canManagePeople(ctx)) {
			return NextResponse.json(
				{ error: 'Forbidden — this base holds personnel data' },
				{ status: 403 },
			);
		}
	}

	try {
		const result = await getAdapter().list(baseId, tableId, {
			pageSize,
			cursor,
			view,
		});
		return NextResponse.json(result);
	} catch (e) {
		if (e instanceof DataAdapterError) {
			return NextResponse.json(
				{ error: e.message, status: e.status, details: e.details },
				{ status: e.status >= 400 && e.status < 600 ? e.status : 500 },
			);
		}
		return NextResponse.json(
			{ error: e instanceof Error ? e.message : String(e) },
			{ status: 500 },
		);
	}
}

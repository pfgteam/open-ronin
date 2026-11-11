// POST /api/setup/refresh — drops the app's cached organisation config.
//
// `pnpm setup:apply` writes org_settings / design_settings straight to the
// database from the command line, so a running app would keep serving its
// cached copy (org name, branding, service lines) for up to 10 minutes. The
// script calls this right after applying, so the next page load shows the new
// config. Same Bearer CRON_SECRET gate as the cron routes; fails closed.

import { NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { denyUnlessCron } from '@/lib/cron/auth';
import { ORG_TAG } from '@/lib/tenant/server';
import { DESIGN_TAG } from '@/lib/design/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
	const denied = denyUnlessCron(request);
	if (denied) return denied;
	revalidateTag(ORG_TAG);
	revalidateTag(DESIGN_TAG);
	revalidatePath('/', 'layout');
	return NextResponse.json({ ok: true });
}

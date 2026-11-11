'use server';

// Server action behind the profile-photo uploader (AvatarUpload.tsx).
//
// The BYTES never pass through here: the browser resizes the image and uploads
// it straight to the `avatars` Storage bucket (0054) with the user's own
// session, so Storage RLS is the authority on who may write under which path
// prefix. This action only writes the resulting URL onto `profiles.photo_url`
// (the column comes from 0005_wiki_team_orgchart.sql — there is no generated
// Supabase type in this repo, so that name is verified by hand, not by tsc).
//
// Authorization is deliberately IDENTICAL to saveProfile()
// (`edit/actions.ts:81`): the person themselves, or a people-manager / exec /
// admin via canManagePeople(). One rule, two call sites — never a second
// permission path.
//
// The URL is validated against this project's own Storage public prefix.
// Without that check the action would be an open image-embed field: anyone
// could point a teammate's avatar at an arbitrary host that then sees every
// viewer's IP and referer.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';

export type SetProfilePhotoResult = { ok: true } | { ok: false; error: string };

// `https://<project>.supabase.co/storage/v1/object/public/avatars/`
// NOT exported: a 'use server' module may only export async functions, and the
// client component derives the same prefix from the same public env var.
function avatarPublicPrefix(): string | null {
	const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
	if (!base) return null;
	return `${base.replace(/\/+$/, '')}/storage/v1/object/public/avatars/`;
}

export async function setProfilePhoto(
	profileId: string,
	rawUrl: string | null,
): Promise<SetProfilePhotoResult> {
	// Reassigned only by the normalization below; the rest of the function must
	// use the normalized value, never the caller's raw string.
	let publicUrl = rawUrl;
	const ctx = await loadSensitiveAccessContext();

	if (!ctx.viewerId) {
		return { ok: false, error: 'You are signed out — sign in again and retry.' };
	}
	if (ctx.viewerId !== profileId && !canManagePeople(ctx)) {
		return {
			ok: false,
			error: 'Only the team member, a people-manager, exec, or admin can change this photo.',
		};
	}

	// Null clears the photo. Anything else must live in OUR avatars bucket.
	if (publicUrl !== null) {
		const prefix = avatarPublicPrefix();
		if (!prefix) {
			return { ok: false, error: 'Storage is not configured — contact an admin.' };
		}
		// A local Supabase stack is served over http on loopback; everything else
		// must be https or the avatar would be fetched insecurely on every page.
		const localhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(prefix);
		if (!prefix.startsWith('https://') && !localhost) {
			return { ok: false, error: 'Storage is not served over https — contact an admin.' };
		}
		if (publicUrl.length > 600) {
			return { ok: false, error: 'That image URL is too long to store.' };
		}
		// Compare the NORMALIZED url, not the raw string: `.../<profileId>/../x`
		// starts with the right prefix as text but resolves elsewhere, and it is
		// the resolved path that a browser actually fetches. `new URL` collapses
		// the `..` segments for us, so the check sees what the browser will see.
		// The uploaded object must sit under `<profileId>/` — that prefix is what
		// the 0054 write policies key ownership off, so a URL that does not match
		// it was not written by the rule we think authorized it.
		let normalized: string;
		try {
			normalized = new URL(publicUrl).toString();
		} catch {
			return { ok: false, error: 'That image URL is not a valid address.' };
		}
		// `new URL` collapses literal `..` but leaves `..%2f` encoded, and whether
		// Storage decodes that into a path segment is not something we can settle
		// without a live server — so refuse a dot-segment in any encoding rather
		// than reason about it.
		let decodedPath: string;
		try {
			decodedPath = decodeURIComponent(new URL(normalized).pathname);
		} catch {
			return { ok: false, error: 'That image URL is not a valid address.' };
		}
		if (decodedPath.split('/').includes('..')) {
			return { ok: false, error: 'That image is not in this project’s avatar storage.' };
		}
		if (!normalized.startsWith(`${prefix}${profileId}/`)) {
			return { ok: false, error: 'That image is not in this project’s avatar storage.' };
		}
		publicUrl = normalized;
	}

	const supabase = await createClient();

	const { data: before } = await supabase
		.from('profiles')
		.select('id, email, photo_url')
		.eq('id', profileId)
		.maybeSingle();

	if (!before) return { ok: false, error: 'Profile not found.' };

	const { error } = await supabase
		.from('profiles')
		.update({ photo_url: publicUrl, updated_at: new Date().toISOString() })
		.eq('id', profileId);

	if (error) {
		return {
			ok: false,
			error: error.message.includes('row-level security')
				? 'The database rejected this change — you may not have permission for this profile.'
				: `Could not save the photo: ${error.message}`,
		};
	}

	const beforeRow = before as unknown as { email: string | null; photo_url: string | null };

	// Awaited, not `void`-ed: a Vercel container can freeze the moment the
	// response is returned, and a floating promise would never settle.
	await recordAudit({
		actor_id: ctx.viewerId,
		entity_kind: 'supabase',
		entity_ref: `profiles/${profileId}`,
		action: publicUrl === null ? 'team.profile.photo.clear' : 'team.profile.photo.set',
		diff: {
			email: beforeRow.email,
			changed: { photo_url: { before: beforeRow.photo_url ?? null, after: publicUrl } },
		},
	});

	revalidatePath('/team');
	revalidatePath(`/team/${profileId}`);
	revalidatePath(`/team/${profileId}/edit`);
	revalidatePath('/team/org-chart');

	return { ok: true };
}

// Token-hash confirmation (server-side, no fragment, no PKCE verifier needed).
// Point the Supabase "Magic Link" email template at
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink&next=/portal
// and the portal sign-in completes here without the /auth/callback/finish
// client hop. Until the template is changed, the default {{ .ConfirmationURL }}
// still works through /auth/callback → /auth/callback/finish.

import { NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { safeInternalPath } from '@/lib/safeRedirect';

const TYPES: EmailOtpType[] = ['magiclink', 'signup', 'invite', 'recovery', 'email_change', 'email'];

export async function GET(request: Request) {
	const url = new URL(request.url);
	const tokenHash = url.searchParams.get('token_hash');
	const type = url.searchParams.get('type') as EmailOtpType | null;
	const next = safeInternalPath(url.searchParams.get('next'));
	if (!tokenHash || !type || !TYPES.includes(type)) {
		return NextResponse.redirect(new URL('/auth/login?error=Invalid+sign-in+link', url.origin));
	}
	const supabase = await createClient();
	const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
	if (error) {
		const back = new URL(type === 'magiclink' ? '/portal' : '/auth/login', url.origin);
		back.searchParams.set('error', error.message);
		return NextResponse.redirect(back);
	}
	if (type === 'recovery') return NextResponse.redirect(new URL('/auth/reset-password', url.origin));
	return NextResponse.redirect(new URL(next, url.origin));
}

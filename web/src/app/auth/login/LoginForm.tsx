'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { useAuthStore } from '@/stores/auth';
import { safeInternalPath } from '@/lib/safeRedirect';
import { BrandLogo } from '@/components/design/Identity';
import OrgDomainsNote from '@/components/auth/OrgDomainsNote';
import { createClient } from '@/lib/supabase/client';
import type { SignInMethods } from '@/lib/auth/signInMethods';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Client half of /auth/login. page.tsx (server) works out which sign-in
// methods are configured and passes them in, so a fresh install never shows a
// button that leads to an error. Email + password is always on.
export default function LoginForm({ methods, googleHd }: { methods: SignInMethods; googleHd?: string | null }) {
	const router = useRouter();
	const searchParams = useSearchParams();
	// Only same-origin paths — an absolute URL here was an open redirect
	// (login?redirect=https://evil.com navigated away after auth). The check
	// lives in @/lib/safeRedirect so the auth and GHL callbacks share it.
	const redirect = safeInternalPath(searchParams.get('redirect'));
	const urlError = searchParams.get('error');

	const { login, signInWithGoogle, error, isLoading, clearError } = useAuthStore();

	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [showPassword, setShowPassword] = useState(false);
	const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
	const [linkSent, setLinkSent] = useState(false);
	const [linkError, setLinkError] = useState<string | null>(null);
	const [linkLoading, setLinkLoading] = useState(false);

	useEffect(() => {
		// Clear stale errors when the page mounts
		clearError();
	}, [clearError]);

	const displayError = linkError ?? error ?? urlError;

	function validate(): boolean {
		const next: { email?: string; password?: string } = {};
		let valid = true;

		if (!email) {
			next.email = 'Email is required';
			valid = false;
		} else if (!EMAIL_RE.test(email)) {
			next.email = 'Please enter a valid email';
			valid = false;
		}

		if (!password) {
			next.password = 'Password is required';
			valid = false;
		} else if (password.length < 8) {
			next.password = 'Password must be at least 8 characters';
			valid = false;
		}

		setErrors(next);
		return valid;
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!validate()) return;

		try {
			await login(email, password);
			router.push(redirect);
			router.refresh();
		} catch {
			// store handles the error message
		}
	}

	async function handleMagicLink() {
		setLinkError(null);
		if (!EMAIL_RE.test(email)) {
			setErrors({ email: 'Enter your email first' });
			return;
		}
		setErrors({});
		setLinkLoading(true);
		const { error: err } = await createClient().auth.signInWithOtp({
			email: email.trim().toLowerCase(),
			options: {
				emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirect)}`,
				shouldCreateUser: false,
			},
		});
		setLinkLoading(false);
		if (err) setLinkError(err.message);
		else setLinkSent(true);
	}

	async function handleGoogle() {
		try {
			await signInWithGoogle(googleHd ?? undefined);
			// OAuth redirects away from this page
		} catch {
			// store handles the error message
		}
	}

	return (
		<div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
			<div className="w-full max-w-sm px-4">
				{/* Logo */}
				<div className="text-center mb-8">
					<BrandLogo />
					<h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
						Sign in to Open Ronin
					</h1>
					<p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
						Good stories don&apos;t tell themselves.
					</p>
				</div>

				{displayError && (
					<div className="mb-4 p-3 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
						<p className="text-sm text-red-700 dark:text-red-300">{displayError}</p>
					</div>
				)}

				{linkSent && (
					<div className="mb-4 p-3 rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
						<p className="text-sm text-green-800 dark:text-green-300">Check your email for a sign-in link.</p>
					</div>
				)}

				<Card>
					{/* Outside the <form> and type="button": pressing Enter or a password
					    manager's auto-submit must never start Google OAuth. Shown only
					    when the Google provider is configured in Supabase Auth. */}
					{methods.google && (
						<>
							<Button type="button" variant="outline" full onClick={handleGoogle} disabled={isLoading}>
								<GoogleIcon className="w-4 h-4" />
								Continue with Google
							</Button>

							<div className="my-4 flex items-center gap-3 text-xs text-slate-400">
								<hr className="flex-1 border-slate-200 dark:border-slate-700" />
								<span>or with email</span>
								<hr className="flex-1 border-slate-200 dark:border-slate-700" />
							</div>
						</>
					)}

					<form className="space-y-4" onSubmit={handleSubmit}>
						<Input
							type="email"
							label="Email"
							placeholder="you@example.com"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							error={errors.email}
							autoComplete="email"
						/>

						<div className="flex flex-col gap-1">
							<Input
								type={showPassword ? 'text' : 'password'}
								label="Password"
								placeholder="--------"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								error={errors.password}
								autoComplete="current-password"
							/>
							<button
								type="button"
								className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-left w-fit transition-colors"
								onClick={() => setShowPassword(!showPassword)}
							>
								{showPassword ? 'Hide' : 'Show'} password
							</button>
						</div>

						<div className="flex items-center justify-between gap-3">
							{methods.email ? (
								<Link
									href="/auth/forgot-password"
									className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 transition-colors"
								>
									Forgot password?
								</Link>
							) : (
								<span className="text-xs text-slate-500 dark:text-slate-400">
									Forgot password? Ask an admin for a sign-in link.
								</span>
							)}
							<Link
								href="/auth/signup"
								className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 transition-colors shrink-0"
							>
								Create account
							</Link>
						</div>

						<Button type="submit" loading={isLoading} full>
							Sign in
						</Button>

						{methods.magicLink && (
							<Button type="button" variant="ghost" full onClick={handleMagicLink} loading={linkLoading}>
								Email me a sign-in link instead
							</Button>
						)}
					</form>
				</Card>

				<p className="text-center text-xs text-slate-400 mt-6">
					<OrgDomainsNote />
				</p>
			</div>
		</div>
	);
}

function GoogleIcon({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className={className}>
			<path
				fill="#EA4335"
				d="M12 5.04c1.7 0 3.22.59 4.42 1.74l3.3-3.3C17.46 1.7 14.97.8 12 .8 7.36.8 3.35 3.46 1.32 7.34l3.85 2.99C6.13 7.42 8.83 5.04 12 5.04z"
			/>
			<path
				fill="#4285F4"
				d="M23.2 12.28c0-.86-.08-1.69-.22-2.49H12v4.72h6.31c-.27 1.46-1.1 2.7-2.34 3.53l3.78 2.93c2.21-2.04 3.45-5.04 3.45-8.7z"
			/>
			<path
				fill="#FBBC05"
				d="M5.17 14.33c-.22-.65-.34-1.34-.34-2.05s.12-1.4.34-2.05L1.32 7.34A11.43 11.43 0 000 12.28c0 1.85.45 3.6 1.32 5.14l3.85-3.09z"
			/>
			<path
				fill="#34A853"
				d="M12 23.2c3.24 0 5.95-1.07 7.93-2.91l-3.78-2.93c-1.05.7-2.4 1.12-4.15 1.12-3.17 0-5.87-2.38-6.83-5.6L1.32 15.87C3.35 19.75 7.36 23.2 12 23.2z"
			/>
		</svg>
	);
}

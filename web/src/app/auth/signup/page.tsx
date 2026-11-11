'use client';

import { useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { useAuthStore } from '@/stores/auth';
import { BrandLogo } from '@/components/design/Identity';
import OrgDomainsNote from '@/components/auth/OrgDomainsNote';

const ALLOWED_DOMAINS = (process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS ?? '')
	.split(',')
	.map((d) => d.trim().toLowerCase())
	.filter(Boolean);

export default function SignupPage() {
	const { signup, error, isLoading } = useAuthStore();

	const [firstName, setFirstName] = useState('');
	const [lastName, setLastName] = useState('');
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [showPassword, setShowPassword] = useState(false);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [sent, setSent] = useState(false);

	function validate(): boolean {
		const next: Record<string, string> = {};
		let valid = true;

		if (!firstName) {
			next.firstName = 'First name required';
			valid = false;
		}
		if (!lastName) {
			next.lastName = 'Last name required';
			valid = false;
		}

		if (!email) {
			next.email = 'Email required';
			valid = false;
		} else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			next.email = 'Invalid email';
			valid = false;
		} else if (ALLOWED_DOMAINS.length) {
			const domain = email.toLowerCase().split('@')[1];
			if (!ALLOWED_DOMAINS.includes(domain)) {
				next.email = `Email must end in: ${ALLOWED_DOMAINS.map((d) => `@${d}`).join(' or ')}`;
				valid = false;
			}
		}

		if (!password) {
			next.password = 'Password required';
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
			await signup(email, password, firstName, lastName);
			setSent(true);
		} catch {
			// store handles
		}
	}

	return (
		<div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
			<div className="w-full max-w-sm px-4">
				<div className="text-center mb-8">
					<BrandLogo />
					<h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
						Create your Open Ronin account
					</h1>
					<p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
						<OrgDomainsNote prefix="Only" help={false} />
					</p>
				</div>

				{error && (
					<div className="mb-4 p-3 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
						<p className="text-sm text-red-700 dark:text-red-300">{error}</p>
					</div>
				)}

				<Card>
					{sent ? (
						<div className="text-center py-4">
							<p className="text-sm text-slate-700 dark:text-slate-300">
								Confirmation link sent. Check your email to finish signing up.
							</p>
							<Link
								href="/auth/login"
								className="inline-block mt-4 text-xs text-primary-600 hover:text-primary-700 transition-colors"
							>
								Back to login
							</Link>
						</div>
					) : (
						<form className="space-y-4" onSubmit={handleSubmit}>
							<div className="grid grid-cols-2 gap-3">
								<Input
									label="First name"
									value={firstName}
									onChange={(e) => setFirstName(e.target.value)}
									error={errors.firstName}
									autoComplete="given-name"
								/>
								<Input
									label="Last name"
									value={lastName}
									onChange={(e) => setLastName(e.target.value)}
									error={errors.lastName}
									autoComplete="family-name"
								/>
							</div>

							<Input
								type="email"
								label="Work email"
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
									placeholder="Min 8 characters"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									error={errors.password}
									autoComplete="new-password"
								/>
								<button
									type="button"
									className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-left w-fit transition-colors"
									onClick={() => setShowPassword(!showPassword)}
								>
									{showPassword ? 'Hide' : 'Show'} password
								</button>
							</div>

							<Button type="submit" loading={isLoading} full>
								Create account
							</Button>

							<Link
								href="/auth/login"
								className="block text-center text-xs text-primary-600 hover:text-primary-700 transition-colors"
							>
								Already have an account? Sign in
							</Link>
						</form>
					)}
				</Card>
			</div>
		</div>
	);
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { useAuthStore } from '@/stores/auth';
import { BrandLogo } from '@/components/design/Identity';

export default function ForgotPasswordPage() {
	const { resetPassword, error, isLoading } = useAuthStore();
	const [email, setEmail] = useState('');
	const [sent, setSent] = useState(false);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!email) return;
		try {
			await resetPassword(email);
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
						Reset your password
					</h1>
					<p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
						We&apos;ll email you a reset link.
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
								Reset link sent. Check your inbox.
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
							<Input
								type="email"
								label="Email"
								placeholder="you@example.com"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								autoComplete="email"
								required
							/>
							<Button type="submit" loading={isLoading} full>
								Send reset link
							</Button>
							<Link
								href="/auth/login"
								className="block text-center text-xs text-primary-600 hover:text-primary-700 transition-colors"
							>
								Back to login
							</Link>
						</form>
					)}
				</Card>
			</div>
		</div>
	);
}

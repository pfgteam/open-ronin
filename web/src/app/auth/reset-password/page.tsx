'use client';

// Final step of the password-recovery flow.
// User lands here from the email link → callback exchanged the code for a
// session → now they pick a new password.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { createClient } from '@/lib/supabase/client';
import { BrandLogo } from '@/components/design/Identity';

export default function ResetPasswordPage() {
	const router = useRouter();
	const [password, setPassword] = useState('');
	const [confirm, setConfirm] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);

		if (password.length < 8) {
			setError('Password must be at least 8 characters');
			return;
		}
		if (password !== confirm) {
			setError('Passwords do not match');
			return;
		}

		setIsLoading(true);
		const supabase = createClient();
		const { error: err } = await supabase.auth.updateUser({ password });
		setIsLoading(false);

		if (err) {
			setError(err.message);
			return;
		}

		router.push('/');
		router.refresh();
	}

	return (
		<div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
			<div className="w-full max-w-sm px-4">
				<div className="text-center mb-8">
					<BrandLogo />
					<h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
						Set a new password
					</h1>
				</div>

				{error && (
					<div className="mb-4 p-3 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
						<p className="text-sm text-red-700 dark:text-red-300">{error}</p>
					</div>
				)}

				<Card>
					<form className="space-y-4" onSubmit={handleSubmit}>
						<Input
							type="password"
							label="New password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							autoComplete="new-password"
							required
						/>
						<Input
							type="password"
							label="Confirm new password"
							value={confirm}
							onChange={(e) => setConfirm(e.target.value)}
							autoComplete="new-password"
							required
						/>
						<Button type="submit" loading={isLoading} full>
							Update password
						</Button>
						<Link
							href="/auth/login"
							className="block text-center text-xs text-primary-600 hover:text-primary-700 transition-colors"
						>
							Back to login
						</Link>
					</form>
				</Card>
			</div>
		</div>
	);
}

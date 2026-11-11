'use client';

// ConfirmAction — a button that opens a confirmation stating the real impact
// before an external or irreversible side effect (Admin → Prospects pushes,
// replays and merges; the deal page's contract signed/void). Replaces window.confirm and click-to-fire. Errors stay in
// the dialog; success closes it and raises a toast.

import { useState, useTransition } from 'react';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import { useToast } from '@/components/ui/Toast';
import Dialog from './Dialog';

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

export default function ConfirmAction({ label, title, impact, confirmLabel, tone = 'danger', onConfirm, disabled, size = 'sm', variant = 'secondary', className }: {
	label: React.ReactNode;
	title: string;
	impact: React.ReactNode;
	confirmLabel: string;
	tone?: 'danger' | 'primary';
	onConfirm: () => Promise<ActionResult>;
	disabled?: boolean;
	size?: 'sm' | 'md';
	variant?: 'primary' | 'secondary' | 'ghost' | 'outline';
	className?: string;
}) {
	const { toast } = useToast();
	const [open, setOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [pending, start] = useTransition();
	const close = () => {
		if (pending) return;
		setOpen(false);
		setError(null);
	};
	const go = () =>
		start(async () => {
			setError(null);
			const r = await onConfirm();
			if (!r.ok) {
				setError(r.error);
				return;
			}
			setOpen(false);
			if (r.message) toast({ message: r.message, variant: 'success' });
		});
	return (
		<>
			<Button type="button" size={size} variant={variant} disabled={disabled} onClick={() => setOpen(true)} className={className}>
				{label}
			</Button>
			<Dialog
				open={open}
				onClose={close}
				title={title}
				maxWidth="max-w-lg"
				footer={
					<>
						<Button type="button" size="sm" variant="secondary" onClick={close} disabled={pending}>
							Cancel
						</Button>
						<Button
							type="button"
							size="sm"
							loading={pending}
							onClick={go}
							data-autofocus
							className={tone === 'danger' ? 'bg-red-700 text-white hover:bg-red-800 dark:bg-red-700 dark:hover:bg-red-800' : undefined}
						>
							{confirmLabel}
						</Button>
					</>
				}
			>
				<div className="space-y-2 text-sm text-slate-700 dark:text-slate-300">{impact}</div>
				{error && (
					<Callout tone="error" className="mt-3">
						{error}
					</Callout>
				)}
			</Dialog>
		</>
	);
}

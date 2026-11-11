'use client';

// One form → one server action → one Callout. Every Flywheel panel uses it
// so the pending / error / success handling lives in one place.

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Callout from '@/components/ui/Callout';

type ActionResult = { ok: true } | { ok: false; error: string };

export default function ActionForm({ action, children, className, success = 'Saved.', onDone, resetOnSuccess }: { action: (fd: FormData) => Promise<ActionResult>; children: ReactNode; className?: string; success?: string | null; onDone?: () => void; resetOnSuccess?: boolean }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	return (
		<form
			className={className}
			action={(fd) =>
				start(async () => {
					setMsg(null);
					const r = await action(fd);
					if (r.ok) {
						if (success) setMsg({ ok: true, text: success });
						onDone?.();
						router.refresh();
					} else setMsg({ ok: false, text: r.error });
				})
			}
			onSubmit={resetOnSuccess ? (e) => setTimeout(() => (e.target as HTMLFormElement).reset(), 0) : undefined}
			data-pending={pending ? '1' : undefined}
		>
			{msg && (
				<Callout tone={msg.ok ? 'success' : 'error'} className="mb-2 py-1">
					{msg.text}
				</Callout>
			)}
			<fieldset disabled={pending} className="contents">
				{children}
			</fieldset>
		</form>
	);
}

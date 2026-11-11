'use client';

// Candidate portal upload (0132): resume refresh, ID, portfolio PDFs. Posts
// to /api/careers/portal/upload with the portal token.

import { useState } from 'react';

export default function PortalUpload({ token }: { token: string }) {
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState<string | null>(null);
	const [kind, setKind] = useState('resume');
	const upload = async (file: File) => {
		setBusy(true);
		setMsg(null);
		const fd = new FormData();
		fd.set('token', token);
		fd.set('kind', kind);
		fd.set('file', file);
		try {
			const r = await fetch('/api/careers/portal/upload', { method: 'POST', body: fd });
			const j = (await r.json()) as { ok?: boolean; error?: string };
			setMsg(r.ok && j.ok ? 'Uploaded. Thank you.' : j.error ?? 'Upload failed.');
		} catch {
			setMsg('Network error.');
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="flex flex-wrap items-center gap-2 text-sm">
			<select value={kind} onChange={(e) => setKind(e.target.value)} className="text-sm rounded-md border border-slate-300 bg-white px-2 py-1.5">
				<option value="resume">Updated resume</option>
				<option value="portfolio">Portfolio / work sample</option>
				<option value="other">Other document</option>
			</select>
			<input type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} className="text-sm" />
			{busy && <span className="text-xs text-slate-500">Uploading…</span>}
			{msg && <span className="text-xs text-slate-600">{msg}</span>}
		</div>
	);
}

'use client';

// The Brand editor: settings form on the left, live preview on the right.
//
// Logos upload browser to bucket (the AvatarUpload pattern, 0054): the file
// goes straight to the public `avatars` bucket under `brand/<platform id>/`
// with the admin's own session, then only the PATH is handed to setBrandLogo.
// The preview reflects the form as you type, before saving, so the effect of a
// color or font choice is visible without a round trip.

import { useState, useTransition, useRef } from 'react';
import Image from 'next/image';
import { Loader2, Trash2, Upload } from 'lucide-react';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { createClient } from '@/lib/supabase/client';
import {
	BRAND_BUCKET,
	BRAND_PREFIX,
	DEFAULT_PRIMARY,
	HEX_COLOR,
	SOCIAL_KEYS,
	SOCIAL_LABELS,
	TYPOGRAPHY,
	TYPOGRAPHY_LABELS,
	TYPOGRAPHY_STACKS,
	publicUrlForPath,
	type Brand,
	type Typography,
} from '@/lib/brand/constants';
import { saveBrandSettings, setBrandLogo } from './actions';

const ACCEPTED_MIME = ['image/png', 'image/svg+xml', 'image/webp', 'image/jpeg'];
const MAX_BYTES = 2 * 1024 * 1024;
const EXT: Record<string, string> = {
	'image/png': 'png',
	'image/svg+xml': 'svg',
	'image/webp': 'webp',
	'image/jpeg': 'jpg',
};

function LogoSlot({
	variant,
	path,
	onChange,
}: {
	variant: 'light' | 'dark';
	path: string | null;
	onChange: (path: string | null) => void;
}) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const input = useRef<HTMLInputElement>(null);
	const url = publicUrlForPath(path);

	async function handleFile(file: File | null | undefined) {
		if (!file || busy) return;
		setError(null);
		if (!ACCEPTED_MIME.includes(file.type)) {
			setError('Pick a PNG, SVG, WebP or JPEG.');
			return;
		}
		if (file.size > MAX_BYTES) {
			setError('Logos must be under 2 MB.');
			return;
		}
		setBusy(true);
		try {
			const supabase = createClient();
			// Timestamped name: a stable filename would keep serving from the CDN cache.
			const next = `${BRAND_PREFIX}logo-${variant}-${Date.now()}.${EXT[file.type] ?? 'png'}`;
			const { error: upErr } = await supabase.storage
				.from(BRAND_BUCKET)
				.upload(next, file, { contentType: file.type, upsert: false, cacheControl: '31536000' });
			if (upErr) {
				setError(`Upload failed: ${upErr.message}`);
				return;
			}
			const saved = await setBrandLogo(variant, next);
			if (!saved.ok) {
				await supabase.storage.from(BRAND_BUCKET).remove([next]);
				setError(saved.error);
				return;
			}
			onChange(next);
		} finally {
			setBusy(false);
			if (input.current) input.current.value = '';
		}
	}

	async function clear() {
		if (busy || !path) return;
		setBusy(true);
		setError(null);
		try {
			const saved = await setBrandLogo(variant, null);
			if (!saved.ok) {
				setError(saved.error);
				return;
			}
			onChange(null);
		} finally {
			setBusy(false);
		}
	}

	const surface = variant === 'light' ? 'bg-white' : 'bg-slate-900';

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<span className="text-xs font-medium text-slate-600 dark:text-slate-400">
					Logo for {variant} backgrounds
				</span>
				<div className="flex items-center gap-1">
					<Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
						{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
						{path ? 'Replace' : 'Upload'}
					</Button>
					{path && (
						<Button type="button" variant="ghost" size="sm" disabled={busy} onClick={clear} aria-label="Remove logo">
							<Trash2 className="w-3.5 h-3.5" />
						</Button>
					)}
				</div>
			</div>
			<div
				className={`${surface} h-24 rounded-md border border-slate-200 dark:border-slate-700 flex items-center justify-center overflow-hidden`}
			>
				{url ? (
					// Storage URLs are not in next.config images.remotePatterns; unoptimized keeps it a plain img.
					<Image src={url} alt={`${variant} logo`} width={240} height={80} unoptimized className="max-h-20 w-auto object-contain" />
				) : (
					<span className={`text-2xs ${variant === 'light' ? 'text-slate-600' : 'text-slate-400'}`}>No logo uploaded</span>
				)}
			</div>
			<input
				ref={input}
				type="file"
				accept={ACCEPTED_MIME.join(',')}
				className="hidden"
				onChange={(e) => void handleFile(e.target.files?.[0])}
			/>
			{error && <Callout tone="error">{error}</Callout>}
		</div>
	);
}

export default function BrandForm({ brand, applied }: { brand: Brand; applied: boolean }) {
	const [name, setName] = useState(brand.name);
	const [website, setWebsite] = useState(brand.websiteUrl ?? '');
	const [primary, setPrimary] = useState(brand.primaryColor);
	const [accent, setAccent] = useState(brand.accentColor);
	const [typography, setTypography] = useState<Typography>(brand.typography);
	const [footer, setFooter] = useState(brand.emailFooter);
	const [handles, setHandles] = useState<Record<string, string>>({ ...brand.socialHandles });
	const [logoLight, setLogoLight] = useState(brand.logoLightPath);
	const [logoDark, setLogoDark] = useState(brand.logoDarkPath);
	const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
	const [pending, start] = useTransition();

	const previewPrimary = HEX_COLOR.test(primary) ? primary : brand.primaryColor;
	const previewAccent = HEX_COLOR.test(accent) ? accent : brand.accentColor;
	const font = TYPOGRAPHY_STACKS[typography];

	function submit(fd: FormData) {
		setResult(null);
		start(async () => {
			const r = await saveBrandSettings(fd);
			setResult(r.ok ? { ok: true, message: 'Brand saved.' } : { ok: false, message: r.error });
		});
	}

	return (
		<div className="grid gap-4 lg:grid-cols-5">
			<form action={submit} className="lg:col-span-3 space-y-4">
				{!applied && (
					<Callout tone="warning">
						Migration <code>0072_brand_settings.sql</code> is not applied yet. The form shows the
						defaults and saving will fail until it is.
					</Callout>
				)}
				{result && <Callout tone={result.ok ? 'success' : 'error'}>{result.message}</Callout>}

				<Card className="space-y-3">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Identity</h2>
					<Input label="Brand name" name="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
					<Input label="Website" name="website_url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
					<div className="grid gap-3 sm:grid-cols-2">
						<LogoSlot variant="light" path={logoLight} onChange={setLogoLight} />
						<LogoSlot variant="dark" path={logoDark} onChange={setLogoDark} />
					</div>
				</Card>

				<Card className="space-y-3">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Colors and type</h2>
					<div className="grid gap-3 sm:grid-cols-2">
						<ColorField label="Primary color" name="primary_color" value={primary} onChange={setPrimary} hint="Buttons, links and headings in generated content." />
						<ColorField label="Accent color" name="accent_color" value={accent} onChange={setAccent} hint="Identity accent only, never a status color." />
					</div>
					<Select label="Typography" name="typography" value={typography} onChange={(e) => setTypography(e.target.value as Typography)}>
						{TYPOGRAPHY.map((t) => (
							<option key={t} value={t}>
								{TYPOGRAPHY_LABELS[t]}
							</option>
						))}
					</Select>
				</Card>

				<Card className="space-y-3">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Email footer</h2>
					<textarea
						name="email_footer"
						value={footer}
						onChange={(e) => setFooter(e.target.value)}
						rows={3}
						maxLength={1000}
						placeholder="Open Ronin · 123 Main St · Unsubscribe link is added by the sender"
						className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500 dark:focus:border-primary-400 dark:focus:ring-primary-400"
					/>
				</Card>

				<Card className="space-y-3">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Social handles</h2>
					<div className="grid gap-3 sm:grid-cols-2">
						{SOCIAL_KEYS.map((key) => (
							<Input
								key={key}
								label={SOCIAL_LABELS[key]}
								name={`social_${key}`}
								value={handles[key] ?? ''}
								onChange={(e) => setHandles((h) => ({ ...h, [key]: e.target.value }))}
								placeholder="handle without the @"
								maxLength={80}
							/>
						))}
					</div>
				</Card>

				<div className="flex items-center gap-3">
					<Button type="submit" loading={pending} disabled={!applied}>
						Save brand
					</Button>
					{brand.updatedAt && (
						<span className="text-2xs text-slate-600 dark:text-slate-400">Last saved {new Date(brand.updatedAt).toLocaleString()}</span>
					)}
				</div>
			</form>

			<div className="lg:col-span-2">
				<Card padding="none" className="overflow-hidden sticky top-4">
					<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Preview</h2>
						<p className="text-2xs text-slate-600 dark:text-slate-400">How generated content and email will read these values.</p>
					</div>
					<div className="p-4 space-y-4" style={{ fontFamily: font }}>
						<div className="rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
							<div className="bg-white p-4 flex items-center justify-between">
								{publicUrlForPath(logoLight) ? (
									<Image src={publicUrlForPath(logoLight)!} alt="" width={160} height={40} unoptimized className="h-8 w-auto" />
								) : (
									<span className="text-lg font-semibold" style={{ color: previewPrimary }}>{name || 'Brand'}</span>
								)}
								<span className="text-2xs px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: previewAccent }}>
									accent
								</span>
							</div>
							<div className="bg-slate-900 p-4 flex items-center justify-between">
								{publicUrlForPath(logoDark) ? (
									<Image src={publicUrlForPath(logoDark)!} alt="" width={160} height={40} unoptimized className="h-8 w-auto" />
								) : (
									<span className="text-lg font-semibold text-slate-100">{name || 'Brand'}</span>
								)}
								<span className="text-2xs px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: previewPrimary }}>
									primary
								</span>
							</div>
						</div>

						<div className="rounded-md border border-slate-200 dark:border-slate-700 p-3 space-y-2 bg-white text-slate-900">
							<p className="text-sm font-semibold" style={{ color: previewPrimary }}>
								Sample headline in {TYPOGRAPHY_LABELS[typography].split(' (')[0]}
							</p>
							<p className="text-xs text-slate-600">
								Body copy reads in the chosen face. Links look{' '}
								<span className="underline" style={{ color: previewPrimary }}>like this</span>.
							</p>
							<button type="button" className="text-xs px-3 py-1.5 rounded-md text-white" style={{ backgroundColor: previewPrimary }}>
								Primary button
							</button>
							<div className="border-t border-slate-200 pt-2 text-2xs text-slate-600 dark:text-slate-400 whitespace-pre-line">
								{footer.trim() || 'Email footer appears here.'}
								{SOCIAL_KEYS.filter((k) => handles[k]?.trim()).length > 0 && (
									<div className="mt-1 flex flex-wrap gap-2">
										{SOCIAL_KEYS.filter((k) => handles[k]?.trim()).map((k) => (
											<span key={k} style={{ color: previewPrimary }}>
												{SOCIAL_LABELS[k]}: @{handles[k].trim().replace(/^@+/, '')}
											</span>
										))}
									</div>
								)}
							</div>
						</div>

						<div className="flex gap-2">
							<Swatch label="primary" value={previewPrimary} />
							<Swatch label="accent" value={previewAccent} />
						</div>
					</div>
				</Card>
			</div>
		</div>
	);
}

function ColorField({
	label,
	name,
	value,
	onChange,
	hint,
}: {
	label: string;
	name: string;
	value: string;
	onChange: (v: string) => void;
	hint: string;
}) {
	const valid = HEX_COLOR.test(value);
	return (
		<div className="flex flex-col gap-1">
			<label className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>
			<div className="flex items-center gap-2">
				<input
					type="color"
					aria-label={`${label} picker`}
					value={valid ? value : DEFAULT_PRIMARY}
					onChange={(e) => onChange(e.target.value)}
					className="h-9 w-10 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-0.5 cursor-pointer"
				/>
				<Input
					name={name}
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder="#069494"
					maxLength={7}
					className="font-mono"
					error={value && !valid ? 'Six digit hex, like #069494' : undefined}
				/>
			</div>
			<span className="text-2xs text-slate-600 dark:text-slate-400">{hint}</span>
		</div>
	);
}

function Swatch({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center gap-2 text-2xs text-slate-600 dark:text-slate-400">
			<span className="w-5 h-5 rounded-md border border-slate-200 dark:border-slate-700" style={{ backgroundColor: value }} />
			<span className="font-mono">{value}</span>
			<span>{label}</span>
		</div>
	);
}

'use client';

// Profile-photo uploader — the primary way a photo gets onto a profile.
//
// The bytes go browser → Storage directly (bucket `avatars`, 0054), with the
// signed-in user's own session, so the bucket's RLS policies are the authority
// on who may write under a given `<profileId>/` prefix. Only the resulting URL
// is handed to the server (setProfilePhoto in ./avatarActions).
//
// Why this component also owns the `photo_url` text input:
// the surrounding form on /team/[id]/edit submits `photo_url` too. If the input
// stayed a separate server-rendered field, uploading a photo and THEN pressing
// "Save profile" would post the value the page was rendered with and silently
// undo the upload. Keeping both in one piece of state makes that impossible —
// an upload rewrites the input, so a later full-form save agrees with it.
//
// The URL input survives on purpose (it is not dead weight): profiles that
// already point at an externally hosted image have no migration path into the
// bucket, and removing the input would strand those values where nobody could
// edit or clear them.
//
// Resizing uses the platform canvas — no image library (no new dependencies).

import { useCallback, useRef, useState, type DragEvent } from 'react';
import { Camera, Loader2, Trash2, Upload } from 'lucide-react';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import { createClient } from '@/lib/supabase/client';
import { planSquareCrop } from '@/lib/images/squareResize';
import { setProfilePhoto } from './avatarActions';
import { Field, inputClass } from '../_form';

const BUCKET = 'avatars';
/** Checked against File.type — a HEIC or a PDF is rejected before any decode. */
const ACCEPTED_MIME = ['image/png', 'image/jpeg', 'image/webp'];
/** Rejected before reading, so a 40 MB photo never gets decoded in the tab. */
const MAX_BYTES = 10 * 1024 * 1024;
/** Longest edge of the stored square. */
const MAX_EDGE = 512;

const EXTENSION_BY_MIME: Record<string, string> = {
	'image/webp': 'webp',
	'image/jpeg': 'jpg',
	'image/png': 'png',
};

/** `https://<project>.supabase.co/storage/v1/object/public/avatars/` */
function publicPrefix(): string | null {
	const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
	if (!base) return null;
	return `${base.replace(/\/+$/, '')}/storage/v1/object/public/${BUCKET}/`;
}

/** Object path for a URL in OUR avatars bucket; null for anything else. */
function storagePathFromUrl(url: string | null): string | null {
	if (!url) return null;
	const prefix = publicPrefix();
	if (!prefix || !url.startsWith(prefix)) return null;
	const path = url.slice(prefix.length).split('?')[0];
	return path || null;
}

function loadImage(objectUrl: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('That file could not be read as an image.'));
		img.src = objectUrl;
	});
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string): Promise<Blob | null> {
	return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), mime, 0.85));
}

/**
 * Centre-crop to a square of at most MAX_EDGE and encode it.
 * WebP first; Safari has historically returned null from toBlob('image/webp'),
 * so JPEG is the fallback. The mime that actually came back is returned with
 * the blob — the caller names the file after it, because a JPEG uploaded as
 * `.webp` is a latent bug (wrong extension, wrong Content-Type on the CDN).
 */
async function toSquareBlob(file: File): Promise<{ blob: Blob; mime: string }> {
	const objectUrl = URL.createObjectURL(file);
	try {
		const img = await loadImage(objectUrl);
		const plan = planSquareCrop({
			width: img.naturalWidth,
			height: img.naturalHeight,
			max: MAX_EDGE,
		});
		if (!plan.out) throw new Error('That image has no pixels to crop.');

		const canvas = document.createElement('canvas');
		canvas.width = plan.out;
		canvas.height = plan.out;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('This browser could not prepare the image for upload.');
		ctx.drawImage(img, plan.sx, plan.sy, plan.size, plan.size, 0, 0, plan.out, plan.out);

		let requested = 'image/webp';
		let blob = await canvasToBlob(canvas, requested);
		if (!blob) {
			requested = 'image/jpeg';
			blob = await canvasToBlob(canvas, requested);
		}
		if (!blob) throw new Error('This browser could not encode the resized image.');

		// toBlob falls back to another format when the requested one is
		// unsupported, so trust blob.type whenever it is one we can name.
		const mime = EXTENSION_BY_MIME[blob.type] ? blob.type : requested;
		return { blob, mime };
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}

const HINT = `Drag an image here or click the avatar. PNG, JPEG or WebP, up to 10 MB — cropped to a square and shrunk to ${MAX_EDGE}px before it leaves your browser. Saved as soon as it uploads.`;

export default function AvatarUpload({
	profileId,
	currentUrl,
	canEdit,
	initials = '',
	showUrlField = true,
	compact = false,
}: {
	profileId: string;
	currentUrl: string | null;
	canEdit: boolean;
	initials?: string;
	/**
	 * The `photo_url` text input and its form-grid placement only make sense
	 * INSIDE the edit form, where the surrounding form posts that field (see the
	 * header note — this is what stops "Save profile" mid-upload from undoing
	 * the photo). The profile header renders the same uploader with no form
	 * around it, so it turns the field off. There must never be two
	 * `photo_url` inputs on one page.
	 */
	showUrlField?: boolean;
	/**
	 * Dense variant for the profile header: the avatar itself is the whole
	 * control — click or drop on it — with no dashed box, no buttons and no hint
	 * paragraph. The full variant is roughly as tall as the name plus the facts
	 * line, which defeats the point of a dense header. The long explanation
	 * moves onto the button's accessible label instead of being lost.
	 */
	compact?: boolean;
}) {
	// `url` is both the preview source and the value posted as `photo_url` by
	// the surrounding form — see the header note.
	const [url, setUrl] = useState<string>(currentUrl ?? '');
	const [busy, setBusy] = useState(false);
	const [dragging, setDragging] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const fileInput = useRef<HTMLInputElement>(null);

	const handleFile = useCallback(
		async (file: File | null | undefined) => {
			if (!file || busy) return;
			setError(null);
			setNotice(null);

			if (!ACCEPTED_MIME.includes(file.type)) {
				setError('Pick a PNG, JPEG or WebP image — that file type is not supported.');
				return;
			}
			if (file.size > MAX_BYTES) {
				setError('That image is larger than 10 MB — pick a smaller one.');
				return;
			}

			setBusy(true);
			const previousPath = storagePathFromUrl(url || null);
			try {
				const { blob, mime } = await toSquareBlob(file);
				const extension = EXTENSION_BY_MIME[mime] ?? 'jpg';
				// The timestamp is deliberate. A stable filename would keep being
				// served from the CDN cache and the new photo would not appear.
				const path = `${profileId}/avatar-${Date.now()}.${extension}`;

				const supabase = createClient();
				const { error: uploadError } = await supabase.storage
					.from(BUCKET)
					.upload(path, blob, { contentType: mime, upsert: false, cacheControl: '31536000' });
				if (uploadError) {
					setError(`Upload failed: ${uploadError.message}`);
					return;
				}

				const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
				const saved = await setProfilePhoto(profileId, publicUrl);
				if (!saved.ok) {
					// Don't leave an orphan object behind a failed save.
					await supabase.storage.from(BUCKET).remove([path]);
					setError(saved.error);
					return;
				}

				setUrl(publicUrl);
				setNotice('Photo updated.');

				// Best effort: the bucket should not accumulate one file per
				// upload forever. A stale object is not worth failing over.
				if (previousPath && previousPath !== path) {
					const { error: removeError } = await supabase.storage
						.from(BUCKET)
						.remove([previousPath]);
					if (removeError) {
						console.error('[avatar] could not delete the previous photo:', removeError);
					}
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Something went wrong with that image.');
			} finally {
				setBusy(false);
				if (fileInput.current) fileInput.current.value = '';
			}
		},
		[busy, profileId, url],
	);

	const handleRemove = useCallback(async () => {
		if (busy) return;
		setError(null);
		setNotice(null);
		setBusy(true);
		const previousPath = storagePathFromUrl(url || null);
		try {
			const saved = await setProfilePhoto(profileId, null);
			if (!saved.ok) {
				setError(saved.error);
				return;
			}
			setUrl('');
			setNotice('Photo removed.');
			if (previousPath) {
				const supabase = createClient();
				const { error: removeError } = await supabase.storage.from(BUCKET).remove([previousPath]);
				if (removeError) {
					console.error('[avatar] could not delete the removed photo:', removeError);
				}
			}
		} finally {
			setBusy(false);
		}
	}, [busy, profileId, url]);

	const avatar = (
		<div className="w-20 h-20 rounded-full bg-primary-600 flex items-center justify-center text-white text-xl font-bold shrink-0 overflow-hidden">
			{url ? (
				// eslint-disable-next-line @next/next/no-img-element
				<img src={url} alt="" className="w-full h-full object-cover" />
			) : (
				initials
			)}
		</div>
	);

	// No upload affordance at all for a viewer who can't edit this profile.
	if (!canEdit) return avatar;

	const fileField = (
		<input
			ref={fileInput}
			type="file"
			accept={ACCEPTED_MIME.join(',')}
			className="hidden"
			onChange={(e) => void handleFile(e.target.files?.[0])}
		/>
	);

	const dropHandlers = {
		onDragOver: (e: DragEvent) => {
			e.preventDefault();
			if (!busy) setDragging(true);
		},
		onDragLeave: () => setDragging(false),
		onDrop: (e: DragEvent) => {
			e.preventDefault();
			setDragging(false);
			if (busy) return;
			// Dragging an image out of another tab hands us a URL, not a File, so
			// files is empty and there is nothing to upload.
			if (!e.dataTransfer.files?.length) {
				setError(
					'Drop an image file from your computer — an image dragged from another tab is not supported.',
				);
				return;
			}
			void handleFile(e.dataTransfer.files[0]);
		},
	};

	if (compact) {
		return (
			<div className="shrink-0">
				<button
					type="button"
					{...dropHandlers}
					onClick={() => fileInput.current?.click()}
					disabled={busy}
					title={HINT}
					aria-label="Change this photo — upload a PNG, JPEG or WebP image up to 10 MB"
					className={`group relative rounded-full transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed ${
						dragging ? 'ring-2 ring-primary-500 ring-offset-2' : ''
					}`}
				>
					{avatar}
					<span
						className="absolute inset-0 hidden items-center justify-center rounded-full bg-slate-900/55 text-2xs font-medium text-white group-hover:flex group-focus-visible:flex"
						aria-hidden="true"
					>
						<Camera className="w-4 h-4" />
					</span>
					{busy && (
						<span className="absolute inset-0 flex items-center justify-center rounded-full bg-slate-900/50">
							<Loader2 className="w-5 h-5 animate-spin text-white" />
						</span>
					)}
				</button>
				{fileField}
				{error && (
					<p className="mt-1 max-w-[12rem] text-2xs text-red-600 dark:text-red-400">{error}</p>
				)}
			</div>
		);
	}

	return (
		<div className={showUrlField ? 'sm:col-span-2 space-y-2' : 'space-y-2'}>
			{showUrlField && (
				<span className="block text-xs font-medium text-slate-600 dark:text-slate-400">Photo</span>
			)}

			<div
				{...dropHandlers}
				className={`flex items-center gap-4 rounded-lg border border-dashed px-3 py-3 transition-colors ${
					dragging
						? 'border-primary-500 bg-primary-50 dark:bg-primary-950/30'
						: 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60'
				} ${busy ? 'opacity-60' : ''}`}
			>
				<button
					type="button"
					onClick={() => fileInput.current?.click()}
					disabled={busy}
					aria-label="Choose a photo to upload"
					className="relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed"
				>
					{avatar}
					{busy && (
						<span className="absolute inset-0 flex items-center justify-center rounded-full bg-slate-900/50">
							<Loader2 className="w-5 h-5 animate-spin text-white" />
						</span>
					)}
				</button>

				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<Button
							type="button"
							size="sm"
							variant="outline"
							disabled={busy}
							onClick={() => fileInput.current?.click()}
						>
							<Upload className="w-3 h-3" /> Upload a photo
						</Button>
						{url && (
							<Button
								type="button"
								size="sm"
								variant="ghost"
								disabled={busy}
								onClick={() => void handleRemove()}
							>
								<Trash2 className="w-3 h-3" /> Remove
							</Button>
						)}
					</div>
					<p className="text-2xs text-slate-600 dark:text-slate-400 mt-1.5">{HINT}</p>
				</div>

				{fileField}
			</div>

			{error && <Callout tone="error">{error}</Callout>}
			{notice && !error && <Callout tone="success">{notice}</Callout>}

			{/* The input below is `readOnly` while an upload runs, never `disabled`:
			    a disabled control is barred from form submission, so saving the
			    profile mid-upload would post no `photo_url` and saveProfile()
			    would null the column. */}
			{showUrlField && (
				<Field
					label="Or use an externally hosted image"
					hint="Optional fallback for a photo that lives outside this app — a public image link (Drive/S3 links must allow anonymous view). Uploading replaces whatever is here."
				>
					<input
						name="photo_url"
						type="url"
						value={url}
						onChange={(e) => setUrl(e.target.value)}
						readOnly={busy}
						placeholder="https://…"
						className={inputClass}
					/>
				</Field>
			)}
		</div>
	);
}

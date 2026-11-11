// Shared form atoms for the /team edit screens. Mirrors the classes of
// @/components/ui/{Input,Select} but as plain elements, so these forms stay
// server components (same approach as /clients/[id]/edit).

export const inputClass =
	'w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500 dark:focus:border-primary-400 dark:focus:ring-primary-400';

// Mirrors ui/Select's chevron without needing a client component: CSS-only
// arrow via an inline SVG background (the OS-native arrow made every People
// select visibly different from the rest of the app).
export const selectClass =
	inputClass +
	// URL-encoded, not base64: the previous base64 blob hid a `stroke='#94a3b8'`
	// — Tailwind's slate-400, a banned neutral family — where neither
	// ui-audit.sh nor a human reading the file could see it. brandGray-400 is
	// #a0a0a0. Keep this readable so the next colour change is reviewable.
	" appearance-none pr-8 bg-no-repeat bg-[right_0.5rem_center] bg-[length:1rem_1rem] bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23a0a0a0' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]";

/** Dark-mode-correct checkbox: white surface in light, slate-900 in dark
 *  (the default rendered as a light box on dark cards — Sam, 18/08). */
export const checkboxClass =
	'rounded-sm border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-primary-600 focus:ring-primary-500 focus:ring-offset-0 dark:checked:bg-primary-600 dark:checked:border-primary-600';

export function Field({
	label,
	hint,
	wide,
	children,
}: {
	label: string;
	hint?: string;
	wide?: boolean;
	children: React.ReactNode;
}) {
	return (
		<label className={`flex flex-col gap-1 ${wide ? 'sm:col-span-2' : ''}`}>
			<span className="text-xs font-medium text-slate-600 dark:text-slate-400">{label}</span>
			{children}
			{hint && <span className="text-2xs text-slate-600 dark:text-slate-400">{hint}</span>}
		</label>
	);
}

export function CheckboxRow({
	name,
	defaultChecked,
	children,
}: {
	name: string;
	defaultChecked?: boolean;
	children: React.ReactNode;
}) {
	return (
		<label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
			<input
				type="checkbox"
				name={name}
				defaultChecked={defaultChecked}
				className={checkboxClass}
			/>
			{children}
		</label>
	);
}

export function FormError({ message }: { message?: string }) {
	if (!message) return null;
	return (
		<div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2">
			<p className="text-sm text-red-700 dark:text-red-300">{message}</p>
		</div>
	);
}

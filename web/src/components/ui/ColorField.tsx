'use client';

import { clsx } from 'clsx';
import { RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fieldFocus } from './focus';
import IconButton from './IconButton';

// ColorField — a colour picker plus its hex text box, with an optional
// "back to default" button. Emits only valid #rrggbb values (or null for
// "use the default").

const HEX = /^#[0-9a-fA-F]{6}$/;

interface ColorFieldProps {
	id: string;
	label: string;
	help?: string;
	value: string | null | undefined;
	defaultValue: string;
	onChange: (next: string | null) => void;
	disabled?: boolean;
}

export default function ColorField({ id, label, help, value, defaultValue, onChange, disabled }: ColorFieldProps) {
	const effective = value ?? defaultValue;
	const [text, setText] = useState(effective);
	useEffect(() => { setText(effective); }, [effective]);
	const overridden = !!value && value.toLowerCase() !== defaultValue.toLowerCase();
	const commit = (v: string) => {
		const norm = v.trim().toLowerCase();
		if (!HEX.test(norm)) { setText(effective); return; }
		onChange(norm === defaultValue.toLowerCase() ? null : norm);
	};
	return (
		<div className="flex items-start gap-3">
			<label htmlFor={`${id}-swatch`} className="relative mt-0.5 h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-md border border-slate-300 dark:border-slate-600" style={{ background: effective }}>
				<input
					id={`${id}-swatch`}
					type="color"
					value={effective}
					disabled={disabled}
					onChange={(e) => commit(e.target.value)}
					className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
					aria-label={`${label} colour picker`}
				/>
			</label>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<label htmlFor={id} className="text-sm font-medium text-slate-800 dark:text-slate-200">{label}</label>
					{overridden && <span className="rounded-full bg-primary-50 px-1.5 text-2xs font-medium text-primary-900 dark:bg-primary-950 dark:text-primary-300">custom</span>}
				</div>
				{help && <p className="text-2xs text-slate-600 dark:text-slate-400">{help}</p>}
			</div>
			<input
				id={id}
				value={text}
				disabled={disabled}
				spellCheck={false}
				onChange={(e) => setText(e.target.value)}
				onBlur={(e) => commit(e.target.value)}
				onKeyDown={(e) => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }}
				className={clsx('w-24 rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-slate-600 dark:bg-slate-800', fieldFocus)}
				aria-describedby={help ? `${id}-help` : undefined}
			/>
			<IconButton aria-label={`Reset ${label} to default`} size="sm" disabled={disabled || !overridden} onClick={() => onChange(null)} title={`Default ${defaultValue}`}>
				<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
			</IconButton>
		</div>
	);
}

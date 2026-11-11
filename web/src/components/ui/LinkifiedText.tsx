'use client';

// Plain text with its URLs turned into links that open in a new tab. For
// user-written text (descriptions, comments) rendered as-is: no markdown, no
// HTML, only http(s) and www. links. Trailing punctuation stays outside the
// link ("see https://x.com." links https://x.com). A click on a link does not
// bubble, so a link inside a click-to-edit field opens instead of editing.

import { Fragment } from 'react';
import { splitLinks } from '@/lib/linkify';

export default function LinkifiedText({ text, className }: { text: string; className?: string }) {
	return (
		<span className={className}>
			{splitLinks(text).map((part, i) =>
				part.href ? (
					<a
						key={i}
						href={part.href}
						target="_blank"
						rel="noopener noreferrer"
						onClick={(e) => e.stopPropagation()}
						className="break-all text-primary-700 underline hover:text-primary-800 dark:text-primary-300 dark:hover:text-primary-200"
					>
						{part.text}
					</a>
				) : (
					<Fragment key={i}>{part.text}</Fragment>
				),
			)}
		</span>
	);
}

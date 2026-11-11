// Shared chrome for the public careers pages (0129). Signed-out, light,
// embeddable (?embed=1 hides the header so example.com can iframe
// it; the subpath rewrite is the SEO-friendly option).

import Link from 'next/link';

export default function CareersShell({ children, embed = false, headline }: { children: React.ReactNode; embed?: boolean; headline?: string }) {
	return (
		<main className="min-h-screen bg-slate-50 text-slate-900">
			{!embed && (
				<header className="bg-primary-700 text-white">
					<div className="max-w-4xl mx-auto px-4 py-8">
						<div className="text-2xs uppercase tracking-wider text-primary-100">Open Ronin · Careers</div>
						<h1 className="text-2xl sm:text-3xl font-bold tracking-tight mt-1">{headline ?? 'Work with brands that give back.'}</h1>
					</div>
				</header>
			)}
			<div className="max-w-4xl mx-auto px-4 py-8">{children}</div>
			{!embed && (
				<footer className="max-w-4xl mx-auto px-4 pb-10 text-2xs text-slate-500 flex flex-wrap gap-3">
					<Link href="/careers" className="underline">
						All roles
					</Link>
					<a href="https://example.com" className="underline">
						example.com
					</a>
					<Link href="/privacy" className="underline">
						Privacy
					</Link>
					<Link href="/careers/feed.xml" className="underline">
						Jobs feed (XML)
					</Link>
				</footer>
			)}
		</main>
	);
}

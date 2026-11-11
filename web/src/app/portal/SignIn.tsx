// Portal sign-in: email → magic link. Only emails with a portal row get a
// link; the message is the same either way (no enumeration).

export default function SignIn({ sent, error, supportEmail }: { sent: boolean; error: string | null; supportEmail: string }) {
	return (
		<main className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center px-4">
			<div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-panel">
				<div className="text-2xs uppercase tracking-wider text-primary-700">Open Ronin</div>
				<h1 className="text-xl font-bold tracking-tight mt-1 mb-2">Client portal</h1>
				<p className="text-sm text-slate-600 mb-4">Enter the email we have on file and we&apos;ll send you a sign-in link. No password to remember.</p>
				{sent ? (
					<div className="rounded-md border border-green-200 bg-green-50 text-green-800 text-sm px-3 py-2">If that email is on file, a sign-in link is on its way. It works once and expires in an hour.</div>
				) : (
					<form action="/api/portal/signin" method="post" className="space-y-3">
						{error && <div className="rounded-md border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}
						<input type="email" name="email" required placeholder="you@company.com" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500" />
						<button type="submit" className="w-full rounded-md bg-primary-700 text-white text-sm font-medium px-3 py-2 hover:bg-primary-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
							Email me a sign-in link
						</button>
					</form>
				)}
				<p className="mt-4 text-2xs text-slate-500">
					Not a client yet, or the wrong email? Write to <a href={`mailto:${supportEmail}`} className="underline">{supportEmail}</a>.
				</p>
			</div>
		</main>
	);
}

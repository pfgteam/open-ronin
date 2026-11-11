// Which email domains count as "us". Pure and synchronous so deep helpers
// (calendar classification, ingest filters, calibration) can use it without a
// DB round trip. Source: NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS, which INSTALL.md
// Step 4 fills from org.allowed_email_domains in open-ronin.config.yaml (the
// same list the setup wizard stores in org_settings and the sign-up gate in
// public.enforce_email_domain() reads).

export function envOrgDomains(): string[] {
	return (process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS ?? '')
		.split(',')
		.map((d) => d.trim().toLowerCase().replace(/^@/, ''))
		.filter(Boolean);
}

/** True when the email's domain is one of the org's domains. */
export function isInternalEmail(email: string | null | undefined, domains: readonly string[] = envOrgDomains()): boolean {
	if (!email) return false;
	const d = email.split('@')[1]?.trim().toLowerCase();
	return !!d && domains.includes(d);
}

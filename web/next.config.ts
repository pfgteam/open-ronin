import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
	// Build hardening
	reactStrictMode: true,
	poweredByHeader: false,

	// Two legitimate lockfiles exist (root has its own scripts package.json),
	// which makes Next guess the workspace root and warn on every command.
	// The app root is this directory; say so.
	outputFileTracingRoot: path.join(__dirname),

	// Type-check and lint gate the build again (2026-08-25): the strict-mode
	// backlog is cleared — tsc and next lint both pass with zero findings.
	// They were skipped to unblock the first prod deploy.
	typescript: { ignoreBuildErrors: false },
	eslint: { ignoreDuringBuilds: false },

	// Image optimization allowlist — Airtable attachment URLs come from these hosts
	images: {
		remotePatterns: [
			{ protocol: 'https', hostname: 'dl.airtableusercontent.com' },
			{ protocol: 'https', hostname: 'v5.airtableusercontent.com' },
			{ protocol: 'https', hostname: 'lh3.googleusercontent.com' }, // Google avatars
		],
	},

	// All env vars are read via process.env at runtime; no need to whitelist here
	// for NEXT_PUBLIC_* ones — Next 13+ auto-exposes those.
};

export default nextConfig;

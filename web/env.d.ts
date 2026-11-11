// Typed process.env for the web app. Every variable the app reads is
// declared here; docs/ENV.md is the human readable inventory with what each
// one is required for. Add the variable in both places in the same commit.
//
// Everything is optional on purpose: presence is a deployment fact, not a
// compile time one. Code that needs a value checks for it and fails with a
// clear message (lib/scrapers/apify.ts, lib/ghl/crypto.ts) or degrades
// (admin/integrations shows "not set"). Never read a value into the UI;
// show whether it is present.
//
// NEXT_PUBLIC_* are inlined into the browser bundle at build time. Nothing
// else ever reaches the client.

declare global {
	namespace NodeJS {
		interface ProcessEnv {
			// Core: Supabase (required for the app to boot)
			NEXT_PUBLIC_SUPABASE_URL?: string;
			NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
			SUPABASE_SERVICE_ROLE_KEY?: string;

			// Core: app identity
			NEXT_PUBLIC_APP_URL?: string;
			NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS?: string;

			// Core: shared secrets for machine callers
			CRON_SECRET?: string;
			INGEST_API_KEY?: string;

			// Airtable mirror (Clients, Media, Data browser)
			AIRTABLE_PAT?: string;
			AIRTABLE_WORKSPACE_ID?: string;

			// Google: service account (Metrics sheets) and OAuth (Calendar)
			GOOGLE_SERVICE_ACCOUNT_JSON?: string;
			METRICS_SPREADSHEET_ID?: string;
			GOOGLE_OAUTH_CLIENT_ID?: string;
			GOOGLE_OAUTH_CLIENT_SECRET?: string;
			NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID?: string;

			// GoHighLevel OAuth
			GHL_CLIENT_ID?: string;
			GHL_CLIENT_SECRET?: string;
			GHL_REDIRECT_URI?: string;
			GHL_API_BASE?: string;
			GHL_AUTHORIZE_URL?: string;
			GHL_SCOPES?: string;
			/** 64 hex chars. Shared with the Google Calendar flow for refresh tokens at rest. */
			GHL_TOKEN_ENC_KEY?: string;

			// Email
			AUTH_EMAIL_ENABLED?: string;
			RESEND_API_KEY?: string;
			RESEND_FROM_EMAIL?: string;

			// Scrapers (Lead Scraper, Acquisitions, Media Scraper)
			APIFY_TOKEN?: string;

			// Comms bridges
			META_WEBHOOK_VERIFY_TOKEN?: string;

			// Beacon classifier (calendar event attribution)
			CLASSIFIER_AI_URL?: string;
			CLASSIFIER_AI_KEY?: string;

			// WIP build, module 1: content providers. Ready slots; presence only.
			ANTHROPIC_API_KEY?: string;
			OPENAI_API_KEY?: string;
			GOOGLE_AI_API_KEY?: string;
			XAI_API_KEY?: string;
			PERPLEXITY_API_KEY?: string;
			IDEOGRAM_API_KEY?: string;
			STABILITY_API_KEY?: string;
			BFL_API_KEY?: string;
			RECRAFT_API_KEY?: string;
			LEONARDO_API_KEY?: string;
			HEYGEN_API_KEY?: string;
			RUNWAY_API_KEY?: string;
			KLING_ACCESS_KEY?: string;
			KLING_SECRET_KEY?: string;
			LUMA_API_KEY?: string;
			SYNTHESIA_API_KEY?: string;
			ELEVENLABS_API_KEY?: string;
			SUNO_API_KEY?: string;
			OPUSCLIP_API_KEY?: string;
			DESCRIPT_API_KEY?: string;
			CANVA_CLIENT_ID?: string;
			CANVA_CLIENT_SECRET?: string;
			DEEPGRAM_API_KEY?: string;
			ASSEMBLYAI_API_KEY?: string;
			PEXELS_API_KEY?: string;
			UNSPLASH_ACCESS_KEY?: string;
			METRICOOL_API_KEY?: string;

			// WIP build, module 3: Dev Dashboard (read only tokens)
			GITHUB_TOKEN?: string;
			VERCEL_TOKEN?: string;
			VERCEL_PROJECT_ID?: string;
			VERCEL_TEAM_ID?: string;
			SUPABASE_ACCESS_TOKEN?: string;
			SUPABASE_PROJECT_REF?: string;
			/** Not installed; the Dev Dashboard names it on the error rate tile. */
			SENTRY_DSN?: string;

			// WIP build, module 6: n8n inventory
			N8N_API_URL?: string;
			N8N_API_KEY?: string;
		}
	}
}

export {};

// GoHighLevel marketplace-app config.
//
// Required env vars:
//   GHL_CLIENT_ID          - Marketplace app client id
//   GHL_CLIENT_SECRET      - Marketplace app client secret
//   GHL_REDIRECT_URI       - Must match the redirect URI configured on the GHL app
//   GHL_TOKEN_ENC_KEY      - 32-byte hex string for AES-256-GCM token encryption
//
// Optional:
//   GHL_API_BASE           - default https://services.leadconnectorhq.com
//   GHL_AUTHORIZE_URL      - default https://marketplace.gohighlevel.com/oauth/chooselocation
//   GHL_SCOPES             - space-separated; default includes contacts/opportunities/locations

export const GHL_CONFIG = {
	clientId: process.env.GHL_CLIENT_ID ?? '',
	clientSecret: process.env.GHL_CLIENT_SECRET ?? '',
	redirectUri: process.env.GHL_REDIRECT_URI ?? '',
	apiBase: process.env.GHL_API_BASE ?? 'https://services.leadconnectorhq.com',
	authorizeUrl: process.env.GHL_AUTHORIZE_URL ?? 'https://marketplace.gohighlevel.com/oauth/chooselocation',
	apiVersion: '2021-07-28',
	scopes:
		process.env.GHL_SCOPES ??
		[
			'contacts.readonly',
			'contacts.write',
			'opportunities.readonly',
			'opportunities.write',
			'locations.readonly',
			'locations/customFields.readonly',
			'conversations.readonly',
			'conversations/message.readonly',
			'calendars.readonly',
			'calendars/events.readonly',
			'users.readonly',
		].join(' '),
};

export function isGhlConfigured(): boolean {
	return Boolean(GHL_CONFIG.clientId && GHL_CONFIG.clientSecret && GHL_CONFIG.redirectUri);
}

/**
 * Build the authorize URL the user is redirected to when installing the app.
 * GHL's chooselocation URL lets the installer pick which sub-account to
 * connect (or pick "agency" for company-scope).
 */
export function buildAuthorizeUrl(state: string): string {
	const params = new URLSearchParams({
		response_type: 'code',
		redirect_uri: GHL_CONFIG.redirectUri,
		client_id: GHL_CONFIG.clientId,
		scope: GHL_CONFIG.scopes,
		state,
	});
	return GHL_CONFIG.authorizeUrl + '?' + params.toString();
}

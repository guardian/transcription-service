import {
	ClientConfig,
	TranscriptExportRequest,
} from '@guardian/transcription-service-common';
import { authFetch } from '@/helpers';

const getClientConfig = async (authToken: string): Promise<ClientConfig> => {
	const configResp = await authFetch('/api/client-config', authToken);
	if (!configResp) {
		throw new Error('Failed to fetch client config');
	}
	const configJson = await configResp.json();
	const parseResult = ClientConfig.safeParse(configJson);
	if (!parseResult.success) {
		throw new Error(
			`Failed to parse client config, ${parseResult.error.message}`,
		);
	}
	return parseResult.data;
};
const promiseInitTokenClient = (
	clientId: string,
	scope: string,
): Promise<google.accounts.oauth2.TokenResponse> => {
	return new Promise((resolve, reject) => {
		const client = google.accounts.oauth2.initTokenClient({
			client_id: clientId,
			scope,
			callback: (tokenResponse: google.accounts.oauth2.TokenResponse) => {
				if (!google.accounts.oauth2.hasGrantedAllScopes(tokenResponse, scope)) {
					const msg = "User didn't grant drive permissions.";
					console.error(msg);
					return reject(msg);
				}
				resolve(tokenResponse);
			},
			error_callback: (error: google.accounts.oauth2.ClientConfigError) => {
				const msg = `Error fetching google auth token: ${error.message}`;
				console.error(msg);
				return reject(msg);
			},
		});
		// we have to actually call this otherwise the above promise will never resolve
		client.requestAccessToken();
	});
};

export const exportTranscript = async (
	authToken: string,
	transcriptId: string,
): Promise<Response> => {
	const config = await getClientConfig(authToken);

	const driveFileScope = 'https://www.googleapis.com/auth/drive.file';

	const tokenResponse = await promiseInitTokenClient(
		config.googleClientId,
		driveFileScope,
	);

	const exportRequest: TranscriptExportRequest = {
		id: transcriptId,
		// @ts-expect-error (return object from google isn't actually a TokenResponse, our zod type is more accurate)
		oAuthTokenResponse: tokenResponse,
	};

	const exportResponse = await authFetch('/api/export', authToken, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(exportRequest),
	});
	return exportResponse;
};

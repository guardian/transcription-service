import {
	ClientConfig,
	CreateFolderRequest,
	ExportItems,
	TranscriptExportRequest,
} from '@guardian/transcription-service-common';
import { authFetch } from '@/helpers';
import TokenResponse = google.accounts.oauth2.TokenResponse;

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

export const getOAuthToken = async (
	authToken: string,
): Promise<TokenResponse> => {
	const config = await getClientConfig(authToken);

	const driveFileScope = 'https://www.googleapis.com/auth/drive.file';

	const tokenResponse = await promiseInitTokenClient(
		config.googleClientId,
		driveFileScope,
	);
	return tokenResponse;
};

export const createExportFolder = async (
	authToken: string,
	tokenResponse: TokenResponse,
	transcriptId: string,
) => {
	const createFolderRequest: CreateFolderRequest = {
		transcriptId: transcriptId,
		// @ts-expect-error (return object from google isn't actually a TokenResponse, our zod type is more accurate)
		oAuthTokenResponse: tokenResponse,
	};

	const createFolderResponse = await authFetch(
		'/api/export/create-folder',
		authToken,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(createFolderRequest),
		},
	);

	return createFolderResponse;
};

export const exportTranscript = async (
	authToken: string,
	tokenResponse: TokenResponse,
	transcriptId: string,
	items: ExportItems,
	folderId: string,
): Promise<Response> => {
	const exportRequest: TranscriptExportRequest = {
		id: transcriptId,
		// @ts-expect-error (return object from google isn't actually a TokenResponse, our zod type is more accurate)
		oAuthTokenResponse: tokenResponse,
		items,
		folderId,
	};

	// we don't await here so that the caller (JSX component) can carry on updating the UI
	const exportPromise = authFetch('/api/export/export', authToken, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(exportRequest),
	});
	return exportPromise;
};

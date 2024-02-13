import React, { useContext, useState } from 'react';
import { authFetch } from '@/helpers';
import {
	ClientConfig,
	ExportResponse,
	TranscriptExportRequest,
} from '@guardian/transcription-service-common';
import { AuthContext } from '@/app/template';
import Script from 'next/script';
import { useSearchParams } from 'next/navigation';

const getClientConfig = async (authToken?: string): Promise<ClientConfig> => {
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

const exportTranscript = async (
	authToken: string | undefined,
	transcriptId: string,
): Promise<Response | null> => {
	const config = await getClientConfig(authToken);
	if (config === null) {
		throw Error('Client config unavailable. Cannot authenticate with Google');
	}

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
	if (exportResponse) {
		return exportResponse.json();
	}
	return null;
};
const ExportButton = () => {
	const auth = useContext(AuthContext);
	const searchParams = useSearchParams();
	const [docId, setDocId] = useState<string | undefined>(undefined);
	const [loading, setLoading] = useState(false);
	if (!auth.token) {
		return <p>Cannot export -missing auth token</p>;
	}
	const transcriptId = searchParams.get('transcriptId');
	if (!transcriptId) {
		return <p>Cannot export -missing transcript id</p>;
	}
	if (loading) {
		return 'exporting....';
	}
	if (docId) {
		return (
			<a href={`https://docs.google.com/document/d/${docId}`} target={'_blank'}>
				View transcript
			</a>
		);
	}
	return (
		<>
			<Script src="https://accounts.google.com/gsi/client" async></Script>
			<button
				onClick={async () => {
					setLoading(true);
					const response = await exportTranscript(auth.token, transcriptId);
					setLoading(false);
					const parsedResponse = ExportResponse.safeParse(response);
					if (parsedResponse.success) {
						console.log('setting doc id');
						setDocId(parsedResponse.data.documentId);
					}
				}}
			>
				export
			</button>
		</>
	);
};

export default ExportButton;

import React, { useContext, useState } from 'react';
import { ExportResponse } from '@guardian/transcription-service-common';
import { AuthContext } from '@/app/template';
import Script from 'next/script';
import { useSearchParams } from 'next/navigation';
import { exportTranscript } from '@/services/export';

const ExportButton = () => {
	const auth = useContext(AuthContext);
	const searchParams = useSearchParams();
	const [docId, setDocId] = useState<string | undefined>();
	const [loading, setLoading] = useState(false);
	const [exportFailed, setExportFailed] = useState<string | undefined>();
	const token = auth.token;
	// TODO: once we have some CSS/component library, tidy up this messy error handling
	if (!token) {
		return <p>Cannot export - missing auth token</p>;
	}
	const transcriptId = searchParams.get('transcriptId');
	if (!transcriptId) {
		return <p>Cannot export -missing transcript id</p>;
	}
	if (exportFailed) {
		return <p>Export failed with error {exportFailed}</p>;
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
					const response = await exportTranscript(token, transcriptId);
					setLoading(false);
					if (response && response.status !== 200) {
						const text = await response.text();
						setExportFailed(text);
						return;
					}
					const json = await response.json();
					const parsedResponse = ExportResponse.safeParse(json);
					if (!parsedResponse.success) {
						console.error(
							'Failed to parse export response',
							parsedResponse.error,
						);
						setExportFailed(
							`Export succeeded but failed to get document id - check your google drive`,
						);
						return;
					}
					setDocId(parsedResponse.data.documentId);
				}}
			>
				export
			</button>
		</>
	);
};

export default ExportButton;

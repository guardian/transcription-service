import React, { useContext, useState } from 'react';
import { ExportResponse } from '@guardian/transcription-service-common';
import { AuthContext } from '@/app/template';
import Script from 'next/script';
import { useSearchParams } from 'next/navigation';
import { exportTranscript } from '@/services/export';

const ExportButton = () => {
	const auth = useContext(AuthContext);
	const searchParams = useSearchParams();
	const [docId, setDocId] = useState<string | undefined>(undefined);
	const [loading, setLoading] = useState(false);
	const token = auth.token;
	// TODO: once we have some CSS/component library, tidy up this messy error handling
	if (!token) {
		return <p>Cannot export - missing auth token</p>;
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
					const response = await exportTranscript(token, transcriptId);
					setLoading(false);
					const parsedResponse = ExportResponse.safeParse(response);
					if (parsedResponse.success) {
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

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
export const getSESClient = (region: string) => {
	return new SESClient({ region });
};

export const sendEmail = async (
	client: SESClient,
	fromAddress: string,
	recipientEmail: string,
	originalFilename: string,
) => {
	const sendCommand = new SendEmailCommand({
		Source: fromAddress,
		Destination: {
			ToAddresses: [recipientEmail],
		},
		Message: {
			Subject: {
				Data: `Transcription complete for ${originalFilename}`,
			},
			Body: {
				Text: {
					Data: 'Your transcript is ready to download - click here: https://www.youtube.com/watch?v=dQw4w9WgXcQ.',
				},
			},
		},
	});
	try {
		await client.send(sendCommand);
	} catch (error) {
		console.error('Error sending email:', error);
		throw error;
	}
};

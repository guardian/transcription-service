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
	console.log(`Sending email from ${fromAddress} to ${recipientEmail}`);
	const sendCommand = new SendEmailCommand({
		Source: fromAddress,
		Destination: {
			ToAddresses: [recipientEmail],
		},
		Message: {
			Subject: {
				Charset: 'UTF-8',
				Data: `Transcription complete for ${originalFilename}`,
			},
			Body: {
				Html: {
					Charset: 'UTF-8',
					Data: `Your transcript is ready to download - click <a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">here</a>.`,
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

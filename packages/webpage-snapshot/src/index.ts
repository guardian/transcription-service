import { Handler } from 'aws-lambda';
import { IncomingSQSEvent } from './sqs-event-types';
import { logger } from '@guardian/transcription-service-backend-common';
import { getTestMessage } from '../test/testMessage';

const runningLocally = !process.env['AWS_EXECUTION_ENV'];

import chromium from '@sparticuz/chromium';
import { uploadToS3 } from '@guardian/transcription-service-common';

const getBrowser = async () => {
	if (runningLocally) {
		const puppeteer = await import('puppeteer');
		return puppeteer.launch({
			headless: true,
			args: puppeteer.defaultArgs({ headless: true }),
		});
	} else {
		const puppeteer = await import('puppeteer-core');
		return puppeteer.launch({
			args: puppeteer.defaultArgs({ headless: 'shell' }),
			executablePath: await chromium.executablePath(),
			headless: 'shell',
			dumpio: true,
		});
	}
};

const processMessage = async (event: unknown) => {
	const parsedEvent = IncomingSQSEvent.safeParse(event);
	if (!parsedEvent.success) {
		logger.error(
			`Failed to parse SQS message ${parsedEvent.error.message} + ${JSON.stringify(event)}`,
			event,
		);
		throw new Error('Failed to parse SQS message');
	}
	const browser = await getBrowser();
	const page = await browser.newPage();

	for (const record of parsedEvent.data.Records) {
		const url = record.body.url;
		// snapshot url using puppeteer
		logger.info(`Snapshotting url: ${url}`);
		await page.goto(url, {
			waitUntil: 'networkidle2',
		});
		const screenshotFilename = `${record.body.id}-screenshot`;
		const image = await page.screenshot({
			path: `/tmp/${screenshotFilename}.png`,
			fullPage: true,
			encoding: 'base64',
		});
		const html = await page.content();
		const output = {
			screenshotBase64: image,
			html,
		};
		const res = await uploadToS3(
			record.body.s3OutputSignedUrl,
			Buffer.from(JSON.stringify(output)),
			false,
		);
		console.log(res);
		await browser.close();
	}
};

const handler: Handler = async (event) => {
	await processMessage(event);
	return 'Finished processing Event';
};

// when running locally bypass the handler
if (!process.env['AWS_EXECUTION_ENV']) {
	getTestMessage().then((msg) => processMessage(msg));
}
export { handler as webpageSnapshot };

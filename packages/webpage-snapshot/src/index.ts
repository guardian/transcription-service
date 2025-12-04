import { Handler } from 'aws-lambda';
import { IncomingSQSEvent } from './sqs-event-types';
import {
	getConfig,
	getSQSClient,
	logger,
	sendMessage,
} from '@guardian/transcription-service-backend-common';
import { getTestMessage, sqsMessageToTestMessage } from '../test/testMessage';
import { PuppeteerBlocker } from '@ghostery/adblocker-puppeteer';
import crossFetch from 'cross-fetch';

import chromium from '@sparticuz/chromium';
import {
	ExternalJobOutput,
	uploadToS3,
	WebpageSnapshot,
} from '@guardian/transcription-service-common';
import { Page } from 'puppeteer-core';

const runningLocally = !process.env['AWS_EXECUTION_ENV'];

const getBrowser = async () => {
	if (runningLocally) {
		const puppeteer = await import('puppeteer');
		return puppeteer.launch({
			headless: true,
			args: puppeteer.defaultArgs({ headless: true }),
		});
	} else {
		logger.info(`Preparing puppeteer browser for lambda`);
		const puppeteer = await import('puppeteer-core');
		return puppeteer.launch({
			args: puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
			executablePath: await chromium.executablePath(),
			headless: 'shell',
			dumpio: true,
		});
	}
};

const snapshotPage = async (
	page: Page,
	url: string,
): Promise<WebpageSnapshot> => {
	logger.info(`Snapshotting url: ${url}`);

	const blocker = await PuppeteerBlocker.fromLists(crossFetch, [
		'https://secure.fanboy.co.nz/fanboy-cookiemonster.txt',
		'https://raw.githubusercontent.com/uBlockOrigin/uAssets/4248839208994e389687cd966f871c5b900840d1/filters/annoyances-cookies.txt',
	]);

	await blocker.enableBlockingInPage(page);

	await page.goto(url, {
		waitUntil: 'networkidle2',
	});

	const image = await page.screenshot({
		fullPage: true,
		encoding: 'base64',
		type: 'jpeg',
		quality: 100,
	});
	const html = await page.content();

	const title = await page.title();

	//sanitise title to reduce risk of injection attacks
	const sanitisedTitle = title
		.replace(/[^a-zA-Z0-9 \-_]/g, '')
		.substring(0, 200);

	return {
		screenshotBase64: image,
		html,
		title: sanitisedTitle,
	};
};

const processMessage = async (event: unknown) => {
	const config = await getConfig();
	console.log(JSON.stringify(event, null, 2));

	const sqsClient = getSQSClient(
		config.aws.region,
		config.aws.localstackEndpoint,
	);
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
		try {
			const snapshotJson = await snapshotPage(page, record.body.url);

			const s3Result = await uploadToS3(
				record.body.webpageSnapshotOutputSignedUrl,
				Buffer.from(JSON.stringify(snapshotJson)),
				false,
			);

			if (s3Result.isSuccess) {
				const output: ExternalJobOutput = {
					id: record.body.id,
					taskId: record.body.webpageSnapshotId,
					status: 'SUCCESS',
					outputType: 'WEBPAGE_SNAPSHOT',
				};
				await sendMessage(
					sqsClient,
					record.body.outputQueueUrl,
					JSON.stringify(output),
					record.body.id,
				);
			} else {
				logger.error(
					`Failed to upload snapshot to S3 for message ${record.body.id}`,
					s3Result.errorMsg,
				);
				throw new Error('Failed to upload snapshot to S3 for message');
			}
		} catch (error) {
			await sendMessage(
				sqsClient,
				record.body.outputQueueUrl,
				JSON.stringify({
					id: record.body.id,
					status: 'FAILURE',
				}),
				record.body.id,
			);
			logger.error(`Failed to process message ${record.body.id}`, error);
		}
	}
	await browser.close();
};

const handler: Handler = async (event) => {
	await processMessage(event);
	return 'Finished processing Event';
};

// when running locally bypass the handler
if (!process.env['AWS_EXECUTION_ENV']) {
	const messageBodyEnv = process.env['MESSAGE_BODY'];
	if (messageBodyEnv) {
		processMessage(sqsMessageToTestMessage(messageBodyEnv));
	} else {
		getTestMessage().then((msg) => processMessage(msg));
	}
}
export { handler as webpageSnapshot };

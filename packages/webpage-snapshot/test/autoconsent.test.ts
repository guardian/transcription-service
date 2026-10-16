import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import puppeteer, { Browser } from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { setupAutoconsent } from '../src/autoconsent';

let browser: Browser;
before(async () => {
	browser = await puppeteer.launch({
		executablePath:
			process.env['CHROMIUM_EXECUTABLE_PATH'] ||
			(await chromium.executablePath()),
		args: chromium.args,
		headless: 'shell',
	});
});
after(async () => {
	await browser?.close();
});

// Match the YouTube consent structure used by the upstream rules. Labels are
// deliberately not English, so the previous button-text matcher cannot pass.
const banner = (action: string) => `
<style>ytd-consent-bump-v2-lightbox,tp-yt-paper-dialog {display:block}</style>
<ytd-consent-bump-v2-lightbox><tp-yt-paper-dialog>
<a href="https://consent.youtube.com/">Cookies</a>
<div class="eom-buttons"><div class="eom-button-row">
<ytd-button-renderer><button onclick="${action}">Tout refuser</button></ytd-button-renderer>
<ytd-button-renderer><button onclick="window.accepted=true">Tout accepter</button></ytd-button-renderer>
</div></div></tp-yt-paper-dialog></ytd-consent-bump-v2-lightbox>`;

async function fixture(html: string, frameHtml?: string) {
	const page = await browser.newPage();
	await page.setRequestInterception(true);
	page.on('request', (request) => {
		void request.respond({
			contentType: 'text/html',
			body: request.url().includes('/frame')
				? frameHtml || ''
				: request.url().includes('/done')
					? '<h1>Video page</h1>'
					: html,
		});
	});
	const consent = await setupAutoconsent(page);
	await page.goto('https://www.youtube.com/watch?v=fixture', {
		waitUntil: 'domcontentloaded',
	});
	return { page, consent };
}

test('rejects a YouTube dialog before capture without accepting cookies', async () => {
	const { page, consent } = await fixture(
		banner(
			"document.cookie='SOCS=CAE;path=/';window.rejected=true;document.querySelector('ytd-consent-bump-v2-lightbox').remove()",
		),
	);
	try {
		await consent.waitForCompletion();
		assert.equal(await page.evaluate('window.rejected'), true);
		assert.equal(await page.evaluate('window.accepted'), undefined);
		assert.equal(await page.$('ytd-consent-bump-v2-lightbox'), null);
		assert.equal(
			await page.evaluate('typeof window.snapshotAutoconsentMessage'),
			'undefined',
		);
	} finally {
		await consent.dispose();
		await page.close();
	}
});

test('handles consent-triggered navigation', async () => {
	const { page, consent } = await fixture(banner("location.href='/done'"));
	try {
		await consent.waitForCompletion();
		assert.equal(new URL(page.url()).pathname, '/done');
		assert.equal(
			await page.$eval('h1', (element) => element.textContent),
			'Video page',
		);
	} finally {
		await consent.dispose();
		await page.close();
	}
});

test('handles consent inside an iframe', async () => {
	const { page, consent } = await fixture(
		'<iframe src="/frame"></iframe>',
		`<div id="piano-cookie_banner"><button data-close-button onclick="window.rejected=true;document.querySelector('#piano-cookie_banner').remove()">Tout refuser</button></div>`,
	);
	try {
		await consent.waitForCompletion();
		const frame = page.frames().find((frame) => frame.url().includes('/frame'));
		assert.equal(await frame?.evaluate('window.rejected'), true);
	} finally {
		await consent.dispose();
		await page.close();
	}
});

test('handles consent in a cross-origin iframe', async () => {
	const { page, consent } = await fixture(
		'<iframe src="https://consent.example.org/frame"></iframe>',
		`<div id="piano-cookie_banner"><button data-close-button onclick="window.rejected=true;document.querySelector('#piano-cookie_banner').remove()">Tout refuser</button></div>`,
	);
	try {
		await consent.waitForCompletion();
		const frame = page.frames().find((frame) => frame.url().includes('/frame'));
		assert.equal(await frame?.evaluate('window.rejected'), true);
	} finally {
		await consent.dispose();
		await page.close();
	}
});

test('leaves pages without consent dialogs intact', async () => {
	const { page, consent } = await fixture('<h1>Normal page</h1>');
	try {
		await consent.waitForCompletion();
		assert.equal(
			await page.$eval('h1', (element) => element.textContent),
			'Normal page',
		);
	} finally {
		await consent.dispose();
		await page.close();
	}
});

test('fails instead of capturing a detected dialog that cannot be dismissed', async () => {
	const { page, consent } = await fixture(
		banner('').replace(
			'<button onclick="">Tout refuser</button>',
			'<span>Tout refuser</span>',
		),
	);
	try {
		await assert.rejects(
			consent.waitForCompletion(3000),
			/cookie consent|dismiss/i,
		);
	} finally {
		await consent.dispose();
		await page.close();
	}
});

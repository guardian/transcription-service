import type {
	BackgroundMessage,
	ContentScriptMessage,
	ConsentState,
} from '@duckduckgo/autoconsent';
import rules from '@duckduckgo/autoconsent/rules/rules.json';
import type { Page, CDPSession, Frame } from 'puppeteer-core';
import { setTimeout } from 'node:timers/promises';
import script from './autoconsent-script';

const worldName = 'snapshot-autoconsent';
const bindingName = 'snapshotAutoconsentMessage';

// Keep the bridge in an isolated world: target-page scripts must not be able to
// send eval requests, and each iframe must receive responses in its own world.
export async function setupAutoconsent(page: Page) {
	const sessions = new Map<CDPSession, Promise<void>>();
	const contextGroups = new Map<CDPSession, Map<number, Context>>();
	const cleanups: Array<() => Promise<void>> = [];
	let lastChange = Date.now();
	let bridgeError: unknown;
	type Context = {
		frameId: string;
		isolated: boolean;
		mainWorld: boolean;
		state?: ConsentState;
		popup?: string;
		done?: boolean;
		selfTestPending?: boolean;
		error?: string;
	};
	const allContexts = () =>
		[...contextGroups].flatMap(([client, group]) =>
			client.detached ? [] : [...group.values()],
		);

	async function attach(client: CDPSession) {
		const contexts = new Map<number, Context>();
		contextGroups.set(client, contexts);

		const reply = async (
			contextId: number,
			message:
				| BackgroundMessage
				| { type: 'initResp'; config: object; rules: object },
		) => {
			await client.send('Runtime.evaluate', {
				contextId,
				expression: `window.autoconsentReceiveMessage(${JSON.stringify(message)})`,
				awaitPromise: true,
			});
		};

		const onContextCreated = ({
			context,
		}: {
			context: import('devtools-protocol').Protocol.Runtime.ExecutionContextDescription;
		}) => {
			const frameId = context.auxData?.['frameId'];
			if (typeof frameId === 'string') {
				contexts.set(context.id, {
					frameId,
					isolated: context.name === worldName,
					mainWorld: context.auxData?.['isDefault'] === true,
				});
				lastChange = Date.now();
			}
		};
		const onContextDestroyed = ({
			executionContextId,
		}: {
			executionContextId: number;
		}) => {
			contexts.delete(executionContextId);
			lastChange = Date.now();
		};
		const onContextsCleared = () => {
			contexts.clear();
			lastChange = Date.now();
		};
		client.on('Runtime.executionContextCreated', onContextCreated);
		client.on('Runtime.executionContextDestroyed', onContextDestroyed);
		client.on('Runtime.executionContextsCleared', onContextsCleared);

		const onMessage = async ({
			name,
			payload,
			executionContextId,
		}: {
			name: string;
			payload: string;
			executionContextId: number;
		}) => {
			if (name !== bindingName) return;
			const context = contexts.get(executionContextId);
			if (!context?.isolated) return;
			const message = JSON.parse(payload) as ContentScriptMessage;
			lastChange = Date.now();
			switch (message.type) {
				case 'init':
					await reply(executionContextId, {
						type: 'initResp',
						rules,
						config: {
							enabled: true,
							autoAction: 'optOut',
							disabledCmps: [],
							enablePrehide: false,
							enableCosmeticRules: false,
							enableGeneratedRules: true,
							detectRetries: 10,
							isMainWorld: false,
							enableHeuristicDetection: true,
							heuristicMode: 'tier2',
						},
					});
					break;
				case 'eval': {
					const mainWorld = [...contexts.entries()].find(
						([, candidate]) =>
							candidate.mainWorld && candidate.frameId === context.frameId,
					)?.[0];
					if (mainWorld === undefined) return;
					const evaluation = await client.send('Runtime.evaluate', {
						contextId: mainWorld,
						expression: message.code,
						returnByValue: true,
						awaitPromise: true,
					});
					const result: unknown = evaluation.exceptionDetails
						? false
						: evaluation.result.value;
					await reply(executionContextId, {
						type: 'evalResp',
						id: message.id,
						result,
					});
					break;
				}
				case 'report':
					context.state = message.state;
					break;
				case 'popupFound':
					context.popup = message.cmp;
					break;
				case 'autoconsentDone':
					context.done = true;
					break;
				case 'optOutResult':
					if (!message.result)
						context.error = `Could not dismiss ${message.cmp}`;
					if (message.result && message.scheduleSelfTest) {
						context.selfTestPending = true;
						await reply(executionContextId, { type: 'selfTest' });
					}
					break;
				case 'selfTestResult':
					context.selfTestPending = false;
					if (!message.result)
						context.error = `Consent verification failed for ${message.cmp}`;
					break;
				case 'autoconsentError':
					context.error = 'Autoconsent reported an error';
					break;
			}
		};
		const onBindingCalled = (
			event: import('devtools-protocol').Protocol.Runtime.BindingCalledEvent,
		) => {
			void onMessage(event).catch((error) => {
				// A consent click may destroy its own document by navigating away.
				if (
					error instanceof Error &&
					/context.*destroyed|Cannot find context|navigated or closed|Session closed|Target closed/i.test(
						error.message,
					)
				)
					return;
				if (contexts.has(event.executionContextId)) bridgeError = error;
			});
		};
		client.on('Runtime.bindingCalled', onBindingCalled);

		await client.send('Runtime.enable');
		await client.send('Page.enable');
		await client.send('Runtime.addBinding', {
			name: bindingName,
			executionContextName: worldName,
		});
		const { identifier } = await client.send(
			'Page.addScriptToEvaluateOnNewDocument',
			{
				worldName,
				runImmediately: true,
				source: `window.autoconsentSendMessage = message => { window.${bindingName}(JSON.stringify(message)); return Promise.resolve(); };\n${script}`,
			},
		);

		cleanups.push(async () => {
			client.off('Runtime.executionContextCreated', onContextCreated);
			client.off('Runtime.executionContextDestroyed', onContextDestroyed);
			client.off('Runtime.executionContextsCleared', onContextsCleared);
			client.off('Runtime.bindingCalled', onBindingCalled);
			if (!client.detached) {
				await client.send('Page.removeScriptToEvaluateOnNewDocument', {
					identifier,
				});
				await client.send('Runtime.removeBinding', { name: bindingName });
			}
		});
	}

	// CdpFrame.client follows cross-origin frames when Chromium gives them their
	// own process. Install the bridge on each session, including existing frames.
	const attachFrame = (frame: Frame) => {
		const client = (frame as Frame & { client: CDPSession }).client;
		if (!sessions.has(client)) {
			sessions.set(
				client,
				attach(client).catch((error) => {
					if (!frame.detached && !client.detached) bridgeError = error;
				}),
			);
		}
	};
	page.on('frameattached', attachFrame);
	page.on('framenavigated', attachFrame);
	for (const frame of page.frames()) attachFrame(frame);
	await Promise.all(sessions.values());

	return {
		async waitForCompletion(timeout = 15000) {
			const deadline = Date.now() + timeout;
			while (Date.now() < deadline) {
				if (bridgeError) throw bridgeError;
				const active = allContexts().filter((context) => context.isolated);
				const error = active.find((context) => context.error)?.error;
				if (error) throw new Error(error);
				if (
					active.length &&
					active.every(
						(context) =>
							(context.done && !context.selfTestPending) ||
							context.state?.lifecycle === 'nothingDetected',
					) &&
					Date.now() - lastChange >= 500
				)
					return;
				await setTimeout(100);
			}
			const pending = allContexts().filter(
				(context) =>
					context.isolated &&
					context.popup &&
					(!context.done || context.selfTestPending),
			);
			if (pending.length)
				throw new Error(
					`Timed out dismissing cookie consent: ${pending.map((context) => context.popup).join(', ')}`,
				);
			if (!allContexts().some((context) => context.isolated && context.state))
				throw new Error('Autoconsent did not initialize');
		},
		async dispose() {
			page.off('frameattached', attachFrame);
			page.off('framenavigated', attachFrame);
			await Promise.all(sessions.values());
			await Promise.all(cleanups.map((cleanup) => cleanup()));
		},
	};
}

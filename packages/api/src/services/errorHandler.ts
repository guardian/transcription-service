import type { ErrorRequestHandler } from 'express';
import { STATUS_CODES } from 'node:http';
import { logger } from '@guardian/transcription-service-backend-common';

export const errorHandler: ErrorRequestHandler = (
	error: unknown,
	_req,
	res,
	next,
) => {
	logger.error('Express request failed', error);

	if (res.headersSent) {
		next(error);
		return;
	}

	const candidate =
		typeof error === 'object' && error !== null
			? (error as { status?: unknown; statusCode?: unknown })
			: undefined;
	const status = candidate?.status ?? candidate?.statusCode;
	const statusCode =
		typeof status === 'number' &&
		Number.isInteger(status) &&
		status >= 400 &&
		status <= 599
			? status
			: 500;

	res.set('Cache-Control', 'no-store');
	res.status(statusCode).json({
		error:
			statusCode >= 500
				? 'Internal Server Error'
				: (STATUS_CODES[statusCode] ?? 'Bad Request'),
	});
};

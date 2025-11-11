import winston from 'winston';

export interface LoggerFunctions {
	setCommonMetadata(
		id: string,
		userEmail: string,
		attemptNumber: number,
		maybeSecondsFromEnqueueToStartMetric: '' | undefined | number,
	): void;
	resetCommonMetadata(): void;
	debug(message: string): void;
	info(message: string, meta?: Record<string, string | number>): void;
	warn(message: string, error?: Error | unknown): void;
	error(message: string, error?: Error | unknown): void;
}

interface LogEvent {
	level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
	message: string;
	stack_trace?: string;
	meta?: Record<string, string | number>;
}

const { combine, timestamp, json } = winston.format;

class ServerLogger {
	underlyingLogger: winston.Logger;
	id: string | undefined;
	userEmail: string | undefined;
	attemptNumber: number = 0; // zero means we don't know what the attempt number is
	maybeSecondsFromEnqueueToStartMetric: '' | undefined | number;

	constructor() {
		const winstonConfig: winston.LoggerOptions = {
			levels: {
				ERROR: 0,
				WARN: 1,
				INFO: 2,
				DEBUG: 3,
			},
			level: 'INFO',
			format: combine(timestamp({ alias: '@timestamp' }), json()),
			transports: [new winston.transports.Console()],
		};

		this.underlyingLogger = winston.createLogger(winstonConfig);
	}

	private log(logObject: LogEvent): void {
		this.underlyingLogger.log({
			message: logObject.message,
			level: logObject.level,
			stack_trace: logObject.stack_trace,
			id: this.id,
			userEmail: this.userEmail,
			attemptNumber: this.attemptNumber,
			maybeSecondsFromEnqueueToStartMetric:
				this.maybeSecondsFromEnqueueToStartMetric,
			...logObject.meta,
		});
	}

	resetCommonMetadata(): void {
		this.userEmail = undefined;
		this.id = undefined;
		this.attemptNumber = 0;
		this.maybeSecondsFromEnqueueToStartMetric = undefined;
	}

	setCommonMetadata(
		id: string,
		userEmail: string,
		attemptNumber: number,
		maybeSecondsFromEnqueueToStartMetric: '' | undefined | number,
	): void {
		this.userEmail = userEmail;
		this.id = id;
		this.attemptNumber = attemptNumber;
		this.maybeSecondsFromEnqueueToStartMetric =
			maybeSecondsFromEnqueueToStartMetric;
	}

	debug(message: string): void {
		this.log({
			level: 'DEBUG',
			message,
		});
	}

	info(message: string, meta?: Record<string, string>): void {
		this.log({
			level: 'INFO',
			message,
			meta: meta,
		});
	}

	warn(message: string, error?: Error): void {
		this.log({
			level: 'WARN',
			message,
			stack_trace: error instanceof Error ? error.stack : undefined,
		});
	}

	error(message: string, error?: Error | unknown): void {
		this.log({
			level: 'ERROR',
			message,
			stack_trace: error instanceof Error ? error.stack : undefined,
		});
	}
}

export const logger: LoggerFunctions = new ServerLogger();

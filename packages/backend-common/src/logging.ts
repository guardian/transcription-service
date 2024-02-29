import winston from 'winston';

export interface LoggerFunctions {
	setCommonMetadata(id: string, userEmail: string): void;
	resetCommonMetadata(): void;
	debug(message: string): void;
	info(message: string, meta?: Record<string, string | number>): void;
	warn(message: string, error?: Error | unknown): void;
	error(message: string, error?: Error | unknown): void;
}

interface LogEvent {
	level: 'debug' | 'info' | 'warn' | 'error';
	message: string;
	stack_trace?: string;
	meta?: Record<string, string | number>;
}

const { combine, timestamp, json } = winston.format;

class ServerLogger {
	underlyingLogger: winston.Logger;
	id: string | undefined;
	userEmail: string | undefined;

	constructor() {
		const winstonConfig: winston.LoggerOptions = {
			level: 'info',
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
			...logObject.meta,
		});
	}

	resetCommonMetadata(): void {
		this.userEmail = undefined;
		this.id = undefined;
	}

	setCommonMetadata(id: string, userEmail: string): void {
		this.userEmail = userEmail;
		this.id = id;
	}

	debug(message: string): void {
		this.log({
			level: 'debug',
			message,
		});
	}

	info(message: string, meta?: Record<string, string>): void {
		this.log({
			level: 'info',
			message,
			meta: meta,
		});
	}

	warn(message: string, error?: Error): void {
		this.log({
			level: 'warn',
			message,
			stack_trace: error instanceof Error ? error.stack : undefined,
		});
	}

	error(message: string, error?: Error | unknown): void {
		this.log({
			level: 'error',
			message,
			stack_trace: error instanceof Error ? error.stack : undefined,
		});
	}
}

export const logger: LoggerFunctions = new ServerLogger();

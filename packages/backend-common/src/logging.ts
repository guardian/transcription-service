import winston from 'winston';

// export const logger = winston.createLogger({
// 	level: 'info',
// 	format: winston.format.json(),
// 	transports: [new winston.transports.Console()],
// });

export interface LoggerFunctions {
	debug(message: string): void;
	info(message: string, meta?: Record<string, string>): void;
	warn(message: string, error?: Error | unknown): void;
	error(message: string, error?: Error | unknown): void;
}

interface LogEvent {
	level: 'debug' | 'info' | 'warn' | 'error';
	message: string;
	stack_trace?: string;
	meta?: Record<string, string>;
}

class ServerLogger {
	underlyingLogger: winston.Logger;

	constructor() {
		const winstonConfig: winston.LoggerOptions = {
			level: 'info',
			format: winston.format.json(),
			transports: [new winston.transports.Console()],
		};

		this.underlyingLogger = winston.createLogger(winstonConfig);
	}

	private log(logObject: LogEvent): void {
		this.underlyingLogger.log({
			message: logObject.message.replace(/(\r\n|\n|\r)/gm, ' '),
			level: logObject.level,
			stack_trace: logObject.stack_trace,
			...logObject.meta,
		});
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

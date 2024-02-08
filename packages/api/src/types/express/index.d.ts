// override the type of Express.Request.User to avoid type assertions
// https://blog.logrocket.com/extend-express-request-object-typescript/

export {};

// eslint-disable-next-line @typescript-eslint/no-namespace
declare global {
	namespace Express {
		interface User {
			email: string;
		}
	}
}

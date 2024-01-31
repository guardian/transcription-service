import express from 'express';
import asyncHandler from 'express-async-handler';
import serverlessExpress from '@codegenie/serverless-express';
import bodyParser from 'body-parser';
import path from 'path';
import { getConfig } from './config';
import { initPassportAuth } from './services/passport';
import { GoogleAuth } from './controllers/GoogleAuth';
import passport from 'passport';
import { Request, Response } from 'express';

const runningOnAws = process.env['AWS_EXECUTION_ENV'];
const emulateProductionLocally =
	process.env['EMULATE_PRODUCTION_SERVER'] === 'true';

const getApp = async () => {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const config = await getConfig();

	const app = express();
	const apiRouter = express.Router();

	app.use(bodyParser.json({ limit: '40mb' }));
	app.use(passport.initialize());

	// auth
	initPassportAuth(config);
	const auth = new GoogleAuth(config);
	apiRouter.get('/auth/google', ...auth.googleAuth());
	apiRouter.get('/auth/oauth-callback', ...auth.oauthCallback());

	apiRouter.get(
		'/healthcheck',
		asyncHandler(async (req, res) => {
			res.send('It lives!');
		}),
	);

	app.use('/api', apiRouter);

	if (runningOnAws) {
		app.use(express.static('client'));
		app.get('/*', (req, res) => {
			res.sendFile(path.resolve(__dirname, 'client', 'index.html'));
		});
	} else {
		if (emulateProductionLocally) {
			app.use(
				express.static(path.resolve(__dirname, '..', '..', 'dist', 'client')),
			);
			app.get('/*', (req: Request, res: Response) => {
				res.sendFile(
					path.resolve(__dirname, '..', '..', 'dist', 'client', 'index.html'),
				);
			});
		}
	}

	return app;
};

let api;
if (runningOnAws) {
	console.log('Running on lambda');

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let serverlessExpressHandler: any;
	const serverlessHandler = getApp().then(
		(app) => (serverlessExpressHandler = serverlessExpress({ app }).handler),
	);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	api = async (event: any, context: any) => {
		if (!serverlessExpressHandler) {
			await serverlessHandler;
		}
		return serverlessExpressHandler(event, context);
	};
} else {
	console.log('running locally');
	// Running locally. Start Express ourselves
	const port = 9103;
	getApp().then((app) => {
		app.listen(port, () => {
			console.log(`Server now listening on port: ${port}`);
		});
	});
}

export { api };

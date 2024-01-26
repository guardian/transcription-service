import express from 'express';
import asyncHandler from 'express-async-handler';
import serverlessExpress from '@codegenie/serverless-express';
import bodyParser from 'body-parser';
import path from 'path';
import { getConfig } from './config';

const runningOnAws = process.env['AWS_EXECUTION_ENV'];

const getApp = async () => {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const config = await getConfig();

	const app = express();
	const apiRouter = express.Router();

	app.use(bodyParser.json({ limit: '40mb' }));

	apiRouter.get(
		'/healthcheck',
		asyncHandler(async (req, res) => {
			res.send('It lives!');
		}),
	);

	app.use('/api', apiRouter);

	if (runningOnAws) {
		app.use(express.static('frontend'));
		app.get('/*', (req, res) => {
			res.sendFile(path.resolve(__dirname, 'frontend', 'index.html'));
		});
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

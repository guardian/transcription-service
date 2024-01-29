import express from 'express';
import asyncHandler from 'express-async-handler';
import passport from 'passport';
import serverlessExpress from '@codegenie/serverless-express';
import bodyParser from 'body-parser';
import path from 'path';
import { getConfig } from './config';
import { initPassportAuth } from './services/passport';
import { GoogleAuth, checkAuth } from './controllers/GoogleAuth';
import { Request, Response } from 'express';
import { checkAuthToken } from './services/auth/auth';
import session from "express-session";
import {indexRouter} from "./routes/index";
import {authRouter} from "./routes/auth";

const runningOnAws = process.env['AWS_EXECUTION_ENV'];

const getApp = async () => {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const config = await getConfig();

	const app = express();
	const apiRouter = express.Router();

	app.use(bodyParser.json({ limit: '40mb' }));

	// view engine setup
	app.set('views', path.join(__dirname, 'views'));
	app.set('view engine', 'ejs');

	app.use(session({
			secret: 'keyboard cat',
			resave: false,
			saveUninitialized: false,
			cookie: { secure: false },
		}));
	app.use(passport.initialize())
	app.use(passport.session());
	//app.use(passport.authenticate('session'));

	app.use('/', indexRouter);
	app.use('/', authRouter);

	// // ******** auth
	initPassportAuth(config);
	const auth = new GoogleAuth(config);
	apiRouter.get('/auth/google', ...auth.googleAuth());
	apiRouter.get('/auth/oauth-callback', ...auth.oauthCallback());
	// // ******** end of auth

	// app.use(function(req, res, next) {
	// 	console.log("req.session: ");
	// 	console.log(req.session);
	// 	return next();
	//   });



	// app.get('/', function(req, res, next) {
	// 	// const { auth } = req.query;
	// 	// if (typeof auth === 'string') {
	// 	// 	console.log('marji 2');
	// 	// 	console.log(auth);
	// 	// 	const isLoggedIn = checkAuthToken(auth);

	// 	// 	if (!isLoggedIn) { 
	// 	// 		console.log("user not logged in")
	// 	// 		return res.render('login'); 
	// 	// 	} else {
	// 	// 		console.log(`user ${req.user} is logged in`)
	// 	// 		next();
	// 	// 	}
	// 	// }
	// 	//res.send("Helloooo")	
	//   });

	apiRouter.get(
		'/healthcheck',
		asyncHandler(async (req, res) => {
			res.send('It lives!');
		}),
	);

	app.use('/api', apiRouter);
	// app.get('/favicon.ico', (req, res) => res.status(204));

	// if (runningOnAws) {
	// 	console.log('marji 1');
	// 	app.use(express.static('frontend'));
	// 	app.get('/*', (req, res) => {
	// 		res.sendFile(path.resolve(__dirname, 'frontend', 'index.html'));
	// 	});
	// } else {
	// 	app.use(express.static(path.resolve(__dirname, '..', 'dist')));
	// 	app.get('/*', (req: Request, res: Response) => {
	// 		const { auth } = req.query;
	// 		if (typeof auth === 'string') {
	// 			console.log('marji 2');
	// 			console.log(auth);
	// 			checkAuthToken(auth);
	// 		}

	// 		res.sendFile(
	// 			path.resolve(__dirname, '..', 'dist', 'frontend', 'index.html'),
	// 		);
	// 		// res.send('OK');
	// 	});
	// }

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

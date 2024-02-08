import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth2';
import type { VerifyCallback } from 'passport-google-oauth2';
import { ExtractJwt, Strategy as JwtStrategy } from 'passport-jwt';
import { TranscriptionConfig } from '@guardian/transcription-service-backend-common';

const validateEmail = (email: string) => {
	// https://stackoverflow.com/questions/46155/whats-the-best-way-to-validate-an-email-address-in-javascript
	return !!email.match(
		// eslint-disable-next-line no-useless-escape
		/^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
	);
};

export const checkAuth = passport.authenticate('jwt', { session: false });

export const initPassportAuth = (config: TranscriptionConfig) => {
	passport.use(
		new GoogleStrategy(
			{
				clientID: config.auth.clientId,
				clientSecret: config.auth.clientSecret,
				callbackURL: `${config.app.rootUrl}/api/auth/oauth-callback`,
			},
			function (
				accessToken: string,
				refreshToken: string,
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				profile: any,
				done: VerifyCallback,
			) {
				// Need to cast to any since the type definitions for this library are broken. Great.
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const profileAny = profile as any;
				if (
					profileAny._json.domain === 'guardian.co.uk' ||
					validateEmail(profileAny._json.email)
				) {
					done(null, profile);
				} else {
					done(
						new Error(
							'Your Google account is not authorised to use transcription-service. Contact prod.eng.investigations@guardian.co.uk for help',
						),
					);
				}
			},
		),
	);

	passport.use(
		new JwtStrategy(
			{
				secretOrKey: config.app.secret,
				jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
			},
			function (jwt, done) {
				// We can optionally do more validation here
				// For now will assume if the JWT token is valid then we're good.
				done(null, jwt);
			},
		),
	);
};

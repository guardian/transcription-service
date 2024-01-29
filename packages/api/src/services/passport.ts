import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth2';
import type { VerifyCallback } from 'passport-google-oauth2';
import { TranscriptionConfig } from '../config';
import { ExtractJwt, Strategy as JwtStrategy } from 'passport-jwt';
import { inherits } from 'util';

const validateEmail = (email: string) => {
	// https://stackoverflow.com/questions/46155/whats-the-best-way-to-validate-an-email-address-in-javascript
	return !!email.match(
		// eslint-disable-next-line no-useless-escape
		/^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
	);
};

export const initPassportAuth = (config: TranscriptionConfig) => {
	passport.use(
		new GoogleStrategy(
			{
				clientID: config.auth.clientId,
				clientSecret: config.auth.clientSecret,
				callbackURL: `${config.app.rootUrl}/api/auth/oauth-callback`,
                // passReqToCallback: true
			},
			function (accessToken: string, refreshToken: string, profile: any, done: VerifyCallback) {
				console.log(`GoogleStrategy called with ${profile}`);
				//console.log(profile);
				// Need to cast to any since the type definitions for this library are broken. Great.
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const profileAny = profile as any;
				if (
					profileAny._json.domain === 'guardian.co.uk' ||
					validateEmail(profileAny._json.email)
				) {
					console.log('logged in');
					done(null, profile);
				} else {
					console.log('logged in');
					done(
						new Error(
							'Your Google account is not authorised to use Lurch. Contact prod.eng.investigations@guardian.co.uk for help',
						),
					);
				}
			},
		),
	);

    passport.serializeUser(function(user, cb) {
        console.log(`**** serializeUser user: `);
        process.nextTick(function() {            
          cb(null, user);
        });
      });
      
    passport.deserializeUser(function(user: Express.User, cb) {
        console.log(`**** deserializeUser user: `);
        process.nextTick(function() {            
          return cb(null, user);
        });
    });
};

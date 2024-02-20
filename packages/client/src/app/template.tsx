'use client';
import React, { useEffect, useState } from 'react';
import { createBrowserHistory } from 'history';
import { AuthRequired } from '@/components/AuthRequired';
import { initAuth, initialState, logOutIfLoginExpired } from '@/services/auth';
import { AuthState } from '@/types';
import { createContext } from 'react';

export const authExpiryCheckPeriodInSeconds = 30;
export const AuthContext: React.Context<AuthState> = createContext({});

export default function Template({ children }: { children: React.ReactNode }) {
	const [auth, setAuth] = useState<AuthState>(initialState);

	useEffect(() => {
		const interval = setInterval(() => {
			logOutIfLoginExpired(auth.token);
		}, authExpiryCheckPeriodInSeconds * 1000);
		return () => {
			return clearInterval(interval);
		};
	}, [auth]);

	useEffect(() => {
		const browserHistory = createBrowserHistory();

		const newAuth = initAuth(browserHistory);
		console.log('initAuth', newAuth);
		setAuth(newAuth);
	}, []);

	if (!auth.token) {
		return (
			<div>
				<h2 className="text-4xl font-extrabold dark:text-white">
					Login Required
				</h2>
				<AuthRequired></AuthRequired>
			</div>
		);
	}
	return (
		<>
			<AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
		</>
	);
}

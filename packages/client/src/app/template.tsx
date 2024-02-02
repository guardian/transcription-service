'use client';
import React, { useEffect, useState } from 'react';
import { createBrowserHistory } from 'history';
import { AuthRequired } from '@/components/AuthRequired';
import { initAuth, initialState, logOutIfLoginExpired } from '@/services/auth';
import { AuthState } from '@/types';

export const authExpiryCheckPeriodInSeconds = 30;

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
		initAuth(setAuth, browserHistory);
	}, []);

	if (!auth?.token) {
		return (
			<div>
				<h2>Login Required</h2>
				<AuthRequired></AuthRequired>
			</div>
		);
	}
	return <div>{children}</div>;
}
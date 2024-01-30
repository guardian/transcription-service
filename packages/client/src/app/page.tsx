'use client'
import React, { useEffect, useState } from "react";

import { AuthRequired } from "@/features/AuthRequired";

import { jwtDecode } from "jwt-decode";
import { createBrowserHistory } from "history";
import type { BrowserHistory } from "history";

export type LoggedInUser = {
  email: string;
  exp: number; // Expiry for the JWT token, in epoch time
};

export type AuthState = {
  token?: string;
  loggedInUser?: LoggedInUser;
};

export function isLoginExpired(token: string): boolean {
  const loggedInUser = jwtDecode(token) as LoggedInUser;
  // JWT expiry is epoch seconds, Date.now() is epoch millis
  return loggedInUser.exp * 1000 < Date.now();
}

const initialState: AuthState = {
  token: undefined,
  loggedInUser: undefined,
};

export const checkAuth = (state: AuthState | undefined, setAuth:  React.Dispatch<React.SetStateAction<AuthState | undefined>>, browserHistory: BrowserHistory) => {  
  const urlParams = new URLSearchParams(window.location.search);
  const maybeParameterToken = urlParams.get("auth");
  console.log("checking if user is logged in")

  if (maybeParameterToken) {
    console.log("Setting token in local storage");
    window.localStorage.setItem("transcription-auth", maybeParameterToken);
    //urlParams.delete("auth");
    browserHistory.replace({
      search: `?${urlParams.toString()}`,
    });
  }

  const maybeToken =
    maybeParameterToken ?? window.localStorage.getItem("transcription-auth");

  if (maybeToken) {
    if (isLoginExpired(maybeToken)) {
      console.log("Removing token from local storage");
      window.localStorage.removeItem("transcription-auth");
      setAuth(initialState)
    } else {
      setAuth({
        loggedInUser: jwtDecode(maybeToken) as LoggedInUser,
        token: maybeToken
      })
    }
  } else {
    setAuth(initialState)
  }
}

const Home = () => {
    const [auth, setAuth] = useState<AuthState>();
    // const searchParams = useSearchParams()

    useEffect(() => {
      const browserHistory = createBrowserHistory();
      checkAuth(auth, setAuth, browserHistory);
    }, []);
  
    if (!auth?.token) {
      return (
        <div>
           <h2>Login Required</h2>
           <AuthRequired></AuthRequired>
        </div>
      )
    }
  
    return (
      <div>
         <h2>You are logged in</h2>
      </div>
    )
}

export default Home;
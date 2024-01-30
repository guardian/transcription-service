import React, { useEffect, useRef } from "react";

export const AuthRequired = () => {
    const urlParams = useRef<URLSearchParams>(new URLSearchParams());
    useEffect(() => {
        // Client-side-only code
        const params = new URLSearchParams(window.location.search);
        params.append("returnPath", window.location.pathname);
        console.log("*******************params:");
        console.log(params);
        urlParams.current = params;
    })

  return (
    <div>
      <a href={`/api/auth/google?${urlParams.current.toString()}`}>Click here</a> 
      to log in with Google
    </div>
  );
};

import React from "react";
import { useSearchParams, usePathname } from 'next/navigation'

export const AuthRequired = () => {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const params = new URLSearchParams(searchParams?.toString());
    console.log(`initial params: ${params}`);
    console.log(`patname: ${pathname}`);
    params.append("returnPath", pathname || '');
    console.log(`final params: ${params}`);

  return (
    <div>
      <a href={`/api/auth/google?${params.toString()}`}>Click here</a> 
      to log in with Google
    </div>
  );
};

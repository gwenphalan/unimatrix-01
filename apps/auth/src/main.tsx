import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";

import { Providers } from "@/app/providers";
import { ALLOWED_REDIRECT_ORIGINS } from "@/features/auth/safe-redirect";
import { router } from "@/app/router";
import { loadAuthAppRuntimeConfig } from "@/lib/config";
import { AuthProvider } from "@unimatrix/auth/react";
import "@/styles.css";

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Missing #app root element.");
}

document.documentElement.classList.add("dark");
document.documentElement.style.colorScheme = "dark";

const runtimeConfig = loadAuthAppRuntimeConfig({
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
  VITE_CLERK_PUBLISHABLE_KEY: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
});

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AuthProvider
      afterSignOutUrl="/"
      allowedRedirectOrigins={[...ALLOWED_REDIRECT_ORIGINS]}
      publishableKey={runtimeConfig.clerkPublishableKey}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
    >
      <Providers>
        <RouterProvider router={router} />
      </Providers>
    </AuthProvider>
  </React.StrictMode>,
);

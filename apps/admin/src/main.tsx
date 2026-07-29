import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";

import { AuthProvider } from "@unimatrix/auth/react";

import { createAppRouter } from "@/app/router";
import { loadAdminAppRuntimeConfig } from "@/lib/config";
import "@/styles.css";

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Missing #app root element.");
}

document.documentElement.classList.add("dark");
document.documentElement.style.colorScheme = "dark";

const runtimeConfig = loadAdminAppRuntimeConfig({
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
  VITE_AUTH_APP_URL: import.meta.env.VITE_AUTH_APP_URL,
  VITE_CLERK_PUBLISHABLE_KEY: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
});

const router = createAppRouter({ runtimeConfig });

// `signInUrl`/`signUpUrl` point at the auth hub rather than at a local route:
// this app hosts no Clerk widgets of its own, and `auth.unimatrix-01.dev` is
// the one place a session is established for the whole family.
ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AuthProvider
      afterSignOutUrl={runtimeConfig.authAppUrl}
      publishableKey={runtimeConfig.clerkPublishableKey}
      signInUrl={`${runtimeConfig.authAppUrl}/sign-in`}
      signUpUrl={`${runtimeConfig.authAppUrl}/sign-up`}
    >
      <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>,
);

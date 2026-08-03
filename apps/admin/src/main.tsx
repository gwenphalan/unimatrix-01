import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";

import { AuthProvider } from "@unimatrix/auth/react";

import { createAppRouter } from "@/app/router";
import { buildSignInHref, loadAdminAppRuntimeConfig } from "@/lib/config";
import "@/styles.css";

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Missing #app root element.");
}

document.documentElement.classList.add("dark");
document.documentElement.style.colorScheme = "dark";

const runtimeConfig = {
  ...loadAdminAppRuntimeConfig({
    VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
    VITE_AUTH_APP_URL: import.meta.env.VITE_AUTH_APP_URL,
    VITE_CLERK_PUBLISHABLE_KEY: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
  }),
  // Off in dev, and this is the only place that can decide it: the hub issues
  // a session for `*.unimatrix-01.dev` and never for a loopback port, so a dev
  // server sends you out and gets you straight back signed-out. The console
  // would be unreachable locally for the sake of re-proving a redirect that
  // production already exercises.
  requireSignIn: !import.meta.env.DEV,
};

const router = createAppRouter({ runtimeConfig });

// `signInUrl`/`signUpUrl` point at the auth hub rather than at a local route:
// this app hosts no Clerk widgets of its own, and `auth.unimatrix-01.dev` is
// the one place a session is established for the whole family.
//
// `afterSignOutUrl` carries a `redirect_url` back to this origin, and the bare
// hub URL is the wrong value however reasonable it looks. Signing out is the
// one exit that starts *here*, so nothing downstream can recover where you
// were: you land on the hub's own landing, sign in, and the hub has no return
// address to honour — it sends you to `/account`, which reads as the sign-in
// redirect being broken when it is only ever missing. Sign out, sign back in,
// and you are returned to the console instead.
//
// The origin rather than `window.location.href`: this is fixed when the
// provider mounts, not when the button is clicked, so a deep path here would
// be whichever route happened to load first.
ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AuthProvider
      afterSignOutUrl={buildSignInHref(runtimeConfig.authAppUrl, window.location.origin)}
      publishableKey={runtimeConfig.clerkPublishableKey}
      signInUrl={`${runtimeConfig.authAppUrl}/sign-in`}
      signUpUrl={`${runtimeConfig.authAppUrl}/sign-up`}
    >
      <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>,
);

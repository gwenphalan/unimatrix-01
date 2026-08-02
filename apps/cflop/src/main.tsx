import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";

import { router } from "@/app/router";
import "@/styles.css";

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Missing #app root element.");
}

document.documentElement.classList.add("dark");
document.documentElement.style.colorScheme = "dark";

// The build writes each route's head into its own HTML file, tagged. React
// inserts its own copy of every meta and link on mount, so without this each one
// exists twice — including the canonical. The `<title>` is deliberately not
// tagged and so survives: React inserts its title ahead of the static one, and
// removing the static one blanks the tab title until React mounts.
for (const tag of document.querySelectorAll("[data-prerendered-head]")) {
  tag.remove();
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);

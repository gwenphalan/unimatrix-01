import type { ReactNode } from "react";
import { ToolShell } from "@unimatrix/chrome/tool";

import { AccountControl } from "@/features/auth/account-control";

import { useAdminSections } from "./sections";

type AppShellProps = {
  authAppUrl: string;
  children: ReactNode;
};

/**
 * The admin app's chrome.
 *
 * It is a **tool** surface, not a content surface, so it takes
 * `@unimatrix/chrome`'s `./tool` shell: a collapsible section rail, dense
 * content region, no site nav tabs and no site footer. That split is
 * tool-vs-content rather than signed-in-vs-public (see the root `AGENTS.md`),
 * and an admin console is the clearest case on the tool side.
 *
 * `sections` is non-empty, so the shell renders the rail rather than a title
 * bar: the wordmark, `accountControl`, and copyright all move into it.
 * `sectionsHomeHref="/"` sends the wordmark to the admin root, which is
 * same-origin — unlike `homeHref`, which stays the absolute public-site URL
 * because `admin.unimatrix-01.dev` is a separate origin and the copyright
 * link is the way back out to it (the root `AGENTS.md`'s "a way back to the
 * public site belongs in tool chrome").
 */
export function AppShell({ authAppUrl, children }: AppShellProps) {
  const sections = useAdminSections();

  return (
    <ToolShell
      accountControl={<AccountControl authAppUrl={authAppUrl} />}
      homeHref="https://unimatrix-01.dev/"
      homeLabel="Unimatrix Admin"
      sections={sections}
      sectionsHomeHref="/"
    >
      {children}
    </ToolShell>
  );
}

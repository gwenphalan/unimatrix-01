import type { ReactNode } from "react";
import { ToolShell } from "@unimatrix/chrome/tool";

import { AccountControl } from "@/features/auth/account-control";

type AppShellProps = {
  authAppUrl: string;
  children: ReactNode;
};

/**
 * The admin app's chrome.
 *
 * It is a **tool** surface, not a content surface, so it takes
 * `@unimatrix/chrome`'s `./tool` shell: title bar, dense content region, no
 * site nav tabs and no site footer. That split is tool-vs-content rather than
 * signed-in-vs-public (see the root `AGENTS.md`), and an admin console is the
 * clearest case on the tool side.
 *
 * `homeLabel` **and** `accountControl` are both given, so the shell renders its
 * title bar — unlike `apps/auth`, which passes `homeHref` alone and gets no bar
 * at all. An operator console needs a persistent way out and a visible account
 * identity; a single sign-in card does not.
 *
 * `homeHref` is an absolute URL because `admin.unimatrix-01.dev` is a separate
 * origin from the public site. The shell renders it as a plain `<a>`, which is
 * what a cross-origin exit has to be.
 */
export function AppShell({ authAppUrl, children }: AppShellProps) {
  return (
    <ToolShell
      accountControl={<AccountControl authAppUrl={authAppUrl} />}
      homeHref="https://unimatrix-01.dev/"
      homeLabel="Unimatrix"
    >
      {children}
    </ToolShell>
  );
}

import type { ReactNode } from "react";
import { ToolShell } from "@unimatrix/chrome/tool";

import { labAdminSession, MockAccountControl } from "@/mocks";

/**
 * The lab is a tool, so it gets the tool shell — the same one every dashboard
 * and admin surface in this repo gets, imported rather than reimplemented. That
 * is not incidental: a prototype laid out inside a hand-rolled approximation of
 * the shell would be designed against chrome that does not exist.
 *
 * The account control is the mock one, wired here rather than per prototype, so
 * a signed-in view is the default state of the harness. There are no Clerk keys
 * anywhere in this workspace.
 */
export function LabShell({ children }: { children: ReactNode }) {
  return (
    <ToolShell
      accountControl={<MockAccountControl session={labAdminSession} />}
      footerEnd="Local-dev only — never built, never deployed"
      // The lab's "home" is its own index, not the production site. This is a
      // local-only tool; sending its one navigation affordance to a deployed
      // origin is the opposite of what the surface is for.
      homeHref="/"
      homeLabel="Unimatrix Lab"
    >
      {children}
    </ToolShell>
  );
}

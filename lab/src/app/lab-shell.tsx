import type { ReactNode } from "react";
import { ToolShell } from "@unimatrix/chrome/tool";

import { labAdminSession, MockAccountControl } from "@/mocks";

/**
 * Chrome for the prototype index, and only the index. The lab is a tool, so its
 * own page gets the tool shell — the same one every dashboard and admin surface
 * here gets, imported rather than reimplemented.
 *
 * It does not wrap a running prototype. This repo has two shells, tool and
 * public, and the harness cannot know which one a given sketch is for — so it
 * imposes neither and a prototype imports the one it belongs in. Handing every
 * sketch the tool shell would design public-site work against tool chrome.
 *
 * The account control is the mock one. There are no Clerk keys anywhere in this
 * workspace.
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

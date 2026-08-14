import { createLazyFileRoute } from "@tanstack/react-router";
import { RiToolsLine } from "@remixicon/react";

import { Badge, Card } from "@unimatrix/ui/public";

export const Route = createLazyFileRoute("/")({
  component: IndexRoute,
});

/**
 * Not section-gated — deliberately. `RequireSignedIn` in `__root.tsx` still
 * bounces a signed-out visitor, and Cloudflare Access sits in front of the
 * origin; what this route skips is the per-section `canAccessAdminSection`
 * check, because a gate around a page that shows nothing is a security control
 * that looks present and protects nothing. `/content` and `/secrets` are the
 * section-gated ones.
 */
function IndexRoute() {
  return (
    <Card className="w-full max-w-xl px-6 py-8">
      <div className="space-y-5">
        <Badge variant="secondary" className="gap-1.5">
          <RiToolsLine aria-hidden="true" className="size-3.5" />
          Scaffold
        </Badge>
        <div className="space-y-3">
          <h1 className="text-2xl leading-tight font-medium tracking-[-0.05em] text-foreground">
            Unimatrix Admin
          </h1>
          <p className="text-sm leading-7 text-muted-foreground">
            This origin is up and running on the shared tool shell, with Content and Secrets live.
            The rest arrive as their own screens are built.
          </p>
        </div>
      </div>
    </Card>
  );
}

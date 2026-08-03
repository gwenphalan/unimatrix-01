import { createLazyFileRoute } from "@tanstack/react-router";
import { RiToolsLine } from "@remixicon/react";

import { Badge, Card } from "@unimatrix/ui/public";

export const Route = createLazyFileRoute("/")({
  component: IndexRoute,
});

/**
 * The scaffold's one placeholder route, and it is **deliberately ungated**.
 *
 * `canAccessAdminSection` exists in `@unimatrix/auth` already, but wiring a
 * gate around a page that shows nothing would be a security control that looks
 * present and protects nothing — and the origin's real protection (Cloudflare
 * Access in front of it) is not this app's job either. The gate lands with the
 * first section that actually has something to guard.
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
            This origin is up and running on the shared tool shell, with Content live as its first
            built section. The rest arrive as their own screens are built.
          </p>
        </div>
      </div>
    </Card>
  );
}

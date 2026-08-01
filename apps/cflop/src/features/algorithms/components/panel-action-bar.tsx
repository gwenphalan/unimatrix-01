import { Fragment } from "react";
import type { RemixiconComponentType } from "@remixicon/react";
import { Button, Kbd } from "@unimatrix/ui/public";

/**
 * A navigate action is an arrow key, an act action is Space. The split is a union rather than
 * optional fields so the rendering rule is a type-level fact: a navigate button is icon-only and
 * has no short word to show, an act button is a word and has no icon.
 */
export type PanelAction =
  | { icon: RemixiconComponentType; kind: "navigate"; label: string; onActivate: () => void }
  | { keyLabel: string; kind: "act"; label: string; onActivate: () => void; shortLabel: string };

export interface PanelActionBarProps {
  actions: PanelAction[];
}

/**
 * Each action renders twice: a key hint for a fine pointer and a button for a coarse one, swapped
 * by `@media (pointer: coarse)` alone. The keys themselves stay live either way — a coarse-pointer
 * device with a keyboard attached loses nothing.
 */
export function PanelActionBar({ actions }: PanelActionBarProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      {actions.map((action) =>
        action.kind === "navigate" ? (
          <Fragment key={action.label}>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground pointer-coarse:hidden">
              <Kbd>
                <action.icon aria-hidden="true" className="size-3" />
              </Kbd>
              {action.label}
            </span>
            <Button
              aria-label={action.label}
              className="hidden pointer-coarse:inline-flex"
              data-panel-action
              onClick={action.onActivate}
              size="icon-lg"
              variant="outline"
            >
              <action.icon aria-hidden="true" />
            </Button>
          </Fragment>
        ) : (
          <Fragment key={action.label}>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground pointer-coarse:hidden">
              <Kbd>{action.keyLabel}</Kbd>
              {action.label}
            </span>
            <Button
              className="hidden pointer-coarse:inline-flex"
              data-panel-action
              onClick={action.onActivate}
              size="lg"
              variant="outline"
            >
              {action.shortLabel}
            </Button>
          </Fragment>
        ),
      )}
    </div>
  );
}

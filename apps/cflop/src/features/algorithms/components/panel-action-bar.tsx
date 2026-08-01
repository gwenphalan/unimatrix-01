import { Fragment } from "react";
import type { RemixiconComponentType } from "@remixicon/react";
import { Button, cn, Kbd } from "@unimatrix/ui/public";

/**
 * A navigate action is an arrow key, an act action is Space. The split is a union rather than
 * optional fields so the rendering rule is a type-level fact: a navigate button is icon-only and
 * has no short word to show, an act button is a word and has no icon.
 */
export type PanelAction =
  | {
      /**
       * `false` keeps the slot in the layout and takes the control out of reach: hidden with
       * `visibility`, not `opacity`, so it leaves the accessibility tree, the tab order and the
       * hit area together. Reserved space advertises nothing, which is the point - the act
       * control then sits in one place whether or not this arrow is offered. `aria-hidden` rides
       * along because jsdom applies no stylesheet, so `invisible` alone is invisible to a unit
       * test as well as to nothing at all.
       */
      available?: boolean;
      icon: RemixiconComponentType;
      kind: "navigate";
      label: string;
      onActivate: () => void;
    }
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
      {actions.map((action) => {
        if (action.kind !== "navigate") return renderAct(action);

        const reserved = action.available === false;

        return (
          <Fragment key={action.label}>
            <span
              aria-hidden={reserved}
              className={cn(
                "inline-flex items-center gap-1.5 text-xs text-muted-foreground pointer-coarse:hidden",
                reserved && "invisible",
              )}
            >
              <Kbd>
                <action.icon aria-hidden="true" className="size-3" />
              </Kbd>
              {action.label}
            </span>
            <Button
              aria-hidden={reserved}
              aria-label={action.label}
              className={cn("hidden pointer-coarse:inline-flex", reserved && "invisible")}
              data-panel-action
              onClick={action.onActivate}
              size="icon-lg"
              variant="outline"
            >
              <action.icon aria-hidden="true" />
            </Button>
          </Fragment>
        );
      })}
    </div>
  );
}

function renderAct(action: Extract<PanelAction, { kind: "act" }>) {
  return (
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
  );
}

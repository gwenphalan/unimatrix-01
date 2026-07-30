import { RiCheckboxMultipleLine } from "@remixicon/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@unimatrix/ui/public";

import type { CaseGroupSelection } from "@/features/algorithms/case-selection";

export interface CaseSelectionMenuProps {
  enabledCount: number;
  groups: CaseGroupSelection[];
  learnedCount: number;
  onEnableOnlyLearned: () => void;
  onSetAllEnabled: (enabled: boolean) => void;
  onSetGroupEnabled: (group: string, enabled: boolean) => void;
  totalCount: number;
}

/**
 * Bulk edits to the drill pool. This replaced a filter that only changed which cards were
 * *visible*: hiding a case did nothing to whether it came up while drilling, so the control
 * that looked like it chose what you practise chose nothing of the kind. Every item here
 * writes the pool, and the grid always shows every case so the effect of a bulk action is
 * visible in the cards behind the menu.
 *
 * Groups show `enabled/total` rather than a tri-state box: the checkbox indicator is a single
 * tick, so a partially-enabled group would be indistinguishable from a fully-enabled one.
 */
export function CaseSelectionMenu({
  enabledCount,
  groups,
  learnedCount,
  onEnableOnlyLearned,
  onSetAllEnabled,
  onSetGroupEnabled,
  totalCount,
}: CaseSelectionMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="gap-1.5" variant="outline">
          <RiCheckboxMultipleLine aria-hidden="true" className="size-3.5" />
          Drill pool
          <span className="text-muted-foreground">
            {enabledCount}/{totalCount}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Whole set</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={() => {
            onSetAllEnabled(true);
          }}
        >
          Enable all
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            onSetAllEnabled(false);
          }}
        >
          Disable all
        </DropdownMenuItem>
        <DropdownMenuItem
          // With nothing learned this would silently empty the pool, which is Disable all
          // wearing a different label.
          disabled={learnedCount === 0}
          onSelect={onEnableOnlyLearned}
        >
          Enable only learned
          <span className="ml-auto text-muted-foreground">{learnedCount}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>By category</DropdownMenuLabel>
        {groups.map(({ enabled, group, total }) => (
          <DropdownMenuCheckboxItem
            checked={enabled === total}
            key={group}
            onCheckedChange={(checked) => {
              onSetGroupEnabled(group, checked === true);
            }}
            onSelect={(event) => {
              event.preventDefault();
            }}
          >
            <span className="flex-1">{group}</span>
            <span className="text-xs text-muted-foreground">
              {enabled}/{total}
            </span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

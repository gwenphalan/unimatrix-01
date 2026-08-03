import type { ToolSection } from "@unimatrix/chrome/tool";
import { Card } from "@unimatrix/ui/public";

export type NotBuiltPlaceholderProps = {
  icon: NonNullable<ToolSection["icon"]>;
  label: string;
};

/** Placeholder body for a section route that has no real screen behind it yet. */
export function NotBuiltPlaceholder({ icon: Icon, label }: NotBuiltPlaceholderProps) {
  return (
    <Card className="flex flex-col items-start gap-3 border-dashed p-6" size="sm">
      <Icon aria-hidden="true" className="size-5 text-muted-foreground" />
      <p className="text-sm text-foreground">{label} has not been built yet.</p>
      <p className="max-w-md text-sm text-muted-foreground">
        This section is on the roadmap — the real screen lands in a later change.
      </p>
    </Card>
  );
}

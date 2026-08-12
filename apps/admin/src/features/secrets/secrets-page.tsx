import { RiAddLine, RiEraserLine, RiRefreshLine } from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import {
  formatAge,
  formatPublishedDate,
  secretNameSchema,
  type SecretTier,
} from "@unimatrix/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Input,
  Label,
  Skeleton,
} from "@unimatrix/ui/editor";
import { useId, useMemo, useState, type ReactNode } from "react";

import { SectionPanel } from "@/features/sections/section-panel";
import { useApiClient } from "@/lib/api-client";

import {
  describeSecretsError,
  useClearSecretValue,
  useRotateSecret,
  useSetSecretValue,
} from "./mutations";
import { secretsQueryOptions } from "./queries";
import {
  SECRET_ACTION_LABELS,
  describeSecretRow,
  type SecretRowAction,
  type SecretRowDescription,
} from "./row-state";

/** The prefix every name in the integrations panel lives under. */
const INTEGRATION_NAME_PREFIX = "integrations/";

/**
 * No panel descriptions. This console has one operator, who knows what a
 * platform credential is; a sentence under each heading explaining the heading
 * is onboarding copy for a reader who does not exist, and it pushes the rows —
 * the only thing on the page worth reading — below the fold.
 */
const PANELS: readonly {
  tier: SecretTier;
  title: string;
  empty: string;
}[] = [
  {
    tier: "platform",
    title: "Platform credentials",
    empty: "Nothing declared. These names come from the registry in the codebase.",
  },
  {
    tier: "integration",
    title: "Integrations",
    empty: "Nothing yet. Add a credential when you wire a provider up.",
  },
];

/**
 * `/secrets` — what the system needs, and whether it has it.
 *
 * Two panels rather than one table with a tier column: platform and
 * integration credentials carry different action sets, and in a single table
 * the only way to learn why a row has no Clear button would be to read a badge
 * and remember the rule. Split into labelled panels, the rule is the layout.
 *
 * One request backs both. The tier on each row is what splits them, so a
 * failure and an empty result are both reported per panel — collapsing to one
 * card would change the shape of the page whenever the store blips.
 */
export function SecretsPage() {
  const client = useApiClient();
  const { data, error, isPending } = useQuery(secretsQueryOptions(client));

  const rows = useMemo(
    () =>
      data === undefined
        ? []
        : data.secrets.map((row) => describeSecretRow(row, data.activeKekVersion)),
    [data],
  );

  const [isAddOpen, setIsAddOpen] = useState(false);
  /**
   * The row a dialog is open for, and which action it is about to take.
   *
   * One piece of state for three dialogs, and each is mounted only while it is
   * that state's target — remounting is what guarantees a value typed for one
   * credential is never still in a field when the next one opens.
   */
  const [pending, setPending] = useState<{
    action: SecretRowAction;
    row: SecretRowDescription;
  } | null>(null);

  function closeDialog() {
    setPending(null);
  }

  return (
    <div className="grid min-h-0 flex-1 content-start items-start gap-4 overflow-y-auto pb-2">
      {PANELS.map((panel) => (
        <SectionPanel
          actions={
            panel.tier === "integration" ? (
              <Button
                className="gap-2"
                onClick={() => {
                  setIsAddOpen(true);
                }}
                size="sm"
                variant="outline"
              >
                <RiAddLine aria-hidden="true" className="size-4" />
                Add credential
              </Button>
            ) : // Platform names come from the registry, so there is nothing
            // to add here — the panel's only entry point is a row.
            null
          }
          className="min-w-0"
          key={panel.tier}
          title={panel.title}
        >
          <SecretsList
            empty={panel.empty}
            error={error}
            isPending={isPending}
            onAct={(action, row) => {
              setPending({ action, row });
            }}
            rows={rows.filter((row) => row.tier === panel.tier)}
          />
        </SectionPanel>
      ))}

      {isAddOpen ? (
        <AddCredentialDialog
          onClose={() => {
            setIsAddOpen(false);
          }}
        />
      ) : null}
      {pending?.action === "set-value" ? (
        <SetValueDialog onClose={closeDialog} row={pending.row} />
      ) : null}
      {pending?.action === "rotate" ? (
        <RotateDialog onClose={closeDialog} row={pending.row} />
      ) : null}
      {pending?.action === "clear-value" ? (
        <ClearValueDialog onClose={closeDialog} row={pending.row} />
      ) : null}
    </div>
  );
}

/**
 * Settings rows, not a table.
 *
 * Four credentials do not repay column headers: `Name`, `Status` and `Actions`
 * label content that is already self-evident, and the header row costs the same
 * vertical space as a credential. Every secrets UI worth copying — Actions
 * secrets, Vercel env vars — is a hairline-separated list for the same reason.
 *
 * What each row says is deliberately short: the name, its state, and one muted
 * line of "what is in there and how old is it". `consumedBy` is not on the row
 * — it matters at the moment you are about to clear something, so it lives in
 * that dialog and nowhere else.
 */
function SecretsList({
  empty,
  error,
  isPending,
  onAct,
  rows,
}: {
  empty: string;
  error: Error | null;
  isPending: boolean;
  onAct: (action: SecretRowAction, row: SecretRowDescription) => void;
  rows: readonly SecretRowDescription[];
}) {
  if (error !== null) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Credentials could not be loaded.</EmptyTitle>
          <EmptyDescription>{describeSecretsError(error)}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (isPending) {
    return (
      <div className="grid gap-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (rows.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">{empty}</p>;
  }

  return (
    <ul className="grid">
      {rows.map((row) => (
        <li
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0"
          key={row.name}
        >
          <div className="grid min-w-0 gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-mono text-sm text-foreground">{row.name}</span>
              <StatusBadge row={row} />
              {row.needsReseal ? (
                // Outline and worded plainly. A row sealed under a superseded
                // key still decrypts — this is work outstanding, not a fault,
                // and colouring it as one would train the operator to ignore
                // the colour that does mean a fault.
                <Badge variant="outline">Sealed under an older key</Badge>
              ) : null}
            </div>
            <RowMeta row={row} />
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {row.actions.map((action) => (
              <RowActionButton
                action={action}
                key={action}
                onClick={() => {
                  onAct(action, row);
                }}
                row={row}
              />
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * One muted line under the name: the masked value, then how stale it is.
 * A row with no value has neither, and says so with a single em-dash rather
 * than two empty columns.
 */
function RowMeta({ row }: { row: SecretRowDescription }) {
  if (row.rotatedAt === null) {
    return <p className="text-xs text-muted-foreground">No value stored</p>;
  }

  // `formatAge` returns null for a timestamp it cannot read; the absolute date
  // is the honest fallback, not a blank.
  const age = formatAge(row.rotatedAt) ?? formatPublishedDate(row.rotatedAt);

  return (
    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
      <span className="font-mono">{row.maskedValue}</span>
      <span aria-hidden="true">·</span>
      <span>rotated {age}</span>
    </p>
  );
}

/**
 * The status column, as a word. Colour alone never carries it: `Not set` is
 * the one an operator acts on, and it is deliberately not styled as an error —
 * an empty slot waiting for a value, not something broken.
 */
function StatusBadge({ row }: { row: SecretRowDescription }) {
  if (row.status === "set") {
    return <Badge variant="secondary">{row.statusLabel}</Badge>;
  }

  return (
    <Badge className={row.status === "not-set" ? "border-dashed" : undefined} variant="outline">
      {row.statusLabel}
    </Badge>
  );
}

/**
 * Icon *and* label. This is a tool an operator opens a few times a year, so
 * the cost of a wider column is nothing against the cost of guessing what a
 * glyph does to a credential.
 */
const ROW_ACTION_STYLES: Record<
  SecretRowAction,
  {
    icon: typeof RiAddLine;
    variant: "default" | "destructive" | "outline";
    className: string;
  }
> = {
  // Filled, because it is the one action on a row that is waiting for the
  // operator rather than one they might take.
  "set-value": { icon: RiAddLine, variant: "default", className: "gap-2" },
  rotate: { icon: RiRefreshLine, variant: "outline", className: "gap-2" },
  // The `destructive` variant tints its fill and glyph but borders in
  // `transparent`, so the red edge has to be added for the box to read as one
  // — same as the content section's delete button.
  "clear-value": {
    icon: RiEraserLine,
    variant: "destructive",
    className: "gap-2 border border-destructive",
  },
};

function RowActionButton({
  action,
  onClick,
  row,
}: {
  action: SecretRowAction;
  onClick: () => void;
  row: SecretRowDescription;
}) {
  const label = SECRET_ACTION_LABELS[action];
  const { className, icon: Icon, variant } = ROW_ACTION_STYLES[action];

  return (
    <Button
      // The accessible name leads with the visible label and adds the row it
      // belongs to, which is the only thing distinguishing one Rotate from the
      // next in a column of them.
      aria-label={`${label} ${row.name}`}
      className={className}
      onClick={onClick}
      size="sm"
      variant={variant}
    >
      <Icon aria-hidden="true" className="size-4" />
      {label}
    </Button>
  );
}

/**
 * The credential a dialog is acting on, named once and prominently — and the
 * one place `consumedBy` appears, because what breaks without a credential
 * matters when you are about to change it and never while it sits in a list.
 *
 * The platform note is here for the same reason. The page looks like a control
 * panel for the running system, and for this tier it is not one yet: nothing
 * reads a platform value out of the store, so writing one changes no running
 * service. Stated on the row it would be noise on every render; stated here it
 * lands exactly when the operator would otherwise expect an effect.
 */
function DialogSubject({ row }: { row: SecretRowDescription }) {
  return (
    <div className="grid gap-1 border border-border/60 px-3 py-2">
      <span className="font-mono text-sm text-foreground">{row.name}</span>
      {row.consumedBy === null ? null : (
        <p className="text-xs text-muted-foreground">{row.consumedBy}</p>
      )}
      {row.tier === "platform" ? (
        <p className="text-xs text-muted-foreground">
          Each service still reads this from its own deploy environment, so saving it here does not
          change anything currently running.
        </p>
      ) : null}
    </div>
  );
}

function SecretValueField({
  autoFocus,
  label,
  onChange,
  value,
}: {
  autoFocus?: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const fieldId = useId();

  return (
    <div className="grid gap-2">
      <Label htmlFor={fieldId}>{label}</Label>
      <Input
        autoComplete="off"
        autoFocus={autoFocus}
        id={fieldId}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        required
        type="password"
        value={value}
      />
    </div>
  );
}

function DialogShell({
  children,
  description,
  isSubmitting,
  onClose,
  onSubmit,
  submitLabel,
  submittingLabel,
  title,
}: {
  children: ReactNode;
  description: string;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: string;
  submittingLabel: string;
  title: string;
}) {
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open
    >
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">{children}</div>
          <DialogFooter>
            <Button onClick={onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={isSubmitting} type="submit">
              {isSubmitting ? submittingLabel : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The name is fixed text rather than an input: it came from the registry, and
 * a typo would create a second credential beside the one the system is waiting
 * for instead of filling it.
 */
function SetValueDialog({ onClose, row }: { onClose: () => void; row: SecretRowDescription }) {
  const [value, setValue] = useState("");
  const setSecretValue = useSetSecretValue();

  return (
    <DialogShell
      description="Sealed under the store’s active key as soon as you save it."
      isSubmitting={setSecretValue.isPending}
      onClose={onClose}
      onSubmit={() => {
        setSecretValue.mutate({ name: row.name, value }, { onSuccess: onClose });
      }}
      submitLabel={SECRET_ACTION_LABELS["set-value"]}
      submittingLabel="Setting"
      title={SECRET_ACTION_LABELS["set-value"]}
    >
      <DialogSubject row={row} />
      <SecretValueField autoFocus label="Value" onChange={setValue} value={value} />
    </DialogShell>
  );
}

function RotateDialog({ onClose, row }: { onClose: () => void; row: SecretRowDescription }) {
  const [value, setValue] = useState("");
  const rotateSecret = useRotateSecret();

  return (
    <DialogShell
      // The one place the no-read-back rule is worth stating: it is why this
      // dialog asks for the whole value instead of offering the old one to
      // edit.
      description="The current value is never shown here, by design. Rotating seals a new one under the store’s active key and retires the old one."
      isSubmitting={rotateSecret.isPending}
      onClose={onClose}
      onSubmit={() => {
        rotateSecret.mutate({ name: row.name, value }, { onSuccess: onClose });
      }}
      submitLabel={SECRET_ACTION_LABELS.rotate}
      submittingLabel="Rotating"
      title={SECRET_ACTION_LABELS.rotate}
    >
      <DialogSubject row={row} />
      <SecretValueField autoFocus label="New value" onChange={setValue} value={value} />
    </DialogShell>
  );
}

/**
 * The only free-form name in this console.
 *
 * Validated against `secretNameSchema` as it is typed, because the store's
 * namespace excludes characters an operator would reasonably reach for —
 * `SLACK_TOKEN` and `slack.token` are both refused — and finding that out from
 * a 400 after typing a live credential is a worse way to learn it.
 */
function AddCredentialDialog({ onClose }: { onClose: () => void }) {
  const [suffix, setSuffix] = useState("");
  const [value, setValue] = useState("");
  const setSecretValue = useSetSecretValue();
  const nameFieldId = useId();

  const name = `${INTEGRATION_NAME_PREFIX}${suffix}`;
  const isNameValid = secretNameSchema.safeParse(name).success;

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
      open
    >
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setSecretValue.mutate({ name, value }, { onSuccess: onClose });
          }}
        >
          <DialogHeader>
            <DialogTitle>Add credential</DialogTitle>
            <DialogDescription>
              The name is how the code will ask for this credential, and rotating changes the value
              rather than the name — so pick one you can live with.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor={nameFieldId}>Name</Label>
              <div className="flex items-stretch">
                {/* A fixed affix, not a placeholder: every name this console
                    can create lives under it, and typing it again is a way to
                    get `integrations/integrations/…`. */}
                <span className="flex items-center border border-r-0 border-input px-3 font-mono text-sm text-muted-foreground">
                  {INTEGRATION_NAME_PREFIX}
                </span>
                <Input
                  autoComplete="off"
                  autoFocus
                  className="font-mono"
                  id={nameFieldId}
                  onChange={(event) => {
                    setSuffix(event.target.value);
                  }}
                  placeholder="github/api-token"
                  required
                  value={suffix}
                />
              </div>
              <p
                className={
                  suffix.length > 0 && !isNameValid
                    ? "text-xs text-destructive"
                    : "text-xs text-muted-foreground"
                }
              >
                Lowercase letters, digits and hyphens, with <code>/</code> between segments. No
                underscores, no dots.
              </p>
            </div>
            <SecretValueField label="Value" onChange={setValue} value={value} />
          </div>
          <DialogFooter>
            <Button onClick={onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={!isNameValid || setSecretValue.isPending} type="submit">
              {setSecretValue.isPending ? "Adding" : "Add credential"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Confirms by typed name rather than a single click: every sealed version of
 * the credential is destroyed by this call and no route this console can reach
 * would let it be read back first.
 *
 * What happens to the row afterwards branches, and the copy has to say which —
 * a declared name keeps its row because the registry still records that the
 * system expects it, while an undeclared one leaves nothing behind to list.
 */
function ClearValueDialog({ onClose, row }: { onClose: () => void; row: SecretRowDescription }) {
  const [typedName, setTypedName] = useState("");
  const clearSecretValue = useClearSecretValue();
  const fieldId = useId();
  const isConfirmed = typedName === row.name;

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{SECRET_ACTION_LABELS["clear-value"]}</AlertDialogTitle>
          <AlertDialogDescription>
            Every sealed version of this credential is destroyed. It cannot be recovered from here,
            or anywhere else.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <DialogSubject row={row} />
        <p className="text-sm text-muted-foreground">
          {row.isDeclared
            ? "The row stays listed as Not set — the system still expects this credential, and anything using it will fail until a new value is set."
            : "The row disappears from this console. Nothing in the codebase declares this name, so there is nothing left for it to list."}
        </p>
        <div className="grid gap-2">
          <Label htmlFor={fieldId}>Type the full name to confirm</Label>
          <Input
            autoComplete="off"
            className="font-mono"
            id={fieldId}
            onChange={(event) => {
              setTypedName(event.target.value);
            }}
            placeholder={row.name}
            value={typedName}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!isConfirmed || clearSecretValue.isPending}
            onClick={() => {
              clearSecretValue.mutate({ name: row.name });
              onClose();
            }}
            variant="destructive"
          >
            {SECRET_ACTION_LABELS["clear-value"]}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

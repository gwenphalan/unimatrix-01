import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { RiLoaderLine } from "@remixicon/react";

import { Badge, Card, cn } from "@unimatrix/ui/public";

import { projectLiveStatusQueryOptions } from "./queries/check-project-live-status";

export function PublicSectionHeading({
  badges,
  className,
  description,
  descriptionClassName,
  headingLevel = 2,
  title,
  titleClassName,
  trailing,
}: {
  badges?: React.ReactNode;
  className?: string;
  description?: React.ReactNode;
  descriptionClassName?: string;
  /**
   * Which heading element the title renders as. Defaults to `h2`, which is
   * right when the page already has an `h1` above this section.
   *
   * Pass `1` on pages where this heading *is* the page title. `/projects` and
   * `/blog` used the default and so had no `h1` at all, which axe reports as
   * `page-has-heading-one` — a rule neither route was scanned against, because
   * the smoke suite visited them without running an accessibility check.
   */
  headingLevel?: 1 | 2;
  title?: React.ReactNode;
  titleClassName?: string;
  trailing?: React.ReactNode;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";

  return (
    <div
      className={cn(
        // Tighter below `sm`. The desktop rhythm reads as deliberate air; on a
        // phone the same values put a heading and the thing it heads most of a
        // thumb-scroll apart.
        "grid gap-3 border-b border-border/70 pb-4 sm:pb-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end",
        className,
      )}
    >
      <div className="space-y-3">
        {badges ? <div className="flex flex-wrap items-center gap-2">{badges}</div> : null}
        {title ? (
          <Heading
            className={cn(
              "max-w-5xl text-2xl leading-[0.96] font-medium tracking-[-0.05em] text-foreground lg:text-3xl",
              titleClassName,
            )}
          >
            {title}
          </Heading>
        ) : null}
        {description ? (
          <p
            className={cn(
              "max-w-3xl text-sm leading-7 text-muted-foreground lg:text-[0.95rem] lg:leading-7",
              descriptionClassName,
            )}
          >
            {description}
          </p>
        ) : null}
      </div>

      {/* Right-aligned only once it shares a row with the title. Stacked below
          `lg`, a right-aligned control sat opposite a left-aligned heading with
          nothing between them. */}
      {trailing ? (
        <div className="flex items-end justify-start lg:justify-end">{trailing}</div>
      ) : null}
    </div>
  );
}

/**
 * Panel for a state that is neither content nor a crash: an empty collection,
 * or a list the API could not serve right now.
 *
 * These states only became reachable when content moved from the bundle into
 * the database — a baked-in list was always present and always complete — so
 * they get a deliberate, readable surface rather than an empty page.
 */
export function PublicNotice({
  action,
  description,
  headingLevel = 2,
  label,
  title,
  tone = "muted",
}: {
  action?: React.ReactNode;
  description: string;
  /**
   * `1` is for the case where this notice *is* the page — a detail route whose
   * post could not be loaded renders nothing else, so without it the document
   * has no h1 at all and its first heading is an h2.
   */
  headingLevel?: 1 | 2 | 3;
  label: string;
  title: string;
  tone?: "destructive" | "muted";
}) {
  const Heading = headingLevel === 1 ? "h1" : headingLevel === 2 ? "h2" : "h3";

  return (
    <div className="site-panel max-w-3xl px-5 py-6 lg:px-8 lg:py-8">
      <div className="space-y-4">
        <Badge variant={tone === "destructive" ? "destructive" : "secondary"}>{label}</Badge>
        <div className="space-y-3">
          <Heading className="text-2xl leading-tight font-medium tracking-[-0.05em] text-foreground lg:text-3xl">
            {title}
          </Heading>
          <p className="max-w-2xl text-sm leading-7 text-muted-foreground lg:text-base lg:leading-8">
            {description}
          </p>
        </div>
        {action}
      </div>
    </div>
  );
}

export function PublicContentParagraphs({
  className,
  columns = 1,
  paragraphs,
}: {
  className?: string;
  columns?: 1 | 2;
  paragraphs: string[];
}) {
  return (
    <div className={cn("grid gap-4", columns === 2 && "lg:grid-cols-2", className)}>
      {paragraphs.map((paragraph, index) => (
        <div key={`${index}:${paragraph}`} className="site-panel px-5 py-4">
          <p className="text-sm leading-7 text-foreground/86 lg:text-[0.95rem] lg:leading-7">
            {paragraph}
          </p>
        </div>
      ))}
    </div>
  );
}

type PublicCardLinkRenderer = (props: {
  ariaLabel: string;
  children: React.ReactNode;
  className: string;
}) => React.ReactElement;

function PublicLinkedSurface({
  actions,
  children,
  className,
  linkLabel,
  renderLink,
}: {
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  linkLabel?: string;
  renderLink?: PublicCardLinkRenderer;
}) {
  const interactive = Boolean(renderLink);
  const overlay = renderLink
    ? renderLink({
        ariaLabel: linkLabel ?? "Open item",
        children: <span className="sr-only">{linkLabel}</span>,
        className:
          "absolute inset-0 z-10 outline-none focus-visible:ring-2 focus-visible:ring-primary/45",
      })
    : undefined;

  return (
    <Card
      className={cn(
        // `gap-0 py-0` cancels the `Card` primitive's own `py-6`/`gap-6`. This
        // surface sets its padding on the inner blocks, so the primitive's was
        // added to it rather than replaced by it, and every entry on the home
        // page carried 40px of dead space above and below its text.
        "site-panel site-panel-strong relative gap-0 overflow-hidden py-0",
        interactive &&
          "transition-[border-color,background-color,transform,box-shadow] duration-200 hover:border-primary/45 hover:bg-secondary/26 hover:-translate-y-0.5 focus-within:border-primary/50 focus-within:shadow-[0_0_0_1px_color-mix(in_oklab,var(--primary)_35%,transparent)]",
        className,
      )}
    >
      {overlay}
      <div
        className={cn("space-y-4 px-5 py-4", interactive && "pointer-events-none relative z-10")}
      >
        {children}
      </div>
      {actions ? (
        <div
          className={cn(
            "flex flex-wrap gap-3 px-5 pb-4",
            interactive && "pointer-events-auto relative z-20",
          )}
        >
          {actions}
        </div>
      ) : null}
    </Card>
  );
}

export function PublicDecisionCard({
  detail,
  eyebrow,
  renderLink,
  summary,
  title,
}: {
  detail: React.ReactNode;
  eyebrow: React.ReactNode;
  renderLink: PublicCardLinkRenderer;
  summary: React.ReactNode;
  title: string;
}) {
  return (
    <PublicLinkedSurface linkLabel={`Open ${title}`} renderLink={renderLink}>
      <div className="space-y-2.5">
        <p className="text-xs font-medium tracking-wide text-muted-foreground">{eyebrow}</p>
        <h3 className="text-xl leading-tight font-medium tracking-[-0.04em] text-foreground lg:text-[1.65rem]">
          {title}
        </h3>
        <p className="text-sm leading-7 text-foreground/86">{summary}</p>
      </div>
      <div className="border-t border-border/60 pt-3 text-sm leading-7 text-muted-foreground">
        {detail}
      </div>
    </PublicLinkedSurface>
  );
}

type PublicProjectCardData = {
  frontmatter: {
    liveUrl?: string;
    repoUrl?: string;
    status?: string;
    summary: string;
    title: string;
  };
  slug: string;
};

function getProjectStatusClassName(status: string) {
  switch (status.toLowerCase()) {
    case "active":
      return "border-primary/35 bg-primary/16 text-foreground";
    case "in-progress":
      return "border-chart-2/35 bg-chart-2/14 text-foreground";
    case "standby":
      return "border-border bg-secondary/55 text-foreground";
    default:
      return "border-border/70 bg-background/60 text-foreground";
  }
}

export function ProjectStatusBadge({
  frontmatter,
}: {
  frontmatter: Pick<PublicProjectCardData["frontmatter"], "liveUrl" | "status">;
}) {
  const { liveUrl, status } = frontmatter;
  const liveStatusQuery = useQuery({
    ...projectLiveStatusQueryOptions(liveUrl ?? ""),
    enabled: liveUrl !== undefined,
  });

  // No live URL and no stored status: nothing to report, so nothing is shown.
  // A project's status is the live check; the stored string only survives on
  // rows seeded from the repository, and the admin form no longer writes one.
  if (liveUrl === undefined) {
    return status === undefined ? null : (
      <Badge className={cn("border", getProjectStatusClassName(status))}>{status}</Badge>
    );
  }

  if (liveStatusQuery.isPending) {
    return (
      <Badge className="gap-1.5" variant="outline">
        <RiLoaderLine aria-hidden="true" className="size-3 animate-spin" />
        Checking
      </Badge>
    );
  }

  const isLive = liveStatusQuery.data === "live";

  return (
    <Badge
      className={cn(
        "gap-1.5 border",
        isLive
          ? "border-primary/35 bg-primary/16 text-foreground"
          : "border-destructive/40 bg-destructive/10 text-destructive",
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", isLive ? "bg-primary" : "bg-destructive")}
      />
      {isLive ? "Live" : "Offline"}
    </Badge>
  );
}

export function PublicProjectLedgerItem({
  actions,
  badge,
  headingLevel = 3,
  index,
  project,
  renderLink,
}: {
  actions?: React.ReactNode;
  /** Rendered beside the status badge. Non-interactive content only — this
   *  sits inside the card's link overlay, which swallows pointer events. */
  badge?: React.ReactNode;
  /**
   * Heading element for the item title. Defaults to `h3`, which is correct
   * under a section that has its own `h2`. Pass `2` where the list sits
   * directly beneath the page `h1` — `/projects` and `/blog` do — so the
   * levels do not skip a step.
   */
  headingLevel?: 2 | 3;
  index: number;
  project: PublicProjectCardData;
  renderLink?: PublicCardLinkRenderer;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";

  const linkProps = renderLink
    ? {
        linkLabel: `Open project ${project.frontmatter.title}`,
        renderLink,
      }
    : {};

  return (
    <PublicLinkedSurface actions={actions} className="h-full overflow-hidden" {...linkProps}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="space-y-2.5">
          {/* No date. A project is a thing that exists or does not; the day
              its row was written says nothing about it, unlike a blog entry
              where the date is half the point. What it is instead is whether
              it answers, which is what the badge reports. */}
          <div className="flex flex-wrap items-center gap-2">
            <ProjectStatusBadge frontmatter={project.frontmatter} />
            {badge}
          </div>
          <Heading className="text-xl leading-tight font-medium tracking-[-0.04em] text-foreground lg:text-[1.5rem]">
            {project.frontmatter.title}
          </Heading>
          <p className="max-w-3xl text-sm leading-7 text-foreground/88 lg:text-[0.95rem] lg:leading-7">
            {project.frontmatter.summary}
          </p>
        </div>

        <p className="hidden text-2xl leading-none font-medium tracking-[-0.06em] text-muted-foreground/50 lg:block lg:text-[1.7rem]">
          {String(index).padStart(2, "0")}
        </p>
      </div>
    </PublicLinkedSurface>
  );
}

type PublicPostListItemData = {
  frontmatter: {
    description?: string;
    publishedAt: string;
    summary: string;
    title: string;
  };
  slug: string;
};

export function PublicTransmissionListItem({
  actions,
  badge,
  entry,
  headingLevel = 3,
  index,
  renderLink,
}: {
  /** Rendered in its own row below the summary, outside the link overlay. */
  actions?: React.ReactNode;
  /** Rendered beside the date. Non-interactive content only — this sits
   *  inside the card's link overlay, which swallows pointer events. */
  badge?: React.ReactNode;
  entry: PublicPostListItemData;
  /**
   * Heading element for the item title. Defaults to `h3`, which is correct
   * under a section that has its own `h2`. Pass `2` where the list sits
   * directly beneath the page `h1` — `/projects` and `/blog` do — so the
   * levels do not skip a step.
   */
  headingLevel?: 2 | 3;
  index: number;
  renderLink?: PublicCardLinkRenderer;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";

  const summary = entry.frontmatter.description ?? entry.frontmatter.summary;
  const linkProps = renderLink
    ? {
        linkLabel: `Open blog entry ${entry.frontmatter.title}`,
        renderLink,
      }
    : {};

  return (
    <PublicLinkedSurface actions={actions} className="h-full overflow-hidden" {...linkProps}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{entry.frontmatter.publishedAt}</span>
            {badge}
          </div>
          <Heading className="text-xl leading-tight font-medium tracking-[-0.04em] text-foreground lg:text-[1.5rem]">
            {entry.frontmatter.title}
          </Heading>
          <p className="max-w-3xl text-sm leading-7 text-foreground/88 lg:text-[0.95rem] lg:leading-7">
            {summary}
          </p>
        </div>

        <p className="hidden text-2xl leading-none font-medium tracking-[-0.06em] text-muted-foreground/50 lg:block lg:text-[1.7rem]">
          {String(index).padStart(2, "0")}
        </p>
      </div>
    </PublicLinkedSurface>
  );
}

export function PublicMetadataStrip({
  items,
}: {
  items: Array<{
    label: React.ReactNode;
    value: React.ReactNode;
  }>;
}) {
  return (
    <dl className="grid gap-px overflow-hidden border border-border/70 bg-border/70 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item, index) => (
        <div key={index} className="bg-background px-4 py-3.5">
          <dt className="text-xs font-medium tracking-wide text-muted-foreground">{item.label}</dt>
          <dd className="mt-2 text-sm leading-7 text-foreground/88">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PublicReadingFrame({
  children,
  title,
}: {
  children: React.ReactNode;
  title: React.ReactNode;
}) {
  return (
    <article className="reading-frame">
      <div className="border-b border-border/60 pb-4">
        <h2 className="text-xl leading-tight font-medium tracking-[-0.04em] text-foreground lg:text-[1.65rem]">
          {title}
        </h2>
      </div>
      <div className="pt-5">{children}</div>
    </article>
  );
}

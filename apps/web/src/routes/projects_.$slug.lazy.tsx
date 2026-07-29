import { RiArrowLeftLine, RiArrowRightUpLine } from "@remixicon/react";
import { Link, createLazyFileRoute } from "@tanstack/react-router";

import { Badge, Button, useIsMobile } from "@unimatrix/ui/public";

import { LazyPublicMarkdown } from "@/features/content/lazy-public-markdown";
import { renderPublicMarkdownInternalLink } from "@/features/content/markdown";
import { AdminSlot } from "@/features/admin/admin-slot";
import { ProjectStatusBadge, PublicNotice } from "@/features/public-site/components";

export const Route = createLazyFileRoute("/projects_/$slug")({
  component: ProjectDetailRoute,
  errorComponent: ProjectUnavailable,
  notFoundComponent: ProjectNotFound,
});

function ProjectDetailRoute() {
  const project = Route.useLoaderData();
  const isMobile = useIsMobile();

  return (
    <div className="space-y-6 sm:space-y-8 lg:space-y-10">
      <header className="space-y-5 border-b border-border/70 pb-8">
        {/* On a wide screen the admin bar is split across rows the page
            already has — its buttons opposite the back link, which is the one
            line here that is chrome rather than content, and the publication
            state beside the live-status badge — so it adds no row of its own.
            A narrow screen gets the whole bar lower down instead, where a
            second row up here would push the title off the first screen. Each
            control renders once either way; two copies would put two buttons
            with the same accessible name in the tree. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button asChild className="w-fit gap-2" variant="outline">
            <Link to="/projects">
              <RiArrowLeftLine aria-hidden="true" className="size-4" />
              Back to projects
            </Link>
          </Button>

          {isMobile ? null : (
            <AdminSlot kind="post-controls" part="actions" slug={project.slug} type="project" />
          )}
        </div>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <ProjectStatusBadge frontmatter={project.frontmatter} />
            <AdminSlot kind="post-controls" part="badge" slug={project.slug} type="project" />
          </div>

          <h1 className="max-w-4xl text-3xl leading-[0.92] font-medium tracking-[-0.06em] text-foreground sm:text-4xl lg:text-[3.2rem]">
            {project.frontmatter.title}
          </h1>
          <p className="max-w-2xl text-[0.95rem] leading-7 text-foreground/86">
            {project.frontmatter.summary}
          </p>

          <div className="flex flex-wrap gap-3">
            {project.frontmatter.liveUrl ? (
              <Button asChild className="w-fit gap-2">
                <a href={project.frontmatter.liveUrl} rel="noreferrer" target="_blank">
                  Visit site
                  <RiArrowRightUpLine aria-hidden="true" className="size-4" />
                </a>
              </Button>
            ) : null}
            {project.frontmatter.repoUrl ? (
              <Button asChild className="w-fit gap-2" variant="secondary">
                <a href={project.frontmatter.repoUrl} rel="noreferrer" target="_blank">
                  Open repository
                  <RiArrowRightUpLine aria-hidden="true" className="size-4" />
                </a>
              </Button>
            ) : null}
          </div>

          {isMobile ? (
            <AdminSlot kind="post-controls" part="actions" slug={project.slug} type="project" />
          ) : null}
        </div>
      </header>

      <div className="site-panel mx-auto max-w-4xl px-5 py-5 lg:px-8 lg:py-8">
        <article className="public-markdown">
          <LazyPublicMarkdown
            markdown={project.body}
            renderInternalLink={renderPublicMarkdownInternalLink}
          />
        </article>
      </div>
    </div>
  );
}

/**
 * A missing slug is `notFound()`; an unreachable API is this. Without it the
 * error escapes to the router's default component, which replaces the root and
 * drops the `<HeadContent />` the page's meta tags live in.
 */
function ProjectUnavailable() {
  return (
    <div className="space-y-8">
      <Button asChild className="w-fit gap-2" variant="outline">
        <Link to="/projects">
          <RiArrowLeftLine aria-hidden="true" className="size-4" />
          Back to projects
        </Link>
      </Button>

      <PublicNotice
        description="This project could not be loaded right now. Reload the page to try again."
        headingLevel={1}
        label="Unavailable"
        title="The project could not be loaded."
        tone="destructive"
      />
    </div>
  );
}

function ProjectNotFound() {
  return (
    <div className="site-panel max-w-3xl px-5 py-6 lg:px-8 lg:py-8">
      <div className="space-y-4">
        <Badge variant="destructive">Project unavailable</Badge>
        <div className="space-y-3">
          {/* h1, not h2: this panel replaces the whole article. */}
          <h1 className="text-3xl leading-tight font-medium tracking-[-0.05em] text-foreground">
            That project is not part of the current list.
          </h1>
          <p className="max-w-2xl text-sm leading-7 text-muted-foreground lg:text-base lg:leading-8">
            Return to the projects page to review the work that is currently published.
          </p>
        </div>
        <Button asChild className="w-fit">
          <Link to="/projects">Browse projects</Link>
        </Button>
      </div>
    </div>
  );
}

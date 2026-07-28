import { Link, createLazyFileRoute } from "@tanstack/react-router";
import { RiArrowRightUpLine } from "@remixicon/react";

import { AdminSlot } from "@/features/admin/admin-slot";
import {
  PublicNotice,
  PublicProjectLedgerItem,
  PublicSectionHeading,
} from "@/features/public-site/components";
import { Button } from "@unimatrix/ui/public";

export const Route = createLazyFileRoute("/projects")({
  component: ProjectsRoute,
  errorComponent: ProjectsUnavailable,
});

function ProjectsRoute() {
  const projects = Route.useLoaderData();

  if (projects.length === 0) {
    return (
      <div className="space-y-5">
        <PublicSectionHeading headingLevel={1} title="Projects" />

        {/* Also on the empty branch: an empty list is exactly when an admin
            most needs the create button. */}
        <AdminSlot kind="new-post" type="project" />

        <PublicNotice
          description="Nothing is published here yet. Check back once the first project goes up."
          label="No projects yet"
          title="The project list is empty."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PublicSectionHeading headingLevel={1} title="Projects" />

      <AdminSlot kind="new-post" type="project" />

      <div className="grid gap-3">
        {projects.map((project, index) => {
          const { liveUrl, repoUrl } = project.frontmatter;
          const hasActions = Boolean(liveUrl) || Boolean(repoUrl);

          return (
            <div className="grid gap-3" key={project.slug}>
              <PublicProjectLedgerItem
                headingLevel={2}
                actions={
                  hasActions ? (
                    <>
                      {liveUrl ? (
                        <Button asChild className="w-fit gap-2">
                          <a href={liveUrl} rel="noreferrer" target="_blank">
                            Visit site
                            <RiArrowRightUpLine aria-hidden="true" className="size-4" />
                          </a>
                        </Button>
                      ) : null}
                      {repoUrl ? (
                        <Button asChild className="w-fit gap-2" variant="secondary">
                          <a href={repoUrl} rel="noreferrer" target="_blank">
                            Open repository
                            <RiArrowRightUpLine aria-hidden="true" className="size-4" />
                          </a>
                        </Button>
                      ) : null}
                    </>
                  ) : undefined
                }
                index={index + 1}
                project={project}
                renderLink={({ ariaLabel, children, className }) => (
                  <Link
                    aria-label={ariaLabel}
                    className={className}
                    params={{ slug: project.slug }}
                    to="/projects/$slug"
                  >
                    {children}
                  </Link>
                )}
              />
              <AdminSlot kind="post-controls" slug={project.slug} type="project" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Projects are fetched from the API now, so an unreachable API is a real
 * state this page has to render — it used to be impossible, because the list
 * was compiled into the bundle.
 */
function ProjectsUnavailable() {
  return (
    <div className="space-y-5">
      <PublicSectionHeading headingLevel={1} title="Projects" />

      <PublicNotice
        description="The project list could not be loaded right now. Reload the page to try again."
        label="Unavailable"
        title="Projects could not be loaded."
        tone="destructive"
      />
    </div>
  );
}

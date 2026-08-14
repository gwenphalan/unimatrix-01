# Security policy

## Reporting a vulnerability

Report privately through GitHub's
[private vulnerability reporting](https://github.com/unimatrixcore/unimatrix-01/security/advisories/new)
rather than opening an issue or a pull request. That keeps the details out of
public view until there is something to update to.

If you would rather use email, `gwen.phalan@unimatrix-01.dev` reaches the same
person.

Include what you need to make the problem reproducible: the affected surface
(an app, the API, or a package), the version or commit, and the
steps. A proof of concept helps and is welcome; you do not need one to report.

This is a personal project maintained by one person, so expect an
acknowledgement within a few days rather than within hours. You will be told
what the fix is and when it ships, and credited in the advisory unless you ask
not to be.

## Scope

In scope: this repository's own code — the applications under `apps/`, the
shared packages under `packages/`, the Compose files under `infra/docker/`,
and the GitHub Actions workflows.

Out of scope: findings in third-party dependencies (report those upstream;
Dependabot already watches this repository's lockfile), and anything that
requires access to the deployment host or a maintainer's credentials to
exploit.

Please do not run automated scanners against the live deployment at
`unimatrix-01.dev`, and do not test against real user accounts other than your
own.

## Supported versions

Only `main` is supported. This is a continuously deployed site, not a released
library — there are no maintained release branches, and a fix ships as a commit
to `main` rather than as a backport.

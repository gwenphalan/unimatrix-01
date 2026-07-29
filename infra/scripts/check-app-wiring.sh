#!/usr/bin/env bash
#
# Asserts the per-app wiring that every other check in this repo is blind to.
#
# Three facts about `apps/*` are load-bearing at runtime and invisible to lint,
# tsc, Vitest, Playwright and the production build alike. An app missing any of
# them passes `pnpm verify` end to end and is broken, or unverified, in a way
# only a human looking at a browser or a deploy would notice:
#
#   1. A `@source` line pointing at `packages/chrome/src` in the app's
#      stylesheet. Tailwind v4's source detection scans the app's own tree and
#      stops at the workspace boundary, so without it none of the shell's
#      utility classes are emitted and the layout collapses — in a browser only.
#   2. `@tanstack/react-router` in the app's vite `resolve.dedupe`.
#      `@unimatrix/chrome` declares the router as a peer and resolves it from
#      its own directory; two resolved copies means the shell's
#      `useRouterState` reads a router context the app's `RouterProvider` never
#      wrote to.
#   3. Every `apps/*/Dockerfile` present in CI's `Images` matrix. `Verify` is
#      Vite and tsc only and never touches a Dockerfile, so an image left out
#      of the matrix is simply never built.
#
# This is also the app template, captured mechanically rather than as prose: a
# new app satisfies it or the check goes red.
#
# Two independent categories, because `apps/*` is not homogeneous:
#
#   * Vite React app  — detected by `vite.config.ts`. Checks 1 and 2.
#   * Dockerized app  — detected by `Dockerfile`. Check 3. `apps/api` is
#                       Fastify: a Dockerfile, no stylesheet, no chrome, no
#                       router.
#
# An app can be both (all four SPAs are), one, or neither. A directory in
# neither category is SKIPPED and reported as such — `apps/workers` is reserved
# and not live, and failing on it would make the check a nuisance that gets
# disabled rather than a gate that holds.

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/../.." && pwd)"

apps_dir="${repo_root}/apps"
ci_workflow="${repo_root}/.github/workflows/ci.yml"

failures=0

fail() {
  printf '  FAIL  %s\n' "$1"
  failures=$((failures + 1))
}

pass() {
  printf '  ok    %s\n' "$1"
}

# Reads the `app: [...]` matrix list out of CI's Images job.
#
# Extracted once rather than per app so a missing or renamed matrix is one
# failure with a clear cause, not one per app with a misleading one.
read_images_matrix() {
  if [[ ! -f "${ci_workflow}" ]]; then
    return 1
  fi

  # `tr` first so a matrix broken across lines still matches. The `[^]]*`
  # class stops at the closing bracket, so only the one array is captured.
  tr '\n' ' ' <"${ci_workflow}" | grep -oE 'app:[[:space:]]*\[[^]]*\]' | head -n 1
}

images_matrix="$(read_images_matrix || true)"

if [[ -z "${images_matrix}" ]]; then
  printf 'apps/*: could not read the Images matrix from %s\n' "${ci_workflow#"${repo_root}/"}"
  fail "CI Images matrix (app: [...]) not found — every Dockerized app is unverified"
  printf '\n%s\n' "check-app-wiring: 1 failure"
  exit 1
fi

check_vite_app() {
  local app_name="$1"
  local app_dir="$2"
  local vite_config="${app_dir}/vite.config.ts"

  # --- 1. Tailwind @source line for packages/chrome ------------------------
  #
  # Fails closed: an app with a vite config and no stylesheet at all is a
  # failure, not a vacuous pass. That is the standard bug in this class of
  # script — a glob that matches nothing silently satisfies "no file is
  # missing the line".
  local stylesheet_count
  stylesheet_count="$(find "${app_dir}/src" -type f -name '*.css' 2>/dev/null | wc -l)"

  if ((stylesheet_count == 0)); then
    fail "${app_name}: no stylesheet under src/ — nowhere for the chrome @source line to live"
  elif grep -rqE --include='*.css' '^[[:space:]]*@source[[:space:]]+"[^"]*packages/chrome/src' \
    "${app_dir}/src"; then
    pass "${app_name}: stylesheet has @source for packages/chrome/src"
  else
    fail "${app_name}: no '@source \"…/packages/chrome/src/**\"' line in any src/**.css — the tool shell's utilities will not be emitted"
  fi

  # --- 2. @tanstack/react-router in resolve.dedupe -------------------------
  #
  # Also fails closed: no `dedupe` array is a failure, not a skip.
  local dedupe_array
  dedupe_array="$(tr '\n' ' ' <"${vite_config}" | grep -oE 'dedupe:[[:space:]]*\[[^]]*\]' | head -n 1 || true)"

  if [[ -z "${dedupe_array}" ]]; then
    fail "${app_name}: vite.config.ts has no resolve.dedupe array"
  elif printf '%s' "${dedupe_array}" | grep -qE "@tanstack/react-router[\"']"; then
    pass "${app_name}: vite dedupe includes @tanstack/react-router"
  else
    fail "${app_name}: '@tanstack/react-router' missing from vite resolve.dedupe — the shell can read a router context RouterProvider never wrote to"
  fi
}

check_dockerized_app() {
  local app_name="$1"

  # Word-boundary match inside the captured array, so `web` cannot be satisfied
  # by a future `webhooks` entry. The list is comma/space separated inside the
  # brackets, so the boundary characters are `[`, `,`, whitespace and `]`.
  if printf '%s' "${images_matrix}" | grep -qE "[[,[:space:]]${app_name}[],[:space:]]"; then
    pass "${app_name}: present in CI's Images matrix"
  else
    fail "${app_name}: apps/${app_name}/Dockerfile is not in CI's Images matrix (.github/workflows/ci.yml) — the image is never built"
  fi
}

printf 'check-app-wiring: auditing apps/* against the wiring no other check sees\n\n'

shopt -s nullglob

for app_dir in "${apps_dir}"/*/; do
  app_dir="${app_dir%/}"
  app_name="$(basename "${app_dir}")"

  is_vite_app=false
  is_dockerized=false

  if [[ -f "${app_dir}/vite.config.ts" ]]; then
    is_vite_app=true
  fi

  if [[ -f "${app_dir}/Dockerfile" ]]; then
    is_dockerized=true
  fi

  if [[ "${is_vite_app}" == false && "${is_dockerized}" == false ]]; then
    printf 'apps/%s\n  skip  neither a Vite app (no vite.config.ts) nor Dockerized (no Dockerfile)\n' "${app_name}"
    continue
  fi

  printf 'apps/%s\n' "${app_name}"

  if [[ "${is_vite_app}" == true ]]; then
    check_vite_app "${app_name}" "${app_dir}"
  fi

  if [[ "${is_dockerized}" == true ]]; then
    check_dockerized_app "${app_name}"
  fi
done

printf '\n'

if ((failures > 0)); then
  printf 'check-app-wiring: %d failure(s)\n' "${failures}"
  exit 1
fi

printf 'check-app-wiring: all app wiring present\n'

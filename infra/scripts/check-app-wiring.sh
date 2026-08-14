#!/usr/bin/env bash
#
# Asserts the per-app wiring that every other check in this repo is blind to.
#
# Three facts about `apps/*` are load-bearing at runtime and invisible to lint,
# tsc, Vitest, Playwright and the production build alike. An app missing any of
# them passes `pnpm verify` end to end and is broken, or unverified, in a way
# only a human looking at a browser or a deploy would notice:
#
#   1. A `@source` line resolving to `packages/<name>/src` for every
#      `packages/*` workspace an app depends on that carries at least one
#      `.tsx` under its own `src/` — the packages that render UI, whose
#      Tailwind classes only reach the app's bundle through this line.
#      Tailwind v4's source detection scans the app's own tree and stops at
#      the workspace boundary, so without it none of that package's utility
#      classes are emitted and the layout collapses — in a browser only.
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
packages_dir="${repo_root}/packages"
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

# `packages/<dir>/src`, keyed by its package.json `name`, for every package
# that carries at least one `.tsx` under `src/` — the packages that render UI
# and whose Tailwind classes only reach a consuming app's bundle through an
# `@source` line. Keyed by the package's own declared `name` rather than
# assumed from its directory: two apps already break that assumption
# (`@unimatrix/auth-app`, `@unimatrix/secrets-app`), and this table should not
# encode the weaker rule.
#
# Checks `-d "$pkg_dir/src"` before calling `find` on it: under `set -euo
# pipefail`, a bare `find` on a nonexistent directory aborts the whole script,
# and `packages/config-eslint`, `packages/config-typescript` and
# `packages/config-vitest` have no `src/` at all. `2>/dev/null` on the `find`
# stays anyway, matching the defensive style used throughout this file.
ui_package_table() {
  local pkg_dir name tsx_count
  for pkg_dir in "${packages_dir}"/*/; do
    pkg_dir="${pkg_dir%/}"
    [[ -f "${pkg_dir}/package.json" ]] || continue
    [[ -d "${pkg_dir}/src" ]] || continue
    name="$(grep -m1 -oE '"name"[[:space:]]*:[[:space:]]*"[^"]*"' "${pkg_dir}/package.json" \
      | sed -E 's/.*"([^"]*)"$/\1/')"
    [[ -n "${name}" ]] || continue
    tsx_count="$(find "${pkg_dir}/src" -type f -name '*.tsx' 2>/dev/null | wc -l)"
    ((tsx_count > 0)) || continue
    printf '%s\t%s\n' "${name}" "$(cd "${pkg_dir}/src" && pwd)"
  done
}

ui_packages="$(ui_package_table)"

check_vite_app() {
  local app_name="$1"
  local app_dir="$2"
  local vite_config="${app_dir}/vite.config.ts"
  local app_pkg_json="${app_dir}/package.json"

  # --- 1. Tailwind @source line for every UI package this app depends on ---
  #
  # Fails closed two ways. An app with a vite config and no stylesheet at all
  # is a failure, not a vacuous pass — the standard bug in this class of
  # script is a glob that matches nothing silently satisfying "no file is
  # missing the line". The hardcoded chrome-only version of this check could
  # never derive an empty requirement (it always resolved
  # `packages/chrome/src`, a `cd` that cannot come back empty); the derived
  # version loses that immunity on its own, so the requirement set itself is
  # asserted non-empty below — every app derives at least {ui, chrome} today.
  local required_names=() required_dirs=()
  local pkg_name pkg_src
  while IFS=$'\t' read -r pkg_name pkg_src; do
    [[ -n "${pkg_name}" ]] || continue
    # Matched against the JSON-quoted name so `@unimatrix/auth` cannot be
    # satisfied by `@unimatrix/auth-app` appearing as the app's own package
    # name — a bare substring match would.
    if grep -qF "\"${pkg_name}\"" "${app_pkg_json}"; then
      required_names+=("${pkg_name}")
      required_dirs+=("${pkg_src}")
    fi
  done <<<"${ui_packages}"

  if ((${#required_names[@]} == 0)); then
    fail "${app_name}: derived @source requirement set is empty — the derivation is broken, not this app (every app should need at least ui)"
  fi

  local stylesheet_count
  stylesheet_count="$(find "${app_dir}/src" -type f -name '*.css' 2>/dev/null | wc -l)"

  if ((stylesheet_count == 0)); then
    if ((${#required_names[@]} > 0)); then
      fail "${app_name}: no stylesheet under src/ — nowhere for ${#required_names[@]} required @source line(s) to live"
    fi
  else
    # A substring match on the raw glob string is NOT enough: `@source
    # "../../packages/chrome/src/**"` from a file that needs three `../` is a
    # perfectly valid line that resolves to nothing, Tailwind emits no
    # utilities, and every automated check stays green. So every @source
    # glob's base directory is resolved against the CSS file's own directory
    # and compared as an absolute path.
    local resolved_bases=()
    local css_file raw_glob base_dir
    while IFS= read -r css_file; do
      while IFS= read -r raw_glob; do
        base_dir="${raw_glob%%\**}"
        base_dir="$(cd "$(dirname "${css_file}")" 2>/dev/null && cd "${base_dir}" 2>/dev/null && pwd)" || continue
        resolved_bases+=("${base_dir}")
      done < <(grep -oE '^[[:space:]]*@source[[:space:]]+"[^"]*"' "${css_file}" \
        | sed -E 's/.*"([^"]*)".*/\1/')
    done < <(find "${app_dir}/src" -type f -name '*.css' 2>/dev/null)

    local i found base
    for i in "${!required_names[@]}"; do
      found=0
      for base in "${resolved_bases[@]}"; do
        if [[ "${base}" == "${required_dirs[$i]}" ]]; then
          found=1
          break
        fi
      done
      if ((found == 1)); then
        pass "${app_name}: stylesheet @source resolves to ${required_dirs[$i]#"${repo_root}/"}"
      else
        fail "${app_name}: no @source line under src/**.css resolves to ${required_dirs[$i]} (${required_names[$i]}) — that package's utilities will not be emitted (a wrong number of '../' still parses, and still emits nothing)"
      fi
    done
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

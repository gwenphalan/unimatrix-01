#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
review-count.sh <owner/repo> <pr>

Prints the number of reviews CodeRabbit has left on a pull request, as a bare
integer on stdout. This is the baseline `wait-coderabbit.sh` records before a
ping, and the only signal that separates "reviewed" from every other outcome.

A PR that has been reviewed once already starts at n >= 1, so a caller testing
n > 0 succeeds on its first read without a review having run. Compare against a
baseline taken before the ping, never against zero.

Arguments:
  <owner/repo>  e.g. gwenphalan/unimatrix-01
  <pr>          Pull request number

Environment:
  SHIP_PR_REVIEWS_FIXTURE  Path to a JSON file holding what
                           `gh api repos/<owner>/<repo>/pulls/<pr>/reviews`
                           would return. Used in place of the `gh` call, which
                           is how this script is exercised without a live PR.

Output:
  A single integer.

Exit codes:
  0  the count was read
  1  bad usage
  *  the `gh` call failed; its status is passed through, and nothing is printed.
     A failed call must never look like a count — a number that compares false
     against every baseline turns an expired token into an eternal wait.
EOF
}

case "${1:-}" in
  -h | --help)
    usage
    exit 0
    ;;
esac

if [ "$#" -ne 2 ]; then
  usage >&2
  exit 1
fi

repo=$1
pr=$2

if [ -n "${SHIP_PR_REVIEWS_FIXTURE:-}" ]; then
  jq '[.[] | select(.user.login == "coderabbitai[bot]")] | length' "$SHIP_PR_REVIEWS_FIXTURE"
else
  gh api "repos/$repo/pulls/$pr/reviews" \
    --jq '[.[] | select(.user.login=="coderabbitai[bot]")] | length'
fi

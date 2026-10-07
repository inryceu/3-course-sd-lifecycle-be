#!/usr/bin/env bash
# Applies identical branch protection to `main` and `dev` of both BoardSync repositories.
#
#   ./scripts/setup-branch-protection.sh --dry-run     print the requests, change nothing
#   ./scripts/setup-branch-protection.sh               apply (needs admin rights, `gh auth login`)
#   REPOS="owner/a owner/b" ./scripts/setup-branch-protection.sh
#
# Protection: pull request required, >= 1 approval (stale reviews dismissed, code-owner review
# required), required status checks (up to date with the base), conversations resolved, no force
# pushes, no branch deletion. Admins are not forced (so the owner can recover from a bad rule).
set -euo pipefail

REPOS="${REPOS:-inryceu/3-course-sd-lifecycle-be inryceu/3-course-sd-lifecycle-fe}"
BRANCHES="${BRANCHES:-main dev}"
# Names of the check runs reported by .github/workflows/ci.yml (identical in both repos).
REQUIRED_CHECKS='["Lint","TypeCheck","Tests","Build"]'

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

payload() {
  cat <<JSON
{
  "required_status_checks": { "strict": true, "contexts": ${REQUIRED_CHECKS} },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON
}

for repo in ${REPOS}; do
  for branch in ${BRANCHES}; do
    endpoint="repos/${repo}/branches/${branch}/protection"
    if [[ "${DRY_RUN}" == "true" ]]; then
      echo "PUT ${endpoint}"
      payload
    else
      echo "Protecting ${repo}@${branch}"
      payload | gh api --method PUT "${endpoint}" --input - > /dev/null
    fi
  done
done

if [[ "${DRY_RUN}" == "true" ]]; then echo "Done (dry run)."; else echo "Done."; fi

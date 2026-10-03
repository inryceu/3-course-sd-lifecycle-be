## 1. Backend repository files

- [x] 1.1 Add `.github/pull_request_template.md`; verify it contains Jira key, summary, OpenSpec link, test evidence and the five SOLID lines
- [x] 1.2 Add `.github/CODEOWNERS`; verify every path from the ticket is mapped and handles are valid GitHub logins
- [x] 1.3 Add `CONTRIBUTING.md`; verify it covers branches, commits, PR flow, OpenSpec flow and `-dev` conflict branches

## 2. Branch protection

- [x] 2.1 Add `scripts/setup-branch-protection.sh` with `--dry-run`; verify dry-run prints identical payloads for both repos and `bash -n` passes
- [x] 2.2 Document the script in CONTRIBUTING.md; verify the command and required checks are listed

## 3. Frontend repository

- [x] 3.1 Copy template, CODEOWNERS, CONTRIBUTING.md and the script to the frontend repo; verify the files are identical to the backend ones except repo-specific lines

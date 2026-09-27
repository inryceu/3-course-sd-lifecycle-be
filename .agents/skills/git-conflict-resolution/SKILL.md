---
name: git-conflict-resolution
description: Comprehensive workflow for resolving Git merge conflicts using conflict-resolution branches with -dev suffix, following project-specific branching and PR rules.
version: 1.0.0
---

# Git Conflict Resolution Skill

This skill defines the mandatory workflow for resolving merge conflicts in the BoardSync project. It enforces the project's branching strategy, PR targeting rules, and agent limitations.

## Core Rules

### 1. Conflict Resolution Branch Naming
- **Pattern**: `<feature-branch-name>-dev` (e.g., `KAN-10-dev`, `feat/user-auth-dev`)
- **Source**: Always cut from `origin/dev` (or local `dev` tracking branch)
- **Purpose**: Isolated environment to resolve conflicts before merging to `dev`

### 2. PR Targeting Rules
| Source Branch | Target Branch | Purpose |
|---------------|---------------|---------|
| `<feature>-dev` | `dev` | Integrate conflict-resolved changes into development |
| `<feature>` (original) | `main` | Direct path to production after dev validation |
| `<feature>` | `dev` | **FORBIDDEN** — conflicts must be resolved in `-dev` branch first |

### 3. Conflict Resolution Strategy

#### When Changes Don't Overlap (Non-Conflicting)
- **Action**: Accept both versions automatically
- **Git behavior**: `git merge` handles this automatically

#### When Changes Overlap (Conflicting)
1. **Analyze context**: Determine if changes are complementary or mutually exclusive
2. **If complementary**: Choose "both" — combine the changes manually
3. **If mutually exclusive**: Choose "select this one" based on:
   - Recency (newer change may supersede older)
   - Completeness (more complete implementation wins)
   - Architectural alignment (version that follows project rules wins)
4. **If ambiguous**: **STOP and escalate to human** — do not guess

#### Prohibited Actions
- ❌ Random selection between conflicting versions
- ❌ Automated resolution without context analysis
- ❌ Deleting one version without justification

### 4. Step-by-Step Workflow

```bash
# 1. Fetch latest remote state
git fetch origin

# 2. Create conflict-resolution branch from dev
git checkout -b <feature>-dev origin/dev

# 3. Merge feature branch to expose conflicts
git merge <feature> --no-commit --no-ff

# 4. Resolve each conflicted file:
#    - Open file, find <<<<<<< HEAD ... ======= ... >>>>>>> markers
#    - Apply resolution strategy above
#    - Remove conflict markers
#    - git add <file>

# 5. Commit resolution
git commit -m "merge: resolve conflicts for <feature> (<feature>-dev)"

# 6. Push conflict-resolution branch
git push origin <feature>-dev

# 7. Open PR: <feature>-dev → dev (via GitHub UI or gh CLI)

# 8. Open PR: <feature> → main (separate PR, no conflict resolution needed)
```

### 5. Agent Limitations (CRITICAL)

**Agents are PROHIBITED from:**
- Merging ANY pull requests
- Bypassing required reviews
- Force-pushing to protected branches (`main`, `dev`)

**Agents MAY:**
- Open new PRs
- Close PRs (with justification)
- Modify PRs (update branch, edit description)
- Comment on PRs (reviews, questions, suggestions)
- Push to feature branches and conflict-resolution branches

### 6. Escalation Protocol

When a conflict cannot be resolved automatically:

1. **Document the conflict**: List files, conflicting sections, and why resolution is ambiguous
2. **Create a PR comment**: Tag human reviewers with `@team` or specific handles
3. **Wait for human decision**: Do not proceed until explicit guidance is given
4. **Apply human decision**: Implement exactly as directed

### 7. Verification Checklist

Before marking conflict resolution complete:
- [ ] All conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) removed
- [ ] Code compiles/builds successfully
- [ ] Tests pass
- [ ] No unintended changes introduced
- [ ] Resolution documented in commit message
- [ ] PR opened from `-dev` branch to `dev`
- [ ] Separate PR opened from original branch to `main`

---

## Integration with Project Skills

This skill should be referenced in:
- `.agents/skills/openspec-propose` — when proposing changes that may conflict
- `.agents/skills/openspec-apply` — when applying changes that touch shared files
- `AGENTS.md` — as documented in the Git Workflow Rules section

---

## Examples

### Example 1: Complementary Changes (Choose Both)
```diff
# HEAD (dev) adds new field
+  newField: string;

# Feature adds different new field
+  anotherField: number;

# RESOLUTION: Keep both
+  newField: string;
+  anotherField: number;
```

### Example 2: Mutually Exclusive (Select One)
```diff
# HEAD (dev) uses npm
- npm install
- npm run build

# Feature uses pnpm (project standard)
+ pnpm install
+ pnpm build

# RESOLUTION: Select feature version (pnpm is project standard)
+ pnpm install
+ pnpm build
```

### Example 3: Ambiguous (Escalate)
```diff
# HEAD (dev) restructures module A
# Feature restructures module A differently
# Both have valid architectural reasoning
# RESOLUTION: STOP — escalate to human
```

---

## Related Files

- `AGENTS.md` — Contains Git Workflow Rules section (authoritative)
- `.github/workflows/ci.yml` — CI pipeline that validates merges
- `.agents/workflows/opsx-propose.md` — OpenSpec propose workflow
- `.agents/workflows/opsx-apply.md` — OpenSpec apply workflow
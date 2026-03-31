---
description: Pick up a Linear issue, gather context, branch, implement, and PR.
agent: build
model: openai/gpt-5.3-codex
---

# Implementation Workflow

Implement the Linear issue: $ARGUMENTS

## Steps

### 1. Fetch and resolve the issue tree

- Fetch the parent issue from Linear using the provided ID (e.g., PGR-123).
- Fetch all sub-issues of the parent.
- If the parent has sub-issues, treat it as a spec/tracking issue — **do not implement the parent directly**. All implementation work lives in the sub-issues.
- For each issue and sub-issue, read its description and comments to understand the full context (why, constraints, current state, scope).
- If any description references a spec file (e.g., `Spec: specs/<feature>.md`), read that file for additional detail.

### 2. Order sub-issues by dependency

- Inspect the `blockedBy` relations on each sub-issue.
- Perform a topological sort: sub-issues with no blockers come first; sub-issues blocked by others come after their blockers are complete.
- If there are no blocking relations, preserve the default Linear order.
- This sorted order is the **implementation sequence** for the steps below.

### 3. Create one branch for the parent issue

- Create a single branch named after the **parent** issue: `<parent-id-lowercase>-<slug>` (e.g., `pgr-28-queue-based-product-ingestion-offload`).
- Set the **parent** issue status to **In Progress** in Linear.

### 4. Implement sub-issues in dependency order

For each sub-issue (following the sorted order from Step 2):

1. Set the sub-issue status to **In Progress** in Linear (only when it is this sub-issue's turn — not before).
2. Implement the change exactly as described in the sub-issue (and its spec file, if any).
3. Run lint, tests, and typecheck. Fix any failures before continuing — do not commit broken code.
4. Commit with the sub-issue ID in the message: `<SUB-ISSUE-ID>: summary` (e.g., `PGR-29: configure queue and DLQ bindings`).
5. Set the sub-issue status to **In Review** in Linear.

Repeat for every sub-issue in sequence. Each sub-issue produces exactly one commit on the shared branch.

### 5. Self-review the full diff

After all sub-issues are committed, review the entire diff against `main`. Check for:

- Unused imports or references to non-existent functions
- AGENT.md convention violations (branch naming, file placement, styling)
- Empty catch blocks or swallowed errors
- Over-engineering or unnecessary abstractions

Fix any **Critical** issues found before proceeding. New fixes go in a new commit — do not amend.

### 6. Push and open a PR

- Push the branch to origin.
- Create a PR with `gh pr create` tied to the **parent** issue. Include in the PR body:
  - Summary of what each sub-issue changed and why
  - Verification section: lint, test, and typecheck results; files changed

### 7. Update Linear

- Set the **parent** issue status to **In Review**. It moves to **Done** after merge.
- Sub-issues are already **In Review**; they move to **Done** after merge.

## Issue workflow

Backlog → Todo → In Progress → In Review → Done

## Rules

- Do not amend existing commits. Create new commits to fix issues.
- Do not force push.
- If any verification fails, fix it before committing.
- If anything fails (git push, PR creation), stop and report the error clearly.
- Never mark a sub-issue **In Progress** before its blockers are complete.
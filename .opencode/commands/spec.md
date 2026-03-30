---
description: Write a spec and decompose it into conflict-free Linear tickets.
---

Write a spec and create Linear tickets for: $ARGUMENTS

## Steps

### 1. Write the spec

Create `specs/<feature-slug>.md` with these sections:

- **Why** — the motivation and problem being solved
- **What** — the desired outcome and user-facing behaviour
- **Constraints** — must-have, must-not, and out-of-scope boundaries
- **Current state** — what exists today and how it works (read the relevant code)
- **Tasks** — a list of discrete work items (see step 2)

### 2. Decompose into tasks

Break the spec into tasks that can each be a single PR. For each task, identify:

- **Title** — clear, imperative (e.g., "Extract platform icons into shared module")
- **Description** — what to change, which files, acceptance criteria
- **Files touched** — list every file the task will modify or create

### 3. Check for file overlaps

**This step is critical.** Before creating tickets, build a file-to-task map:

```
src/Module1.ts → Task 1, Task 3 ← OVERLAP
src/Module2.ts → Task 2
src/Module3.ts → Task 1
```

If any file appears in more than one task, you have an overlap. Resolve it by:

1. **Sequencing**: add a `blockedBy` dependency so one must merge before the other starts
2. **Merging**: combine the overlapping tasks into a single task
3. **Reordering**: change the task boundaries so each task owns distinct files

Overlapping tasks that run in parallel **will cause merge conflicts**. Every overlap must be resolved before creating tickets.

Present the file-to-task map to the user and flag any overlaps for their decision.

### 4. Create Linear tickets

In the **eSIM Reseller Store MVP** project under the **pgrsh** team:

**Parent issue:** Create one issue with the spec summary as description. Reference the spec file: `Spec: specs/<feature-slug>.md`

**Sub-issues:** Create one sub-issue per task, linked to the parent via `parentId`. Each sub-issue should have:

- A clear title and description with file paths and acceptance criteria
- A reference to the spec file
- `blockedBy` set if the task depends on another (from overlap resolution in step 3)

### 5. Output summary

Show the final task list with:

- Task titles and file ownership
- Dependency graph (which tasks block which)
- Which tasks can run in parallel safely
- Link to the parent Linear issue
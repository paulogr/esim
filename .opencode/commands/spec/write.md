---
description: Write a specification document.
agent: build
model: openai/gpt-5.4
subtask: true
---

Write a specification document for: $ARGUMENTS

## Steps

### 1. Write the spec

Create `specs/<feature-slug>.md` with these sections:

- **Why** — the motivation and problem being solved
- **What** — the desired outcome and user-facing behaviour
- **Constraints** — must-have, must-not, and out-of-scope boundaries
- **Current state** — what exists today and how it works (read the relevant code)
- **Tasks** — a list of discrete work items (see step 2)

### 2. Output summary

Show a concise summarization of what was specified ans ask user to review it before split into tasks.
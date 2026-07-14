## AI ROLE DIVISION

### ChatGPT

Use for:

* architecture
* debugging strategy
* system design
* prompt compression
* sequencing/prioritization
* operational workflows
* reviews/root-cause analysis
* migration planning
* UX direction
* data/status modeling

Acts as:

> CTO / systems architect

---

### Claude

Use for:

* large refactors
* multi-file consistency
* shared architecture extraction
* preserving structure during rewrites
* CSS consolidation
* portal unification
* huge HTML/JS files
* maintaining style consistency

Acts as:

> senior refactor engineer

---

### Codex

Use for:

* focused implementation
* CRUD pages
* repetitive edits
* migrations
* utility generation
* Supabase queries
* mechanical fixes
* small/medium scoped tasks

Acts as:

> fast implementation engineer

---

# PREFERRED WORKFLOW

1. ChatGPT

* define architecture
* define constraints
* define scope
* identify root cause

2. Claude

* implement large integrated changes

3. Codex

* implement focused features/fixes

4. ChatGPT

* review output
* identify regressions
* determine next steps

---

# PROMPT RULES

* Keep prompts surgical
* One subsystem at a time
* Only edit listed files
* Preserve existing behavior
* Return changed files
* Return test checklist
* Do not rewrite unnecessarily
* Preserve working integrations
* Reuse sessions per subsystem
* Start fresh chats when quality degrades

---

# REFACTOR PRIORITY

Priority order:

1. Stability
2. Shared architecture
3. Data integrity
4. UX consistency
5. Feature expansion

Avoid:

* giant rewrites
* simultaneous subsystem rewrites
* backend migrations without compatibility layer

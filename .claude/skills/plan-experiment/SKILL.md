---
name: plan-experiment
description: Set up a Linear project for an experiment and create issues from the implementation plan. Idempotent — safe to re-run after plan updates.
disable-model-invocation: true
argument-hint: "<plan-file-path> <team-key>"
compatibility:
  requires:
    - mcp: notion
      description: Used to check/update the Linear URL property on the experiment's Notion page
    - mcp: linear
      description: Core dependency — creates projects and issues, searches for duplicates
  optional:
    - cli: gh
      description: GitHub CLI — used to derive repo URL for report links. Must be authenticated (gh auth login)
---

# Plan Experiment

Read an experiment implementation plan (produced by `analyze-experiment`) and
set up the corresponding Linear project and issues. If a Linear project
already exists for this experiment, the skill detects it and updates existing
issues rather than creating duplicates.

## Prerequisites

**Required:**
- **Notion MCP** (`mcp__notion`): Must be connected. Used to check and update the `Linear` URL property on the experiment's Notion page.
- **Linear MCP** (`mcp__linear`): Must be connected. Used to create projects, create/update issues, and search for duplicates.

**Optional (graceful degradation):**
- **GitHub CLI** (`gh`): Used to derive the repo URL for report links. If missing, omit repo links from the report.

If a required tool is missing, stop and tell the user what needs to be set up.

## Workflow

### 1. Parse Arguments and Read the Plan

`$ARGUMENTS` contains: `<plan-file-path> <team-key>`

- Parse the first argument as the plan file path
- Parse the second argument as the Linear team key (e.g. `ENG`, `AI`)
- Read the plan file using the `Read` tool
- If the file does not exist, stop and tell the user to run `analyze-experiment` first
- Extract the experiment name from the `# {name} — Implementation Plan` heading
- Extract the Notion page ID from the `[Notion spec](https://www.notion.so/{id})` link in the plan header. The ID is the path segment after `notion.so/` — it may contain hyphens (strip them to get the raw ID) or be a UUID

### 2. Check Notion for Existing Linear Project

- Use `mcp__notion__notion-fetch` with the extracted Notion page ID to fetch the experiment page
- Look for the `Linear` property in the page properties — this is a URL-type property
- If the `Linear` property has a value: extract the URL. This is the existing Linear project URL.
- If the `Linear` property is empty or missing: no project exists yet

### 3. Resolve the Linear Team

- Use `mcp__linear__get_team` with the `<team-key>` argument to retrieve the team by its key
- If the team is not found, use `mcp__linear__list_teams` to list available teams and show the user the valid team keys. Stop.
- Store the team ID and team name for later use

### 4. Resolve or Create the Linear Project

**If no project exists (Notion `Linear` property is empty):**

1. Use `mcp__linear__save_project` to create a new project:
   - Name: the experiment name (from the plan heading)
   - Team: the resolved team ID
2. Store the project ID and project URL
3. Update the Notion page's `Linear` URL property with the new project URL.
   Use the Notion MCP to update the page property — use `mcp__notion__notion-update-page-property` (or the equivalent Notion MCP tool for updating a page property) with:
   - Page ID: the extracted Notion page ID
   - Property: `Linear`
   - Type: `url`
   - Value: the project URL

**If project already exists (Notion `Linear` property has a URL):**

1. Extract the project identifier from the URL
2. Use `mcp__linear__get_project` to fetch the project details
3. Store the project ID and project URL
4. If the project's team does not match the expected team, log a warning but continue

### 5. Resolve the Triage State

- Use `mcp__linear__list_issue_statuses` to get the workflow states available for the team
- Find the state named "Triage" (case-insensitive match)
- If "Triage" is not found, use `mcp__linear__get_issue_status` with name "Triage" as a fallback
- If still not found, fall back to the team's default state and log a warning
- Store the state ID for issue creation

### 6. Parse Tasks from the Plan

Parse the `## Tasks` section of the plan file. For each top-level task heading (`### N. Task Name` or `### N. {Task Name}`):

- Extract the task number and name (e.g. `1` and `Implementation`)
- Extract the full markdown content below the heading until the next `###` or `##` heading
- From the content, extract:
  - Checklist items (lines starting with `- [ ]` or `- [x]`)
  - Effort estimate (look for `S`, `M`, `L`, `XL` near words like "effort" or "estimate")
  - Any lines mentioning "blocker" or "blocked"
- Store each task as a structured object: `{ number, name, content, checklist, effort, blockers }`

### 7. Create or Update Linear Issues

For each parsed task:

**7a. Check for existing issue (duplicate detection):**

- Use `mcp__linear__list_issues` filtered by the project ID
- Search through the returned issues for one whose title contains the task name (e.g. "Implementation", "Cleanup")
- A match means the issue already exists

**7b. If no existing issue — create:**

- Use `mcp__linear__save_issue` with:
  - Title: `{Experiment Name}: {Task Name}` (e.g. "Onboarding Flow: Implementation")
  - Description: formatted using the Issue Description Format below
  - Team: the resolved team ID
  - Project: the resolved project ID
  - State: the Triage state ID from step 5
- Record the issue as "created" with its identifier and URL

**7c. If existing issue found — update:**

- Use `mcp__linear__save_issue` with:
  - ID: the matched issue's ID
  - Description: formatted using the Issue Description Format below (updated content)
  - Do NOT pass a state — preserve whatever state the issue is currently in
- Record the issue as "updated" with its identifier and URL

### Issue Description Format

For each issue, compose the description as follows:

```
{1-2 sentence TLDR summarizing what this task accomplishes and why}

---

## Acceptance Criteria

{Each checklist item from the plan, as markdown checkboxes}

## Context

- **Effort estimate:** {S/M/L or "Not specified"}
- **Blockers:** {any blockers, or "None"}
- **Notion spec:** [Link](https://www.notion.so/{notion-page-id})
- **Plan file:** `{plan-file-path}`
```

The TLDR should be written by you (Claude) — summarize the task's purpose in
1-2 clear sentences based on the task content. Do not just repeat the task
name.

### 8. Write Webhook Summary (MANDATORY)

**This step MUST always run — even if earlier steps fail or exit early.**
Before presenting results to the user, always write `/tmp/skill-summary.md`.
If the skill encounters an error at any point, write the summary with whatever
information is available up to that point plus a `### Errors` section
describing what went wrong.

Write a user-friendly markdown summary to `/tmp/skill-summary.md`. This file
is picked up by the CI workflow and sent to a webhook for visibility.

Derive the GitHub repo URL from `git remote get-url origin` (if `gh` CLI is
available), then use it to build markdown links.

**On success**, use this structure:

```markdown
## {Experiment Name} — Linear Project Setup Complete

### Summary
1-2 sentence synopsis of what was done.

### Project
- **Linear project:** [{Project Name}]({project-url})
- **Team:** {team-key}
- **Status:** {created | already existed}
- **Notion spec:** [Link](https://www.notion.so/{notion-page-id})

### Issues
{For each issue, one bullet:}
- [{issue-identifier}]({issue-url}) — {Task Name} ({created | updated})

### Stats
- **Issues created:** {count}
- **Issues updated:** {count}
- **Total issues in project:** {count}
```

**On failure or partial completion**, use this structure:

```markdown
## {Experiment Name} — Linear Project Setup Failed

### Summary
Brief description of what happened and where it stopped.

### Completed
{List any steps that completed successfully, with links if available}

### Errors
- {Error description and which step failed}

### Context
- **Plan file:** `{plan-file-path}`
- **Team:** {team-key}
- **Notion spec:** [Link](https://www.notion.so/{notion-page-id}) (if available)
```

### 9. Present to User

After completing all steps, inform the user of:
- The Linear project URL and whether it was newly created or already existed
- Whether the Notion page's `Linear` property was updated
- A list of all issues with their Linear URLs and status (created/updated)
- Any warnings encountered (team mismatch, missing Triage state, etc.)

## Rules

- **Always write the webhook summary:** `/tmp/skill-summary.md` must be
  written before the skill finishes, regardless of outcome. On success it
  contains the full report; on failure it contains whatever was completed
  plus error details. Never skip this step.
- **Idempotent:** Safe to re-run. Duplicate detection uses title matching
  within the project scope. Re-running after a plan update will update
  existing issues with new content.
- **Don't reset state:** When updating an existing issue, preserve its
  current workflow state. Only new issues are set to Triage.
- **TLDR + Acceptance Criteria:** All issue descriptions follow the
  structured format with a scannable summary at the top.
- **Triage for new issues:** New issues are created in the Triage state.
- **Team-scoped project:** The project belongs to the team identified by
  the key argument.
- **One issue per top-level task:** Each `### N. Task Name` in the plan
  becomes one Linear issue. Checklist items become acceptance criteria in
  the issue description.
- **Graceful warnings:** Team mismatches, missing states, and other
  non-fatal issues produce warnings but don't stop execution.

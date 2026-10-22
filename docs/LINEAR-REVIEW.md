# Differences from Linear

## Implemented differently

| Area | Linear | Jira Linear |
|---|---|---|
| Data | Linear's own workspace | One Jira project, mirrored locally; changes are written to Jira |
| Projects | Native projects | Jira epics |
| Project progress | Issue count or estimate | Weighted by Story Points; tickets without points count as 3 (adjustable, stored in the browser) |
| Project dates | Start and target date | Quarter, initial estimate and revised date, read from Jira and read-only; the target date picker writes Jira's due date |
| Project statuses | Backlog, Planned, Started, Completed, Canceled | Derived from the epic's Jira status and category |
| Backlog vs active | Separate status category | Jira has one "to do" category, so backlog statuses are configured by name |
| Ticket types | None | Jira issue types grouped as Bug / Spike / Task |
| Dropped work | Canceled issues leave the scope | Tickets closed as Won't Do, Duplicate and similar leave the scope; scope removed by moving a ticket out of an epic cannot be reconstructed |
| Descriptions | Rich editor | Rendered from Jira's format; editable as Markdown only when the description converts without loss |
| Relations | `M` then a key | Add and remove from the issue page and the command menu |
| `M` | Relation shortcuts | Comment |
| Review | Not present | `T` marks tickets for a "For review" view; stored locally, never written to Jira |

## Not built

- Peek (`Space`)
- URL routing for views and issues (the browser's Back button works for the issue page)
- Project timeline and milestones
- Project health and updates
- Project start date, icon and colour
- Documents as project resources
- Cycles
- Inbox, and the Subscribed and Activity tabs of My issues
- Manual ordering and `⌥↑`/`⌥↓`
- Workspace switcher
- Multiple Jira projects in one view

## Not possible with Jira

| Linear feature | Limit |
|---|---|
| Milestones | Epics have none |
| Project health and updates | No native epic updates |
| Cycles | Map to Jira sprints, which the app does not read |
| Progress history before an issue was moved | Jira cannot search an epic's past children |

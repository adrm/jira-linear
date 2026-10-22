<p align="center">
  <img src="assets/logo.svg" width="120" alt="Jira Linear logo">
</p>

<h1 align="center">Jira Linear</h1>

<p align="center">
  A fast, keyboard-first, Linear-style interface for one Jira project.
</p>

<p align="center">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-blue">
  <img alt="runtime" src="https://img.shields.io/badge/server-Deno-black">
  <img alt="client" src="https://img.shields.io/badge/client-React%20%2B%20Vite-61dafb">
</p>

---

A small Deno server keeps a local SQLite copy of one Jira project in sync. The browser keeps its own copy in IndexedDB, so lists, filters and boards never wait on the network. Changes are applied immediately and sent to Jira in the background: queued if Jira is unreachable, rolled back with a toast if Jira refuses them.

## Quick start

Requirements: [Deno](https://deno.com) 2+, Node 20+ (to build the web app once), and a Jira Cloud site with an [API token](https://id.atlassian.com/manage-profile/security/api-tokens).

```
cp .env.example .env      # fill in email, token, site URL and project key
deno task start           # or double-click Start.command on macOS
```

Open http://localhost:8766. The first launch builds the web app and loads the whole project (about a minute for ~4,000 issues); afterwards only changes are fetched. The server asks Jira every 5 minutes, and the page asks for an immediate check when you return to the tab.

### Configuration

Credentials and the site come from `.env` (or the environment):

| Variable | Required | Meaning |
|---|---|---|
| `JIRA_EMAIL`, `JIRA_API_TOKEN` | yes | Atlassian account and API token |
| `JIRA_LINEAR_BASE_URL` | yes* | Your site, e.g. `https://your-domain.atlassian.net` |
| `JIRA_LINEAR_PROJECT` | yes* | Project key to mirror |
| `ENV_FILE` | no | Path to the env file (default `./.env`) |
| `JIRA_LINEAR_CONFIG` | no | Path to the settings file (default `./jira-linear.config.json`) |
| `PORT` | no | Default `8766` |
| `JIRA_LINEAR_POLL_SECONDS` | no | Default `300`, minimum `30` |

\* or set `site` / `project` in the settings file. Variables set in the environment win over the file.

### Adapting it to your Jira

On start the server asks Jira which fields and statuses exist:

- **Planning fields** (Story Points, Quarter, initial and revised estimate) are found by their usual names. To use a different field, give its name or id (`customfield_12345`) in `jira-linear.config.json`; a field that does not exist hides the feature that needs it.
- **Workflow**: the project's statuses and their categories come from Jira. Jira does not say which status comes after which, so they follow Jira's order within each category; set `workflow.order` to fix that. `backlog` and `canceled` name the statuses that mean "not planned yet" and "dropped"; `colors` sets `[hue, chroma]` per status, otherwise colours are generated.
- **Vocabulary**: priority names, and which issue types count as Bug, Spike or sub-task, differ between sites and languages. The defaults cover English and Spanish schemes; set `vocab` to replace any list for your site. Each key replaces its default entirely, names are written as Jira shows them, and `bugTypes` / `spikeTypes` ignore case.
  - `priorities`: priority name → rank from 0 (lowest) to 4 (highest); unlisted names count as 2. Ranks drive ordering and the five priority icons (4 urgent, 3 high, 2 medium, 1 and 0 low).
  - `bugTypes`, `spikeTypes`: issue types shown as Bug and Spike; every other type shows as Task.
  - `subtaskTypes`: the sub-task type(s), used when creating sub-issues.
  - `nonTicketTypes`: types left out of the type picker (epics, sub-tasks).
- **Project name** in the sidebar defaults to the key (`projectName`).

See [jira-linear.config.example.json](jira-linear.config.example.json). The file is optional and gitignored.

### Keep it running in the background (macOS)

```
deno task service:install     # LaunchAgent: starts at login, restarts if it stops
deno task service:status
deno task service:uninstall   # stops it and removes the agent; nothing else changes
```

The launchd label defaults to `com.jira-linear`; set `serviceLabel` in the settings (or `JIRA_LINEAR_SERVICE_LABEL`) to change it. Logs go to `data/service.log`. If `service:status` says "not answering", macOS probably has not allowed `deno` to read the folder: approve the prompt or add `~/.deno/bin/deno` under System Settings → Privacy & Security → Full Disk Access, then install again. Keep the project outside iCloud/OneDrive-synced folders, since `data/mirror.db` changes constantly.

## Keys

`?` or `F1` shows them all.

| Where | Keys |
|---|---|
| Move | `J`/`K` or `↓`/`↑`, `⌘↑`/`⌘↓` first/last; on a board `←`/`→` change column |
| Select | `X`, `⇧↓`/`⇧↑`, shift-click, `⌘A`, `Esc` to clear; every property key below then applies to all of them |
| Change | `S` status, `A` assign, `I` assign to me, `P` priority, `L` labels (the **Type** group is Bug / Spike / Task), `⇧P` project, `⇧D` due date, `R` rename, `M` comment, `T` mark / unmark for team review |
| Go | `G` then `I` my issues, `A` active, `B` backlog, `R` for review, `T` all issues, `P` projects |
| Open | `Enter` (full page), `O` open in Jira, `Y` copy link; on a project page `O`/`Y` act on the epic |
| View | `F` filter, `⇧V` display options, `⌘B` list/board, `⌘.` sidebar, `⌘I` project details |
| General | `C` create, `/` search, `⌘K` command menu (acts on the highlighted ticket or selection), `⌘Z` undo |

## What it does

- **Tickets** are grouped by any of status, assignee, project, priority, label or type, as a list or a board you can drag cards across. Status icons fill up as a ticket moves toward done, each status has its own colour, and blocked/blocking tickets get a badge. Filters (with `is`, `is either of`, `is not`) and display options are remembered per view; a filtered view can be saved and appears in the sidebar.
- **Issue page** (`Enter`): breadcrumbs, Back (also the browser's Back button), previous/next through the list you came from with `J`/`K`, click-to-edit title and description (only when the description survives a round trip to Markdown; otherwise it points you to Jira), sub-issues, relations as tables with add/remove and undo, the Jira change history merged with comments, and a properties sidebar.
- **Projects** (Jira epics): an overview strip (projects per state with combined progress, overdue and slipped), then a list or board grouped by state, quarter or lead. A project page has **Overview** and **Issues** tabs (Issues is an ordinary issues view with filters, display options and board), a details sidebar (properties, members, resources/links, progress graph with forecast, completion by assignee/label) and relationships between projects as tables. The project's Jira key is a chip: click copies the link, ⌘/ctrl-click or middle-click opens it in Jira. The same chip is on the issue page, whose project is a link to it (the pencil next to it changes the project).
- **Story points**: progress, the chart, the forecast and the assignee/label breakdowns are weighted by Jira's Story Points. Tickets without points count as 3; change that in the project sidebar (Progress), it is remembered in this browser. Tickets closed as Won't Do, Duplicate and similar leave the project's scope instead of counting as done, and the chart's scope line drops accordingly. Scope removed by moving a ticket out of an epic cannot be reconstructed (Jira cannot search an epic's past children).
- **Quarter and dates** on projects: quarter, initial estimate and revised date (read from Jira), the effective target (revised, else initial, else due date), a "Slipped N d" chip, and how long a project has been in its status. Group projects by quarter in Display. These fields are read-only here; the Target date picker still writes Jira's due date.
- **For review**: mark tickets with `T` (or the Review button in the bulk bar, the ticket page, the context menu) to keep a "For review" view for the team. Marks are stored on this computer only and are never written to Jira, and there are no notes.
- **Progress chart** (project sidebar): scope, started and completed lines, completed-per-week bars, the target line, markers for the initial estimate and revised date, and Linear-style forecast: velocity from the last four weeks (recent weeks weigh more), work in progress counts as a quarter, early–late range of about ±40%, written as "Estimated completion" with how far it is from the target.
- **Undo and toasts** for every change that can be reversed; **bulk edit** with a floating bar; right-click menus.
- **Appearance**: LCH-generated light and dark themes, a high-contrast option and compact density (all in the command menu).

How it differs from Linear, and what is not built: [docs/LINEAR-REVIEW.md](docs/LINEAR-REVIEW.md).

## Tests

```
deno task test            # server: fake Jira, no network
cd web && npm test        # client: store, queue, keyboard flows
```

Server tests run against `server/testing/fake_jira.ts`.

## Layout

- `server/` Deno server: Jira client, sync, mutations, HTTP API, SQLite mirror
- `shared/` types and the Markdown→ADF converter used by both sides
- `web/` Vite + React client
- `assets/` logo
- `data/` the local mirror (gitignored)

## License

[MIT](LICENSE)

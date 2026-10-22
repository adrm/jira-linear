import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createAppStore, memoryPersistence } from "../store/store";
import { createUiStore } from "../store/ui";
import { createSettingsStore } from "../store/settings";
import { FakeServer, mkIssue } from "../test/fakeServer";

const ana = { id: "u1", name: "Ana" };
const raul = { id: "u2", name: "Raul" };
let server: FakeServer;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

beforeEach(() => {
  server = new FakeServer();
  server.put(mkIssue("ABC-1", { summary: "Fix revenue chart", status: "In Development", statusCategory: "indeterminate", assignee: ana, updated: "2026-10-14T10:00:00.000+0000", priority: "High" }));
  server.put(mkIssue("ABC-2", { summary: "Vendor access for Spotify", status: "Ready for Dev", updated: "2026-10-13T10:00:00.000+0000", assignee: raul, labels: ["CA:backend"] }));
  server.put(mkIssue("ABC-3", { summary: "Old finished thing", status: "Cerrada", statusCategory: "done", updated: daysAgo(3) }));
  server.put(mkIssue("ABC-4", { summary: "Quarterly reporting", issuetype: "Epic", updated: "2026-10-01T10:00:00.000+0000" }));
  server.put(mkIssue("ABC-5", { summary: "A bug", issuetype: "Bug", updated: daysAgo(5), status: "Cerrada", statusCategory: "done" }));
  server.addComment({ id: "c1", issueKey: "ABC-1", author: raul, bodyAdf: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "Looks good to me" }] }] }, created: "2026-10-14T11:00:00.000+0000", updated: "2026-10-14T11:00:00.000+0000" });
});

async function renderApp(extra: Partial<Parameters<typeof App>[0]> = {}) {
  let n = 0;
  const app = createAppStore({ fetch: server.fetch, persistence: memoryPersistence(), newId: () => `t${++n}` });
  const ui = createUiStore();
  const mem = new Map<string, string>();
  const settings = createSettingsStore({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) });
  const openExternal = vi.fn();
  const copyText = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(<App app={app} ui={ui} settings={settings} fetchFn={server.fetch} jiraUrl="https://jira.test" openExternal={openExternal} copyText={copyText} pollMs={0} {...extra} />);
  await screen.findByRole("listbox", { name: "Issues" });
  await screen.findByText("Fix revenue chart");
  return { app, ui, user, openExternal, copyText, settings };
}
const rowOf = (key: string) => screen.getByRole("option", { name: new RegExp(`^${key}\\b`) });
const selectedKeys = () => screen.queryAllByRole("option", { selected: true }).map((e) => e.getAttribute("data-key"));

describe("list", () => {
  it("shows active issues grouped by status with counts, hiding done work", async () => {
    await renderApp();
    expect(screen.getByRole("group", { name: /In Development/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Ready for Dev/ })).toBeInTheDocument();
    expect(screen.queryByText("Old finished thing")).not.toBeInTheDocument();
    expect(within(rowOf("ABC-1")).getByText("Fix revenue chart")).toBeInTheDocument();
  });

  it("j and k move the selection through the visible order", async () => {
    const { user } = await renderApp();
    await user.keyboard("j");
    expect(selectedKeys()).toEqual(["ABC-1"]); // In Development comes first
    await user.keyboard("j");
    expect(selectedKeys()).toEqual(["ABC-2"]);
    await user.keyboard("k");
    expect(selectedKeys()).toEqual(["ABC-1"]);
  });

  it("g then t shows all issues including done; g then a returns to active", async () => {
    const { user } = await renderApp();
    await user.keyboard("gt");
    expect(await screen.findByText("Old finished thing")).toBeInTheDocument();
    await user.keyboard("ga");
    await waitFor(() => expect(screen.queryByText("Old finished thing")).not.toBeInTheDocument());
  });

  it("g then i shows only my issues", async () => {
    const { user } = await renderApp();
    await user.keyboard("gi");
    await waitFor(() => expect(screen.queryByText("Vendor access for Spotify")).not.toBeInTheDocument());
    expect(screen.getByText("Fix revenue chart")).toBeInTheDocument();
  });

  it("clicking a row selects it and double-click opens detail", async () => {
    const { user } = await renderApp();
    await user.click(rowOf("ABC-2"));
    expect(selectedKeys()).toEqual(["ABC-2"]);
    await user.dblClick(rowOf("ABC-2"));
    expect(await screen.findByRole("region", { name: "Issue detail" })).toBeInTheDocument();
  });
});

describe("detail", () => {
  it("Enter opens the detail with description, comments and properties; Escape closes", async () => {
    const { user } = await renderApp();
    await user.keyboard("j{Enter}");
    const detail = await screen.findByRole("region", { name: "Issue detail" });
    expect(within(detail).getByRole("heading", { name: "Fix revenue chart" })).toBeInTheDocument();
    expect(within(detail).getByText("Looks good to me")).toBeInTheDocument();
    expect(within(detail).getByText("In Development")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Issue detail" })).not.toBeInTheDocument();
  });

  it("with detail open, ] and [ move to the next and previous issue", async () => {
    const { user } = await renderApp();
    await user.keyboard("j{Enter}]");
    const detail = await screen.findByRole("region", { name: "Issue detail" });
    expect(within(detail).getByRole("heading", { name: "Vendor access for Spotify" })).toBeInTheDocument();
    await user.keyboard("[["); // user-event escapes a literal [ as [[
    expect(within(detail).getByRole("heading", { name: "Fix revenue chart" })).toBeInTheDocument();
  });

  it("o opens the issue in Jira and y copies its link", async () => {
    const { user, openExternal, copyText } = await renderApp();
    await user.keyboard("jo");
    expect(openExternal).toHaveBeenCalledWith("https://jira.test/browse/ABC-1");
    await user.keyboard("y");
    expect(copyText).toHaveBeenCalledWith("https://jira.test/browse/ABC-1");
  });
});

describe("status", () => {
  it("s opens the status picker; typing filters; Enter applies instantly and syncs", async () => {
    const { user } = await renderApp();
    await user.keyboard("js");
    const dialog = await screen.findByRole("dialog", { name: "Set status" });
    await user.keyboard("code");
    expect(within(dialog).getAllByRole("option")).toHaveLength(1);
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog", { name: "Set status" })).not.toBeInTheDocument();
    await waitFor(() => expect(server.rows.get("ABC-1")!.status).toBe("Code Review"));
    expect(server.received.map((r) => r.op)).toEqual(["setStatus"]);
  });

  it("a rejected status change rolls back and explains why", async () => {
    const { user } = await renderApp();
    server.failNext.push({ status: 400, error: 'No transition from the current status to "Backlog"' });
    await user.keyboard("js");
    await screen.findByRole("dialog", { name: "Set status" });
    await user.keyboard("backlog{Enter}");
    const toast = await screen.findByRole("alert");
    expect(toast).toHaveTextContent("No transition from the current status");
    expect(within(screen.getByRole("group", { name: /In Development/ })).getByText("Fix revenue chart")).toBeInTheDocument();
    expect(server.rows.get("ABC-1")!.status).toBe("In Development");
  });
});

describe("assignee", () => {
  it("i assigns the selected issue to me", async () => {
    const { user } = await renderApp();
    await user.keyboard("jji"); // ABC-2 is Raul's
    await waitFor(() => expect(server.rows.get("ABC-2")!.assignee?.id).toBe("u1"));
  });

  it("a opens the assignee picker with people from the data and Unassigned", async () => {
    const { user } = await renderApp();
    await user.keyboard("ja");
    const dialog = await screen.findByRole("dialog", { name: "Set assignee" });
    expect(within(dialog).getByText("Ana")).toBeInTheDocument();
    expect(within(dialog).getByText("Raul")).toBeInTheDocument();
    await user.keyboard("unass{Enter}");
    await waitFor(() => expect(server.rows.get("ABC-1")!.assignee).toBeNull());
  });
});

describe("search, palette and help", () => {
  it("/ focuses search and filters the list; Escape clears it", async () => {
    const { user } = await renderApp();
    await user.keyboard("/");
    expect(screen.getByRole("searchbox", { name: "Search issues" })).toHaveFocus();
    await user.keyboard("spotify");
    expect(screen.queryByText("Fix revenue chart")).not.toBeInTheDocument();
    expect(screen.getByText("Vendor access for Spotify")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(await screen.findByText("Fix revenue chart")).toBeInTheDocument();
  });

  it("typing in a field never triggers shortcuts", async () => {
    const { user } = await renderApp();
    await user.keyboard("/");
    await user.keyboard("jsa");
    expect(screen.queryByRole("dialog", { name: "Set status" })).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search issues" })).toHaveValue("jsa");
  });

  it("Cmd+K opens the palette; choosing an issue opens its detail", async () => {
    const { user } = await renderApp();
    await user.keyboard("{Meta>}k{/Meta}");
    await screen.findByRole("dialog", { name: "Command palette" });
    await user.keyboard("vendor access");
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
    const detail = await screen.findByRole("region", { name: "Issue detail" });
    expect(within(detail).getByRole("heading", { name: "Vendor access for Spotify" })).toBeInTheDocument();
  });

  it("the palette also runs commands, such as switching view", async () => {
    const { user } = await renderApp();
    await user.keyboard("{Meta>}k{/Meta}");
    await screen.findByRole("dialog", { name: "Command palette" });
    await user.keyboard("go to all issues{Enter}");
    expect(await screen.findByText("Old finished thing")).toBeInTheDocument();
  });

  it("? shows the keyboard shortcuts", async () => {
    const { user } = await renderApp();
    await user.keyboard("?");
    const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    expect(within(dialog).getByText("Set status")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).not.toBeInTheDocument();
  });
});

describe("connection state", () => {
  it("shows queued changes and an offline badge when the server is unreachable", async () => {
    const { user } = await renderApp();
    server.offline = true;
    await user.keyboard("js");
    await screen.findByRole("dialog", { name: "Set status" });
    await user.keyboard("code{Enter}");
    expect(await screen.findByText(/offline/i)).toBeInTheDocument();
    expect(screen.getByText(/1 queued/i)).toBeInTheDocument();
    // optimistic: the row has already moved to its new status group
    expect(within(screen.getByRole("group", { name: /Code Review/ })).getByText("Fix revenue chart")).toBeInTheDocument();
  });
});

describe("more issue actions", () => {
  it("p offers the priorities used in the data, highest first, and sets the chosen one", async () => {
    server.put(mkIssue("ABC-6", { summary: "Low one", priority: "Low", updated: "2026-10-01T00:00:00.000+0000" }));
    server.put(mkIssue("ABC-7", { summary: "Critical one", priority: "Crítica", updated: "2026-10-01T00:00:00.000+0000" }));
    const { user } = await renderApp();
    await user.keyboard("jp");
    const dialog = await screen.findByRole("dialog", { name: "Set priority" });
    expect(within(dialog).getAllByRole("option").map((o) => o.textContent)).toEqual(["Crítica", "High", "Medium", "Low"]);
    await user.keyboard("low{Enter}");
    await waitFor(() => expect(server.rows.get("ABC-1")!.priority).toBe("Low"));
  });

  it("l toggles labels and keeps the dialog open for more", async () => {
    const { user } = await renderApp();
    await user.keyboard("jl");
    const dialog = await screen.findByRole("dialog", { name: "Set labels" });
    await user.keyboard("backend{Enter}"); // existing label from ABC-2
    await waitFor(() => expect(server.rows.get("ABC-1")!.labels).toEqual(["CA:backend"]));
    expect(screen.getByRole("dialog", { name: "Set labels" })).toBe(dialog);
    await user.keyboard("{Enter}"); // toggle it off again
    await waitFor(() => expect(server.rows.get("ABC-1")!.labels).toEqual([]));
  });

  it("l can add a brand-new label by typing it", async () => {
    const { user } = await renderApp();
    await user.keyboard("jl");
    await screen.findByRole("dialog", { name: "Set labels" });
    await user.keyboard("CA:design");
    await user.click(await screen.findByText(/Add label “CA:design”/));
    await waitFor(() => expect(server.rows.get("ABC-1")!.labels).toEqual(["CA:design"]));
  });

  it("e sets the project (parent epic) from the projects in the data, and can clear it", async () => {
    const { user } = await renderApp();
    await user.keyboard("j{Shift>}p{/Shift}");
    const dialog = await screen.findByRole("dialog", { name: "Set project" });
    expect(within(dialog).getByText("Quarterly reporting")).toBeInTheDocument();
    expect(within(dialog).getByText("No project")).toBeInTheDocument();
    await user.keyboard("quarterly{Enter}");
    await waitFor(() => expect(server.rows.get("ABC-1")!.parentKey).toBe("ABC-4"));
  });

  it("d sets a due date; the dialog submits with Enter", async () => {
    const { user } = await renderApp();
    await user.keyboard("j{Shift>}d{/Shift}");
    const dialog = await screen.findByRole("dialog", { name: "Set due date" });
    await user.type(within(dialog).getByLabelText("Due date"), "2026-11-01{Enter}");
    await waitFor(() => expect(server.rows.get("ABC-1")!.duedate).toBe("2026-11-01"));
    expect(screen.queryByRole("dialog", { name: "Set due date" })).not.toBeInTheDocument();
  });

  it("m focuses the comment box in the detail; Cmd+Enter posts and clears it", async () => {
    const { user } = await renderApp();
    await user.keyboard("jm");
    const box = await screen.findByRole("textbox", { name: "Add a comment" });
    expect(box).toHaveFocus();
    await user.keyboard("Ship it");
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await waitFor(() => expect(server.comments.some((c) => c.issueKey === "ABC-1" && JSON.stringify(c.bodyAdf).includes("Ship it"))).toBe(true));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Add a comment" })).toHaveValue(""));
  });

  it("an empty comment is not sent", async () => {
    const { user } = await renderApp();
    await user.keyboard("jm");
    await screen.findByRole("textbox", { name: "Add a comment" });
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(server.received.filter((r) => r.op === "addComment")).toHaveLength(0);
  });
});

describe("create issue", () => {
  const dlg = () => screen.getByRole("dialog", { name: "Create issue" });
  const pill = (name: RegExp | string) => within(dlg()).getByRole("button", { name });
  async function choose(user: ReturnType<typeof userEvent.setup>, pillName: RegExp, option: string | RegExp) {
    await user.click(pill(pillName));
    const pop = await screen.findByRole("dialog", { name: /^Choose / });
    await user.click(within(pop).getByRole("option", { name: option }));
  }
  const open = async () => {
    const r = await renderApp();
    await r.user.keyboard("c");
    await screen.findByRole("dialog", { name: "Create issue" });
    return r;
  };

  it("c opens the dialog with the title focused; Create stays disabled until there is a title", async () => {
    const { user } = await open();
    expect(within(dlg()).getByLabelText("Summary")).toHaveFocus();
    expect(within(dlg()).getByRole("button", { name: "Create issue" })).toBeDisabled();
    await user.keyboard("A fresh idea");
    expect(within(dlg()).getByRole("button", { name: "Create issue" })).toBeEnabled();
  });

  it("shows each property as a pill with its current value", async () => {
    await open();
    for (const name of ["Type: Task", "Status: Backlog", "Priority: none", "Assignee: Unassigned", "Labels: none", "Project: none", "Due date: none"]) {
      expect(pill(name)).toBeInTheDocument();
    }
  });

  it("creates the issue with everything chosen through the pills and shows it at once", async () => {
    const { user } = await open();
    await user.type(within(dlg()).getByLabelText("Summary"), "Brand new work");
    await user.type(within(dlg()).getByLabelText("Description"), "Steps to reproduce");
    await choose(user, /^Type:/, "Bug");
    await choose(user, /^Status:/, "In Development");
    await choose(user, /^Priority:/, "High");
    await choose(user, /^Assignee:/, /^Ana/);
    await choose(user, /^Project:/, /^Quarterly reporting/);
    await user.click(pill(/^Labels:/));
    const pop = await screen.findByRole("dialog", { name: "Choose labels" });
    await user.click(within(pop).getByRole("option", { name: /CA:backend/ }));
    await user.keyboard("{Escape}"); // closes only the popover
    expect(pill("Labels: CA:backend")).toBeInTheDocument();
    await user.click(pill(/^Due date:/));
    const date = await screen.findByLabelText("Due date");
    await user.type(date, "2026-12-01{Enter}");
    await user.click(within(dlg()).getByRole("button", { name: "Create issue" }));
    expect(screen.queryByRole("dialog", { name: "Create issue" })).not.toBeInTheDocument();
    await waitFor(() => expect(server.created).toHaveLength(1));
    expect(server.created[0]).toMatchObject({
      op: "createIssue", summary: "Brand new work", markdown: "Steps to reproduce", issuetype: "Bug", status: "In Development",
      priority: "High", assigneeId: "u1", labels: ["CA:backend"], parentKey: "ABC-4", duedate: "2026-12-01",
    });
    expect(await screen.findByText("Brand new work")).toBeInTheDocument(); // started in an active status, so it is in this view
  });

  it("Cmd+Enter submits from the keyboard", async () => {
    const { user } = await open();
    await user.keyboard("Quick one{Meta>}{Enter}{/Meta}");
    await waitFor(() => expect(server.created.some((c) => c.summary === "Quick one")).toBe(true));
  });

  it("Escape closes the dialog without creating anything, but first closes an open list", async () => {
    const { user } = await open();
    await user.keyboard("Never mind");
    await user.click(pill(/^Status:/));
    await screen.findByRole("dialog", { name: "Choose status" });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Choose status" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Create issue" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Create issue" })).not.toBeInTheDocument();
    expect(server.received).toHaveLength(0);
  });

  it("Create more keeps the dialog open with the same properties and an empty title", async () => {
    const { user } = await open();
    await choose(user, /^Priority:/, "High");
    await user.click(within(dlg()).getByRole("checkbox", { name: "Create more" }));
    await user.type(within(dlg()).getByLabelText("Summary"), "First{Meta>}{Enter}{/Meta}");
    await waitFor(() => expect(server.created).toHaveLength(1));
    expect(screen.getByRole("dialog", { name: "Create issue" })).toBeInTheDocument();
    expect(within(dlg()).getByLabelText("Summary")).toHaveValue("");
    expect(within(dlg()).getByLabelText("Summary")).toHaveFocus();
    expect(pill("Priority: High")).toBeInTheDocument();
    await user.keyboard("Second{Meta>}{Enter}{/Meta}");
    await waitFor(() => expect(server.created).toHaveLength(2));
    expect(await screen.findByText("Created “First”")).toBeInTheDocument();
  });

  it("starts from where you are: the project you are viewing", async () => {
    seedProjects();
    const { user } = await renderApp();
    await user.keyboard("gpj{Enter}");
    await screen.findByRole("region", { name: "Project Platform migration" });
    await user.keyboard("c");
    await screen.findByRole("dialog", { name: "Create issue" });
    expect(pill("Project: Platform migration")).toBeInTheDocument();
  });

  it("starts from where you are: My issues assigns the new issue to you", async () => {
    const { user } = await renderApp();
    await user.keyboard("gic");
    await screen.findByRole("dialog", { name: "Create issue" });
    expect(pill("Assignee: Ana")).toBeInTheDocument();
  });

  it("a group's + button starts a new issue in that status", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole("button", { name: "Add issue to In Development" }));
    await screen.findByRole("dialog", { name: "Create issue" });
    expect(pill("Status: In Development")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- projects
const bob = { id: "u3", name: "Bea" };
function seedProjects() {
  // two projects with cross-project dependencies, plus an ongoing one
  server.put(mkIssue("ABC-10", { summary: "Platform migration", issuetype: "Epic", status: "In Development", statusCategory: "indeterminate", assignee: ana, duedate: "2026-06-01", updated: "2026-10-14T09:00:00.000+0000",
    descriptionAdf: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "Move everything to the new platform" }] }] } }));
  server.put(mkIssue("ABC-11", { summary: "Billing revamp", issuetype: "Epic", status: "Backlog", statusCategory: "new", updated: "2026-10-12T09:00:00.000+0000" }));
  server.put(mkIssue("ABC-15", { summary: "[PERMANENT] Tech refactor", issuetype: "Epic", status: "In Development", statusCategory: "indeterminate", updated: "2026-10-01T09:00:00.000+0000" }));
  const summaries: Record<string, string> = { "ABC-13": "Migrate invoices endpoint", "ABC-14": "Design invoice schema" };
  const blocks = (direction: "inward" | "outward", key: string) => ({ id: `${direction}${key}`, type: "Blocks", direction, phrase: direction === "outward" ? "blocks" : "is blocked by", key, summary: summaries[key] ?? key });
  server.put(mkIssue("ABC-12", { summary: "Cut over database", parentKey: "ABC-10", parentSummary: "Platform migration", status: "Cerrada", statusCategory: "done", updated: "2026-10-05T09:00:00.000+0000" }));
  server.put(mkIssue("ABC-13", { summary: "Migrate invoices endpoint", parentKey: "ABC-10", parentSummary: "Platform migration", status: "In Development", statusCategory: "indeterminate", assignee: bob, updated: "2026-10-14T10:00:00.000+0000", links: [blocks("inward", "ABC-14")] }));
  server.put(mkIssue("ABC-14", { summary: "Design invoice schema", parentKey: "ABC-11", parentSummary: "Billing revamp", status: "Ready for Dev", statusCategory: "new", updated: "2026-10-13T10:00:00.000+0000", links: [blocks("outward", "ABC-13")] }));
}

describe("epics are projects", () => {
  async function openFirstProject() {
    seedProjects();
    const r = await renderApp();
    await r.user.keyboard("gpj{Enter}");
    await screen.findByRole("region", { name: "Project Platform migration" });
    return r;
  }

  it("epics do not appear as tickets in the Active or All views", async () => {
    seedProjects();
    const { user } = await renderApp();
    expect(screen.queryByText("Quarterly reporting")).not.toBeInTheDocument();
    expect(screen.queryByText("Platform migration", { selector: ".row-title" })).not.toBeInTheDocument();
    await user.keyboard("gt");
    await screen.findByText("Old finished thing");
    expect(screen.queryByText("Quarterly reporting")).not.toBeInTheDocument();
  });

  it("g then p opens Projects, grouped by state, with progress", async () => {
    seedProjects();
    const { user } = await renderApp();
    await user.keyboard("gp");
    expect(await screen.findByRole("listbox", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /In progress/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Backlog/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /^Ongoing, \d/ })).toBeInTheDocument();
    const row = screen.getByRole("option", { name: /^Platform migration/ });
    expect(within(row).getByText("50%")).toBeInTheDocument(); // 1 of 2 tickets done
    expect(within(row).getByText("Ana")).toBeInTheDocument(); // lead
    expect(within(row).getByText(/overdue/i)).toBeInTheDocument(); // target 2026-06-01 has passed
    expect(within(screen.getByRole("listbox", { name: "Projects" })).getByText("Tech refactor")).toBeInTheDocument(); // [PERMANENT] prefix removed
  });

  it("the search box filters the projects list by name", async () => {
    seedProjects();
    const { user } = await renderApp();
    await user.keyboard("gp/");
    await user.keyboard("billing");
    expect(screen.getByRole("option", { name: /^Billing revamp/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /^Platform migration/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /^Ongoing, \d/ })).not.toBeInTheDocument();
  });

  it("j/k select projects and Enter opens the project page; its tickets are on the Issues tab", async () => {
    seedProjects();
    const { user } = await renderApp();
    await user.keyboard("gpj{Enter}");
    const page = await screen.findByRole("region", { name: "Project Platform migration" });
    expect(within(page).getByRole("heading", { name: "Platform migration" })).toBeInTheDocument();
    expect(within(page).getByText("Move everything to the new platform")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /^Issues/ }));
    expect(screen.getByText("Migrate invoices endpoint")).toBeInTheDocument();
    expect(screen.getByText("Cut over database")).toBeInTheDocument(); // done tickets are shown on the project page
    expect(within(screen.getByRole("listbox", { name: "Issues" })).queryByText("Design invoice schema")).not.toBeInTheDocument(); // belongs to Billing revamp
  });

  it("the whole project description is always shown, with no toggle", async () => {
    seedProjects();
    const { user } = await renderApp();
    await user.keyboard("gpj{Enter}");
    const page = await screen.findByRole("region", { name: "Project Platform migration" });
    expect(within(page).getByText("Move everything to the new platform")).toBeInTheDocument();
    expect(within(page).queryByRole("button", { name: /Show full description|Show less/ })).toBeNull();
    expect(page.querySelector(".is-clamped")).toBeNull();
  });

  it("o opens the project's epic in Jira and y copies its link, like it does for tickets", async () => {
    const { user, openExternal, copyText } = await openFirstProject();
    await user.keyboard("o");
    expect(openExternal).toHaveBeenCalledWith("https://jira.test/browse/ABC-10");
    await user.keyboard("y");
    expect(copyText).toHaveBeenCalledWith("https://jira.test/browse/ABC-10");
  });

  it("with a ticket highlighted on the project page, o opens the ticket instead", async () => {
    const { user, openExternal } = await openFirstProject();
    await user.click(screen.getByRole("tab", { name: /^Issues/ }));
    await user.keyboard("j");
    const key = document.querySelector('[role="option"][aria-selected="true"]')!.getAttribute("data-key");
    await user.keyboard("o");
    expect(openExternal).toHaveBeenLastCalledWith(`https://jira.test/browse/${key}`);
  });

  it("in the project list, o opens the highlighted project's epic", async () => {
    seedProjects();
    const { user, openExternal } = await renderApp();
    await user.keyboard("gpjo");
    expect(openExternal).toHaveBeenCalledWith("https://jira.test/browse/ABC-10");
  });

  it("the project page lists relationships as a table of tickets", async () => {
    const { user } = await openFirstProject();
    const rel = await screen.findByRole("region", { name: "Relationships" });
    expect(within(rel).getByText("Blocked by")).toBeInTheDocument();
    const table = within(rel).getByRole("table", { name: "Blocked by" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Ticket", "Project", "Assignee", "Blocking"]);
    const row = within(table).getByRole("row", { name: /ABC-14/ });
    expect(within(row).getByText("ABC-14")).toBeInTheDocument();
    expect(within(row).getByText("Design invoice schema")).toBeInTheDocument();
    expect(row.querySelector("[data-kind]")).not.toBeNull(); // the ticket's status icon
    await user.click(within(row).getByRole("button", { name: "Billing revamp" }));
    const other = await screen.findByRole("region", { name: "Project Billing revamp" });
    const back = within(within(other).getByRole("region", { name: "Relationships" })).getByRole("table", { name: "Blocks" });
    expect(within(back).getByRole("row", { name: /ABC-13/ })).toBeInTheDocument();
  });

  it("each relationship row says which of the project's own tickets it affects", async () => {
    const { user } = await openFirstProject();
    const rel = await screen.findByRole("region", { name: "Relationships" });
    const row = within(within(rel).getByRole("table", { name: "Blocked by" })).getByRole("row", { name: /ABC-14/ });
    const ours = within(row).getByRole("button", { name: /ABC-13/ });
    expect(ours).toHaveAttribute("title", "Migrate invoices endpoint");
    await user.click(ours);
    expect(await screen.findByRole("region", { name: "Issue detail" })).toBeInTheDocument();
  });

  it("shows the linked ticket's assignee and tickets without a project", async () => {
    seedProjects();
    server.put(mkIssue("ABC-60", { summary: "Loose blocker", status: "In Development", statusCategory: "indeterminate", assignee: bob, links: [{ id: "x", type: "Blocks", direction: "outward", phrase: "blocks", key: "ABC-13", summary: "Migrate invoices endpoint" }] }));
    server.put(mkIssue("ABC-13", { summary: "Migrate invoices endpoint", parentKey: "ABC-10", parentSummary: "Platform migration", status: "In Development", statusCategory: "indeterminate", assignee: bob, links: [
      { id: "i1", type: "Blocks", direction: "inward", phrase: "is blocked by", key: "ABC-14", summary: "Design invoice schema" },
      { id: "i2", type: "Blocks", direction: "inward", phrase: "is blocked by", key: "ABC-60", summary: "Loose blocker" },
    ] }));
    const { user } = await renderApp();
    await user.keyboard("gpj{Enter}");
    const rel = await screen.findByRole("region", { name: "Relationships" });
    const row = within(within(rel).getByRole("table", { name: "Blocked by" })).getByRole("row", { name: /ABC-60/ });
    expect(within(row).getByText("Bea")).toBeInTheDocument();
    expect(within(row).getByText("No project")).toBeInTheDocument();
  });

  it("clicking a ticket's project chip opens that project", async () => {
    seedProjects();
    const { user } = await renderApp();
    await user.click(within(screen.getByRole("option", { name: /^ABC-13/ })).getByRole("button", { name: "Platform migration" }));
    expect(await screen.findByRole("region", { name: "Project Platform migration" })).toBeInTheDocument();
  });

  it("the sidebar lists active projects and opens them", async () => {
    seedProjects();
    const { user } = await renderApp();
    const nav = screen.getByRole("navigation", { name: "Views" });
    await user.click(within(nav).getByRole("button", { name: /Platform migration/ }));
    expect(await screen.findByRole("region", { name: "Project Platform migration" })).toBeInTheDocument();
    expect(within(nav).queryByRole("button", { name: /Billing revamp/ })).not.toBeInTheDocument(); // planned, not active
  });

  it("the palette finds projects and opens them", async () => {
    seedProjects();
    const { user } = await renderApp();
    await user.keyboard("{Meta>}k{/Meta}");
    await screen.findByRole("dialog", { name: "Command palette" });
    await user.keyboard("billing{Enter}");
    expect(await screen.findByRole("region", { name: "Project Billing revamp" })).toBeInTheDocument();
  });

  it("Projects breadcrumb returns to the project list", async () => {
    seedProjects();
    const { user } = await renderApp();
    await user.keyboard("gpj{Enter}");
    await screen.findByRole("region", { name: "Project Platform migration" });
    await user.click(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("button", { name: "Projects" }));
    expect(await screen.findByRole("listbox", { name: "Projects" })).toBeInTheDocument();
  });
});

describe("project actions", () => {
  it("in the project list, s sets the project's status", async () => {
    seedProjects();
    const { user } = await renderApp();
    await user.keyboard("gpjs");
    const dlg = await screen.findByRole("dialog", { name: "Set status" });
    // projects use their own workflow: only statuses that epics use are offered
    expect(within(dlg).queryByText("Code Review")).not.toBeInTheDocument();
    await user.keyboard("backlog{Enter}");
    await waitFor(() => expect(server.rows.get("ABC-10")!.status).toBe("Backlog"));
  });

  it("in the project list, a sets the lead and d sets the target date", async () => {
    seedProjects();
    const { user } = await renderApp();
    await user.keyboard("gpja");
    await screen.findByRole("dialog", { name: "Set assignee" });
    await user.keyboard("bea{Enter}");
    await waitFor(() => expect(server.rows.get("ABC-10")!.assignee?.id).toBe("u3"));
    await user.keyboard("{Shift>}d{/Shift}");
    const dlg = await screen.findByRole("dialog", { name: "Set due date" });
    await user.clear(within(dlg).getByLabelText("Due date"));
    await user.type(within(dlg).getByLabelText("Due date"), "2026-12-31{Enter}");
    await waitFor(() => expect(server.rows.get("ABC-10")!.duedate).toBe("2026-12-31"));
  });

  it("project detail rows act on the project, not on a selected ticket", async () => {
    seedProjects();
    const { user } = await renderApp();
    await user.keyboard("gpj{Enter}");
    await screen.findByRole("region", { name: "Project Platform migration" });
    await user.keyboard("j"); // select a ticket inside the project
    await user.click(within(screen.getByRole("complementary", { name: "Project details" })).getByRole("button", { name: /^Status:/ }));
    await screen.findByRole("dialog", { name: "Set status" });
    await user.keyboard("backlog{Enter}");
    await waitFor(() => expect(server.rows.get("ABC-10")!.status).toBe("Backlog"));
    expect(server.received.map((r) => r.op)).toEqual(["setStatus"]);
  });

  it("r renames the selected project or ticket", async () => {
    seedProjects();
    const { user } = await renderApp();
    await user.keyboard("gpjr");
    const dlg = await screen.findByRole("dialog", { name: "Rename" });
    const input = within(dlg).getByLabelText("Name");
    expect(input).toHaveValue("Platform migration");
    await user.clear(input);
    await user.type(input, "Platform v2{Enter}");
    await waitFor(() => expect(server.rows.get("ABC-10")!.summary).toBe("Platform v2"));
  });

  it("rename keeps the [PERMANENT] prefix for ongoing projects", async () => {
    seedProjects();
    const { user } = await renderApp();
    await user.keyboard("gpjjjjr");
    const dlg = await screen.findByRole("dialog", { name: "Rename" });
    await user.clear(within(dlg).getByLabelText("Name"));
    await user.type(within(dlg).getByLabelText("Name"), "Tech debt{Enter}");
    await waitFor(() => expect(server.rows.get("ABC-15")!.summary).toBe("[PERMANENT] Tech debt"));
  });

  it("New project creates an Epic and shows it in the list immediately", async () => {
    seedProjects();
    const { user } = await renderApp();
    await user.keyboard("gp");
    await user.click(await screen.findByRole("button", { name: "New project" }));
    const dlg = await screen.findByRole("dialog", { name: "Create project" });
    expect(within(dlg).getByLabelText("Name")).toHaveFocus();
    expect(within(dlg).getByRole("button", { name: "Create project" })).toBeDisabled();
    await user.type(within(dlg).getByLabelText("Name"), "Reporting overhaul");
    await user.type(within(dlg).getByLabelText("Description"), "Rebuild reporting");
    await user.type(within(dlg).getByLabelText("Target date"), "2027-01-31");
    await user.click(within(dlg).getByRole("button", { name: "Create project" }));
    expect(await screen.findByRole("option", { name: /^Reporting overhaul/ })).toBeInTheDocument();
    await waitFor(() => expect([...server.rows.values()].some((r) => r.summary === "Reporting overhaul" && r.issuetype === "Epic")).toBe(true));
  });

  it("creating a ticket from a project page pre-selects that project", async () => {
    seedProjects();
    const { user } = await renderApp();
    await user.keyboard("gpj{Enter}");
    await screen.findByRole("region", { name: "Project Platform migration" });
    await user.keyboard("c");
    const dlg = await screen.findByRole("dialog", { name: "Create issue" });
    expect(within(dlg).getByRole("button", { name: "Project: Platform migration" })).toBeInTheDocument();
  });
});

describe("blocked and blocking badges", () => {
  it("a ticket blocked by an open ticket shows a blocked badge on its status icon", async () => {
    seedProjects();
    await renderApp();
    const row = screen.getByRole("option", { name: /^ABC-13/ });
    expect(row).toHaveAccessibleName(/blocked/i);
    expect(row.querySelector('[data-block="blocked"]')).not.toBeNull();
  });

  it("the ticket doing the blocking shows a blocking badge", async () => {
    seedProjects();
    await renderApp();
    const row = screen.getByRole("option", { name: /^ABC-14/ });
    expect(row).toHaveAccessibleName(/blocking/i);
    expect(row.querySelector('[data-block="blocking"]')).not.toBeNull();
  });

  it("tickets without open blocking relations have no badge", async () => {
    seedProjects();
    await renderApp();
    expect(screen.getByRole("option", { name: /^ABC-1 / }).querySelector("[data-block]")).toBeNull();
  });

  it("the badge disappears once the blocker is done", async () => {
    seedProjects();
    const { user } = await renderApp();
    await user.click(screen.getByRole("option", { name: /^ABC-14/ }));
    await user.keyboard("s");
    await screen.findByRole("dialog", { name: "Set status" });
    await user.keyboard("cerrada{Enter}");
    await waitFor(() => expect(screen.getByRole("option", { name: /^ABC-13/ }).querySelector("[data-block]")).toBeNull());
  });

  it("the detail panel repeats the badge next to the status and lists the blocker", async () => {
    seedProjects();
    const { user } = await renderApp();
    await user.click(screen.getByRole("option", { name: /^ABC-13/ }));
    await user.keyboard("{Enter}");
    const detail = await screen.findByRole("region", { name: "Issue detail" });
    expect(detail.querySelector('[data-block="blocked"]')).not.toBeNull();
    expect(within(detail).getByText("ABC-14")).toBeInTheDocument();
  });
});


// ------------------------------------------------- selection, bulk edit, undo
const checkedKeys = () => screen.queryAllByRole("checkbox", { checked: true }).map((c) => c.getAttribute("aria-label")?.replace("Select ", ""));
const bulkBar = () => screen.queryByRole("toolbar", { name: "Bulk actions" });
function seedThird() {
  server.put(mkIssue("ABC-6", { summary: "Third active one", status: "In Development", statusCategory: "indeterminate", updated: "2026-10-10T10:00:00.000+0000" }));
}

describe("arrow keys", () => {
  it("↓ and ↑ move the highlight like J and K, and ⌘↓ jumps to the last row", async () => {
    seedThird();
    const { user } = await renderApp();
    await user.keyboard("{ArrowDown}");
    expect(selectedKeys()).toEqual(["ABC-1"]);
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(selectedKeys()).toEqual(["ABC-2"]);
    await user.keyboard("{ArrowUp}");
    expect(selectedKeys()).toEqual(["ABC-6"]);
    await user.keyboard("{Meta>}{ArrowUp}{/Meta}");
    expect(selectedKeys()).toEqual(["ABC-1"]);
    await user.keyboard("{Meta>}{ArrowDown}{/Meta}");
    expect(selectedKeys()).toEqual(["ABC-2"]);
  });
});

describe("selection and bulk edit", () => {
  it("x ticks the highlighted row and the bulk bar appears", async () => {
    const { user } = await renderApp();
    expect(bulkBar()).toBeNull();
    await user.keyboard("jx");
    expect(checkedKeys()).toEqual(["ABC-1"]);
    expect(within(bulkBar()!).getByText("1 selected")).toBeInTheDocument();
    await user.keyboard("x");
    expect(checkedKeys()).toEqual([]);
    expect(bulkBar()).toBeNull();
  });

  it("clicking a row's checkbox toggles it without opening anything", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole("checkbox", { name: "Select ABC-2" }));
    expect(checkedKeys()).toEqual(["ABC-2"]);
    expect(screen.queryByRole("region", { name: "Issue detail" })).not.toBeInTheDocument();
  });

  it("the whole left gutter is the checkbox: clicking where the priority icon sits ticks the row instead of just highlighting it", async () => {
    const { user } = await renderApp();
    await user.click(rowOf("ABC-2").querySelector("[data-priority]")!);
    expect(checkedKeys()).toEqual(["ABC-2"]);
    expect(screen.queryByRole("region", { name: "Issue detail" })).toBeNull();
    await user.click(rowOf("ABC-2").querySelector("[data-priority]")!);
    expect(checkedKeys()).toEqual([]);
  });

  it("clicking the gutter ticks exactly once (no double toggle with the row click)", async () => {
    const { user } = await renderApp();
    await user.click(rowOf("ABC-1"));
    await user.click(rowOf("ABC-2").querySelector("[data-priority]")!);
    expect(checkedKeys()).toEqual(["ABC-2"]);
    expect(within(bulkBar()!).getByText("1 selected")).toBeInTheDocument();
  });

  it("Shift+↓ extends the selection one row at a time", async () => {
    seedThird();
    const { user } = await renderApp();
    await user.keyboard("j{Shift>}{ArrowDown}{ArrowDown}{/Shift}");
    expect(checkedKeys()).toEqual(["ABC-1", "ABC-6", "ABC-2"]);
    await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
    expect(checkedKeys()).toEqual(["ABC-1", "ABC-6"]);
  });

  it("Shift+click selects the range between the highlighted row and the clicked one", async () => {
    seedThird();
    const { user } = await renderApp();
    await user.click(rowOf("ABC-1"));
    await user.keyboard("{Shift>}");
    await user.click(rowOf("ABC-2"));
    await user.keyboard("{/Shift}");
    expect(checkedKeys()).toEqual(["ABC-1", "ABC-6", "ABC-2"]);
  });

  it("⌘A selects everything shown and Escape clears it", async () => {
    seedThird();
    const { user } = await renderApp();
    await user.keyboard("{Meta>}a{/Meta}");
    expect(checkedKeys()).toHaveLength(3);
    expect(within(bulkBar()!).getByText("3 selected")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(checkedKeys()).toEqual([]);
  });

  it("Escape clears the selection before it leaves the issue page", async () => {
    const { user, ui } = await renderApp();
    await user.keyboard("j{Enter}x");
    await screen.findByRole("region", { name: "Issue detail" });
    expect(ui.getState().selection).toEqual(["ABC-1"]);
    await user.keyboard("{Escape}");
    expect(ui.getState().selection).toEqual([]);
    expect(screen.getByRole("region", { name: "Issue detail" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Issue detail" })).not.toBeInTheDocument();
  });

  it("a property key applies to every ticked row as a single step", async () => {
    const { user } = await renderApp();
    await user.keyboard("jxjx");
    expect(within(bulkBar()!).getByText("2 selected")).toBeInTheDocument();
    await user.keyboard("s");
    const dialog = await screen.findByRole("dialog", { name: "Set status" });
    expect(within(dialog).getByRole("heading", { name: "2 issues" })).toBeInTheDocument();
    await user.keyboard("code review{Enter}");
    await waitFor(() => expect([server.rows.get("ABC-1")!.status, server.rows.get("ABC-2")!.status]).toEqual(["Code Review", "Code Review"]));
    expect(server.received.map((r) => r.op)).toEqual(["setStatus", "setStatus"]);
    expect(await screen.findByText("2 issues updated")).toBeInTheDocument();
  });

  it("the bulk bar buttons open the same pickers for the selection", async () => {
    const { user } = await renderApp();
    await user.keyboard("jxjx");
    await user.click(within(bulkBar()!).getByRole("button", { name: "Priority" }));
    await screen.findByRole("dialog", { name: "Set priority" });
    await user.keyboard("high{Enter}");
    await waitFor(() => expect([server.rows.get("ABC-1")!.priority, server.rows.get("ABC-2")!.priority]).toEqual(["High", "High"]));
    await user.click(within(bulkBar()!).getByRole("button", { name: "Clear selection" }));
    expect(bulkBar()).toBeNull();
  });

  it("labels toggle across a selection: add to all, then remove from all", async () => {
    const { user } = await renderApp();
    await user.keyboard("jxjxl");
    await screen.findByRole("dialog", { name: "Set labels" });
    await user.keyboard("backend{Enter}"); // ABC-2 already has CA:backend, ABC-1 does not -> add to both
    await waitFor(() => expect(server.rows.get("ABC-1")!.labels).toEqual(["CA:backend"]));
    expect(server.rows.get("ABC-2")!.labels).toEqual(["CA:backend"]);
    await user.keyboard("{Enter}"); // now both have it -> remove from both
    await waitFor(() => expect(server.rows.get("ABC-1")!.labels).toEqual([]));
    expect(server.rows.get("ABC-2")!.labels).toEqual([]);
  });

  it("pickers show a check next to the value everything selected already has", async () => {
    const { user } = await renderApp();
    await user.keyboard("js");
    const dialog = await screen.findByRole("dialog", { name: "Set status" });
    const current = within(dialog).getByRole("option", { name: /In Development/ });
    expect(within(current).getByLabelText("Selected")).toBeInTheDocument();
    expect(within(within(dialog).getByRole("option", { name: /Code Review/ })).queryByLabelText("Selected")).toBeNull();
  });
});

describe("context menu", () => {
  it("right-click opens a menu of actions for that row", async () => {
    const { user } = await renderApp();
    await user.pointer({ keys: "[MouseRight]", target: rowOf("ABC-2") });
    const menu = await screen.findByRole("menu", { name: "Issue actions" });
    for (const name of ["Status", "Assignee", "Priority", "Labels", "Project", "Due date", "Rename", "Copy link", "Open in Jira"]) {
      expect(within(menu).getByRole("menuitem", { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }
    expect(selectedKeys()).toEqual(["ABC-2"]);
    await user.click(within(menu).getByRole("menuitem", { name: /^Status/ }));
    await screen.findByRole("dialog", { name: "Set status" });
    await user.keyboard("code review{Enter}");
    await waitFor(() => expect(server.rows.get("ABC-2")!.status).toBe("Code Review"));
  });

  it("right-clicking a ticked row acts on the whole selection", async () => {
    const { user } = await renderApp();
    await user.keyboard("jxjx");
    await user.pointer({ keys: "[MouseRight]", target: rowOf("ABC-1") });
    const menu = await screen.findByRole("menu", { name: "Issue actions" });
    expect(within(menu).getByText("2 issues")).toBeInTheDocument();
  });

  it("Escape closes the menu, and Copy link copies the Jira URL", async () => {
    const { user, copyText } = await renderApp();
    await user.pointer({ keys: "[MouseRight]", target: rowOf("ABC-1") });
    await screen.findByRole("menu", { name: "Issue actions" });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.pointer({ keys: "[MouseRight]", target: rowOf("ABC-1") });
    await user.click(await screen.findByRole("menuitem", { name: /^Copy link/ }));
    expect(copyText).toHaveBeenCalledWith("https://jira.test/browse/ABC-1");
  });
});

describe("command menu acts on the highlighted row or selection", () => {
  it("shows actions for the highlighted issue first, with their shortcuts", async () => {
    const { user } = await renderApp();
    await user.keyboard("j{Meta>}k{/Meta}");
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    expect(within(dialog).getByText("Actions for ABC-1")).toBeInTheDocument();
    const item = within(dialog).getByRole("option", { name: /Change status/ });
    expect(within(item).getByText("S")).toBeInTheDocument();
    await user.keyboard("change status{Enter}");
    await screen.findByRole("dialog", { name: "Set status" });
  });

  it("with a selection the actions are for all of it", async () => {
    const { user } = await renderApp();
    await user.keyboard("jxjx{Meta>}k{/Meta}");
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    expect(within(dialog).getByText("Actions for 2 issues")).toBeInTheDocument();
    await user.keyboard("assign to me{Enter}");
    await waitFor(() => expect([server.rows.get("ABC-1")!.assignee?.id, server.rows.get("ABC-2")!.assignee?.id]).toEqual(["u1", "u1"]));
  });

  it("without a highlighted row there are no row actions", async () => {
    const { user } = await renderApp();
    await user.keyboard("{Meta>}k{/Meta}");
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    expect(within(dialog).queryByText(/^Actions for/)).not.toBeInTheDocument();
  });
});

describe("undo and toasts", () => {
  it("a change shows a toast with Undo; clicking it reverts the change", async () => {
    const { user } = await renderApp();
    await user.keyboard("js");
    await screen.findByRole("dialog", { name: "Set status" });
    await user.keyboard("code review{Enter}");
    const toast = await screen.findByRole("status", { name: "Status set to Code Review" });
    await waitFor(() => expect(server.rows.get("ABC-1")!.status).toBe("Code Review"));
    await user.click(within(toast).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(server.rows.get("ABC-1")!.status).toBe("In Development"));
    expect(await screen.findByText("Undid: Status set to Code Review")).toBeInTheDocument();
  });

  it("⌘Z undoes the last change from the keyboard", async () => {
    const { user } = await renderApp();
    await user.keyboard("ji");
    await waitFor(() => expect(server.rows.get("ABC-1")!.assignee?.id).toBe("u1"));
    await user.keyboard("jji"); // ABC-2 -> me
    await waitFor(() => expect(server.rows.get("ABC-2")!.assignee?.id).toBe("u1"));
    await user.keyboard("{Meta>}z{/Meta}");
    await waitFor(() => expect(server.rows.get("ABC-2")!.assignee?.id).toBe("u2"));
    expect(server.rows.get("ABC-1")!.assignee?.id).toBe("u1"); // only the last step was undone
  });

  it("toasts for changes that cannot be undone have no Undo button, and can be dismissed", async () => {
    const { user } = await renderApp();
    await user.keyboard("jm");
    const box = await screen.findByRole("textbox", { name: "Add a comment" });
    await user.type(box, "hello{Meta>}{Enter}{/Meta}");
    const toast = await screen.findByRole("status", { name: "Comment added" });
    expect(within(toast).queryByRole("button", { name: "Undo" })).toBeNull();
    await user.click(within(toast).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status", { name: "Comment added" })).not.toBeInTheDocument();
  });
});


// ------------------------------------------------------------ type label group
describe("Type label group (Bug / Spike / Task)", () => {
  const typeDialog = () => screen.getByRole("dialog", { name: "Set labels" });
  const typeItem = (name: string) => within(within(typeDialog()).getByRole("group", { name: "Type" })).getByRole("option", { name: new RegExp(`^${name}`) });

  it("the labels picker has a Type group with exactly Bug, Spike and Task, the current one checked", async () => {
    const { user } = await renderApp();
    await user.keyboard("jl");
    await screen.findByRole("dialog", { name: "Set labels" });
    const group = within(typeDialog()).getByRole("group", { name: "Type" });
    expect(within(group).getAllByRole("option").map((o) => o.textContent?.replace("Selected", ""))).toEqual(["Bug", "Spike", "Task"]);
    expect(within(typeItem("Task")).getByLabelText("Selected")).toBeInTheDocument();
    expect(within(typeItem("Bug")).queryByLabelText("Selected")).toBeNull();
  });

  it("choosing one switches the Jira issue type and moves the check (one at a time)", async () => {
    const { user } = await renderApp();
    await user.keyboard("jl");
    await screen.findByRole("dialog", { name: "Set labels" });
    await user.click(typeItem("Bug"));
    await waitFor(() => expect(server.rows.get("ABC-1")!.issuetype).toBe("Bug"));
    await waitFor(() => expect(within(typeItem("Bug")).getByLabelText("Selected")).toBeInTheDocument());
    expect(within(typeItem("Task")).queryByLabelText("Selected")).toBeNull();
    await user.click(typeItem("Spike"));
    await waitFor(() => expect(server.rows.get("ABC-1")!.issuetype).toBe("Spike"));
    expect(within(typeItem("Bug")).queryByLabelText("Selected")).toBeNull();
    expect(server.received.map((r) => r.op)).toEqual(["setType", "setType"]);
  });

  it("typing finds a type, and choosing the one already set changes nothing", async () => {
    const { user } = await renderApp();
    await user.keyboard("jl");
    await screen.findByRole("dialog", { name: "Set labels" });
    await user.keyboard("spike{Enter}");
    await waitFor(() => expect(server.rows.get("ABC-1")!.issuetype).toBe("Spike"));
    await user.keyboard("{Enter}"); // Spike is already selected
    expect(server.received.filter((r) => r.op === "setType")).toHaveLength(1);
  });

  it("uses the Jira name this workspace uses for each group (for example Error for bugs)", async () => {
    server.put(mkIssue("ABC-8", { summary: "Broken", issuetype: "Error", updated: "2026-09-02T00:00:00.000+0000" }));
    server.put(mkIssue("ABC-9", { summary: "Broken too", issuetype: "Error", updated: "2026-09-02T00:00:00.000+0000" }));
    const { user } = await renderApp();
    await user.keyboard("jl");
    await screen.findByRole("dialog", { name: "Set labels" });
    await user.click(typeItem("Bug"));
    await waitFor(() => expect(server.rows.get("ABC-1")!.issuetype).toBe("Error"));
  });

  it("applies to a whole selection", async () => {
    const { user } = await renderApp();
    await user.keyboard("jxjxl");
    await screen.findByRole("dialog", { name: "Set labels" });
    await user.click(typeItem("Spike"));
    await waitFor(() => expect([server.rows.get("ABC-1")!.issuetype, server.rows.get("ABC-2")!.issuetype]).toEqual(["Spike", "Spike"]));
  });

  it("rows show a chip for Bug and Spike but not for plain tasks", async () => {
    server.put(mkIssue("ABC-6", { summary: "A bug here", issuetype: "Bug", status: "In Development", statusCategory: "indeterminate", updated: "2026-10-09T00:00:00.000+0000" }));
    server.put(mkIssue("ABC-7", { summary: "A spike here", issuetype: "Spike", status: "In Development", statusCategory: "indeterminate", updated: "2026-10-08T00:00:00.000+0000" }));
    await renderApp();
    expect(within(rowOf("ABC-6")).getByText("Bug")).toBeInTheDocument();
    expect(within(rowOf("ABC-7")).getByText("Spike")).toBeInTheDocument();
    expect(within(rowOf("ABC-1")).queryByText("Task")).toBeNull();
  });

  it("any other Jira type counts as a Task, including Spanish names", async () => {
    server.put(mkIssue("ABC-6", { summary: "Una historia", issuetype: "Historia", status: "In Development", statusCategory: "indeterminate" }));
    const { user } = await renderApp();
    await user.click(rowOf("ABC-6"));
    await user.keyboard("l");
    await screen.findByRole("dialog", { name: "Set labels" });
    expect(within(typeItem("Task")).getByLabelText("Selected")).toBeInTheDocument();
  });

  it("the detail panel shows the type and opens the picker", async () => {
    server.put(mkIssue("ABC-6", { summary: "A bug here", issuetype: "Bug", status: "In Development", statusCategory: "indeterminate" }));
    const { user } = await renderApp();
    await user.click(rowOf("ABC-6"));
    await user.keyboard("{Enter}");
    const detail = await screen.findByRole("region", { name: "Issue detail" });
    await user.click(within(detail).getByRole("button", { name: /Type: Bug/ }));
    await screen.findByRole("dialog", { name: "Set labels" });
  });

  it("changing the type can be undone", async () => {
    const { user } = await renderApp();
    await user.keyboard("jl");
    await screen.findByRole("dialog", { name: "Set labels" });
    await user.click(typeItem("Spike"));
    await waitFor(() => expect(server.rows.get("ABC-1")!.issuetype).toBe("Spike"));
    await user.keyboard("{Escape}");
    await user.keyboard("{Meta>}z{/Meta}");
    await waitFor(() => expect(server.rows.get("ABC-1")!.issuetype).toBe("Task"));
  });
});


// ------------------------------------------------------- sidebar and appearance
describe("sidebar", () => {
  it("groups navigation into My issues, Workspace, the team and active projects", async () => {
    seedProjects();
    await renderApp();
    const nav = screen.getByRole("navigation", { name: "Views" });
    expect(within(nav).getByRole("button", { name: /^My issues/ })).toBeInTheDocument();
    const team = within(nav).getByRole("group", { name: "ABC" });
    for (const n of ["Active", "Backlog", "All issues"]) expect(within(team).getByRole("button", { name: new RegExp(`^${n}`) })).toBeInTheDocument();
    expect(within(within(nav).getByRole("group", { name: "Workspace" })).getByRole("button", { name: /^Projects/ })).toBeInTheDocument();
    expect(within(within(nav).getByRole("group", { name: "Active projects" })).getByRole("button", { name: /Platform migration/ })).toBeInTheDocument();
  });

  it("the current view is marked and clicking another view switches to it", async () => {
    const { user } = await renderApp();
    const nav = screen.getByRole("navigation", { name: "Views" });
    expect(within(nav).getByRole("button", { name: "Active" })).toHaveAttribute("aria-current", "page");
    await user.click(within(nav).getByRole("button", { name: "All issues" }));
    expect(within(nav).getByRole("button", { name: "All issues" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByText("Old finished thing")).toBeInTheDocument();
  });

  it("a section can be folded away and opened again", async () => {
    const { user } = await renderApp();
    const nav = screen.getByRole("navigation", { name: "Views" });
    const head = within(nav).getByRole("button", { name: "ABC" });
    expect(head).toHaveAttribute("aria-expanded", "true");
    await user.click(head);
    expect(within(nav).queryByRole("button", { name: /^Backlog/ })).not.toBeInTheDocument();
    await user.click(head);
    expect(within(nav).getByRole("button", { name: /^Backlog/ })).toBeInTheDocument();
  });

  it("⌘. collapses the sidebar and brings it back, and the choice is remembered", async () => {
    const { user, settings } = await renderApp();
    expect(screen.getByRole("navigation", { name: "Views" })).toBeVisible();
    await user.keyboard("{Meta>}.{/Meta}");
    expect(screen.queryByRole("navigation", { name: "Views" })).not.toBeInTheDocument();
    expect(settings.getState().sidebarCollapsed).toBe(true);
    await user.click(screen.getByRole("button", { name: "Show sidebar" }));
    expect(screen.getByRole("navigation", { name: "Views" })).toBeVisible();
    expect(settings.getState().sidebarCollapsed).toBe(false);
  });

  it("projects can be favourited from their page and appear under Favorites", async () => {
    seedProjects();
    const { user } = await renderApp();
    await user.keyboard("gpj{Enter}");
    const page = await screen.findByRole("region", { name: "Project Platform migration" });
    const star = within(page).getByRole("button", { name: "Add to favorites" });
    expect(star).toHaveAttribute("aria-pressed", "false");
    await user.click(star);
    const nav = screen.getByRole("navigation", { name: "Views" });
    const fav = within(nav).getByRole("group", { name: "Favorites" });
    expect(within(fav).getByRole("button", { name: /Platform migration/ })).toBeInTheDocument();
    expect(within(page).getByRole("button", { name: "Remove from favorites" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(page).getByRole("button", { name: "Remove from favorites" }));
    expect(within(nav).queryByRole("group", { name: "Favorites" })).not.toBeInTheDocument();
  });
});

describe("appearance", () => {
  const html = () => document.documentElement;
  it("starts from the saved settings on the page root", async () => {
    await renderApp();
    expect(html().getAttribute("data-theme")).toBe("system");
    expect(html().getAttribute("data-contrast")).toBe("normal");
    expect(html().getAttribute("data-density")).toBe("comfortable");
  });

  it("the command menu switches theme, contrast and density", async () => {
    const { user, settings } = await renderApp();
    const run = async (text: string) => {
      await user.keyboard("{Meta>}k{/Meta}");
      await screen.findByRole("dialog", { name: "Command palette" });
      await user.keyboard(`${text}{Enter}`);
    };
    await run("theme: dark");
    expect(html().getAttribute("data-theme")).toBe("dark");
    await run("theme: light");
    expect(html().getAttribute("data-theme")).toBe("light");
    await run("contrast: high");
    expect(html().getAttribute("data-contrast")).toBe("high");
    await run("density: compact");
    expect(html().getAttribute("data-density")).toBe("compact");
    expect(settings.getState()).toMatchObject({ theme: "light", contrast: "high", density: "compact" });
  });

  it("the command menu can toggle the sidebar too", async () => {
    const { user } = await renderApp();
    await user.keyboard("{Meta>}k{/Meta}");
    await screen.findByRole("dialog", { name: "Command palette" });
    await user.keyboard("toggle sidebar{Enter}");
    expect(screen.queryByRole("navigation", { name: "Views" })).not.toBeInTheDocument();
  });
});


// ---------------------------------------------------------------- row details
describe("row details", () => {
  it("priority icons use Linear's five levels", async () => {
    server.put(mkIssue("ABC-6", { summary: "Urgent one", priority: "Crítica", status: "In Development", statusCategory: "indeterminate" }));
    server.put(mkIssue("ABC-7", { summary: "No priority", priority: null, status: "In Development", statusCategory: "indeterminate" }));
    await renderApp();
    expect(rowOf("ABC-6").querySelector('[data-priority="urgent"]')).not.toBeNull();
    expect(rowOf("ABC-7").querySelector('[data-priority="none"]')).not.toBeNull();
    expect(rowOf("ABC-1").querySelector('[data-priority="high"]')).not.toBeNull();
    expect(rowOf("ABC-2").querySelector('[data-priority="medium"]')).not.toBeNull();
  });

  it("a started status icon is filled according to its place in the workflow", async () => {
    server.put(mkIssue("ABC-6", { summary: "In review", status: "Code Review", statusCategory: "indeterminate" }));
    await renderApp();
    const fill = (k: string) => Number(rowOf(k).querySelector("[data-fill]")?.getAttribute("data-fill"));
    expect(fill("ABC-1")).toBeCloseTo(1 / 3, 2); // In Development: first of two started statuses
    expect(fill("ABC-6")).toBeCloseTo(2 / 3, 2); // Code Review: second
  });

  it("each started status has its own colour, and groups run from closest to done to farthest", async () => {
    server.put(mkIssue("ABC-6", { summary: "In review", status: "Code Review", statusCategory: "indeterminate" }));
    server.put(mkIssue("ABC-7", { summary: "In test", status: "In Testing (QA)", statusCategory: "indeterminate" }));
    await renderApp();
    const hue = (k: string) => rowOf(k).querySelector("[data-hue]")?.getAttribute("data-hue");
    expect(new Set([hue("ABC-1"), hue("ABC-6"), hue("ABC-7")]).size).toBe(3);
    const heads = screen.getAllByRole("button", { name: /^(In Development|Code Review|In Testing \(QA\)|Ready for Dev)/ }).map((b) => b.textContent);
    expect(heads.map((t) => t?.replace(/\d+$/, ""))).toEqual(["In Testing (QA)", "Code Review", "In Development", "Ready for Dev"]);
  });

  it("a ticket with sub-issues shows how many are done", async () => {
    server.put(mkIssue("ABC-6", { summary: "Parent ticket", status: "In Development", statusCategory: "indeterminate" }));
    server.put(mkIssue("ABC-7", { summary: "Sub one", issuetype: "Subtarea", parentKey: "ABC-6", status: "Cerrada", statusCategory: "done" }));
    server.put(mkIssue("ABC-8", { summary: "Sub two", issuetype: "Subtarea", parentKey: "ABC-6", status: "In Development", statusCategory: "indeterminate" }));
    await renderApp();
    const badge = within(rowOf("ABC-6")).getByTitle("1 of 2 sub-issues done");
    expect(badge).toHaveTextContent("1/2");
  });

  it("shows the due date, and marks overdue work", async () => {
    server.put(mkIssue("ABC-6", { summary: "Late", duedate: "2020-01-05", status: "In Development", statusCategory: "indeterminate" }));
    server.put(mkIssue("ABC-7", { summary: "Plenty of time", duedate: "2099-03-09", status: "In Development", statusCategory: "indeterminate" }));
    await renderApp();
    const late = within(rowOf("ABC-6")).getByText("Jan 5, 2020");
    expect(late).toHaveAttribute("data-overdue", "true");
    expect(within(rowOf("ABC-7")).getByText("Mar 9, 2099")).toHaveAttribute("data-overdue", "false");
  });

  it("labels carry a colour dot", async () => {
    await renderApp();
    const chip = within(rowOf("ABC-2")).getByText("CA:backend");
    expect(chip.closest(".chip")!.querySelector(".dot")).not.toBeNull();
  });
});

describe("collapsible groups", () => {
  it("clicking a group header folds its rows away and clicking again brings them back", async () => {
    const { user } = await renderApp();
    const head = screen.getByRole("button", { name: /^In Development/ });
    expect(head).toHaveAttribute("aria-expanded", "true");
    await user.click(head);
    expect(head).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Fix revenue chart")).not.toBeInTheDocument();
    await user.click(head);
    expect(screen.getByText("Fix revenue chart")).toBeInTheDocument();
  });

  it("J and K skip over rows in a folded group", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole("button", { name: /^In Development/ }));
    await user.keyboard("j");
    expect(selectedKeys()).toEqual(["ABC-2"]);
  });

  it("the group count stays visible while it is folded", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole("button", { name: /^In Development/ }));
    expect(screen.getByRole("button", { name: /^In Development/ })).toHaveTextContent("1");
  });
});

// ------------------------------------------------------- project details sidebar
describe("project details sidebar", () => {
  const side = () => screen.getByRole("complementary", { name: "Project details" });
  const page = () => screen.getByRole("region", { name: "Project Platform migration" });
  async function openProject() {
    seedProjects();
    const r = await renderApp();
    await r.user.keyboard("gpj{Enter}");
    await screen.findByRole("region", { name: "Project Platform migration" });
    return r;
  }

  it("is open by default and lists the project's properties", async () => {
    await openProject();
    const s = side();
    expect(within(s).getByRole("heading", { name: "Properties" })).toBeInTheDocument();
    expect(within(s).getByRole("button", { name: "Status: In Development" })).toBeInTheDocument();
    expect(within(s).getByRole("button", { name: "Priority: Medium" })).toBeInTheDocument();
    expect(within(s).getByRole("button", { name: "Lead: Ana" })).toBeInTheDocument();
    expect(within(s).getByRole("button", { name: /^Target date: Jun 1/ })).toBeInTheDocument();
    expect(within(s).getByText("ABC")).toBeInTheDocument(); // the team
  });

  it("does not repeat those details in the page header while the sidebar is open", async () => {
    await openProject();
    expect(within(page()).queryByRole("button", { name: /^Status:/ })).toBeNull();
    expect(within(page()).queryByRole("button", { name: /^Lead:/ })).toBeNull();
    expect(within(page()).queryByRole("button", { name: /^Target date:/ })).toBeNull();
    expect(within(page()).queryByText(/tickets done/)).toBeNull();
    // the sidebar is the only place they appear
    expect(within(side()).getAllByRole("button", { name: /^Status:/ })).toHaveLength(1);
  });

  it("gives the whole width to the page when the sidebar is hidden", async () => {
    const { user } = await openProject();
    const layout = () => document.querySelector(".project-layout")!;
    expect(layout()).not.toHaveClass("no-side");
    await user.keyboard("{Meta>}i{/Meta}");
    expect(layout()).toHaveClass("no-side");
    await user.keyboard("{Meta>}i{/Meta}");
    expect(layout()).not.toHaveClass("no-side");
  });

  it("brings them back into the header when the sidebar is hidden", async () => {
    const { user } = await openProject();
    await user.keyboard("{Meta>}i{/Meta}");
    expect(within(page()).getByRole("button", { name: "Status: In Development" })).toBeInTheDocument();
    expect(within(page()).getByRole("button", { name: "Lead: Ana" })).toBeInTheDocument();
    expect(within(page()).getByRole("button", { name: /^Target date: Jun 1/ })).toBeInTheDocument();
    expect(within(page()).getByText("1 of 2 tickets done")).toBeInTheDocument();
    await user.click(within(page()).getByRole("button", { name: "Status: In Development" }));
    await screen.findByRole("dialog", { name: "Set status" });
  });

  it("lists the people working on the project as members", async () => {
    await openProject();
    const members = within(side()).getByRole("list", { name: "Members" });
    expect(within(members).getByText("Ana")).toBeInTheDocument(); // the lead
    expect(within(members).getByText("Bea")).toBeInTheDocument(); // assigned to a ticket in the project
  });

  it("⌘I hides and shows it, and the choice is remembered", async () => {
    const { user, settings } = await openProject();
    await user.keyboard("{Meta>}i{/Meta}");
    expect(screen.queryByRole("complementary", { name: "Project details" })).not.toBeInTheDocument();
    expect(settings.getState().projectSidebarOpen).toBe(false);
    await user.click(screen.getByRole("button", { name: "Show project details" }));
    expect(side()).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hide project details" }));
    expect(screen.queryByRole("complementary", { name: "Project details" })).not.toBeInTheDocument();
  });

  it("the property rows edit the project, not whichever ticket is highlighted", async () => {
    const { user } = await openProject();
    await user.keyboard("j"); // highlight a ticket inside the project
    await user.click(within(side()).getByRole("button", { name: "Priority: Medium" }));
    await screen.findByRole("dialog", { name: "Set priority" });
    await user.keyboard("high{Enter}");
    await waitFor(() => expect(server.rows.get("ABC-10")!.priority).toBe("High"));
    expect(server.received.map((r) => r.op)).toEqual(["setPriority"]);
    await user.click(within(side()).getByRole("button", { name: /^Target date:/ }));
    await screen.findByRole("dialog", { name: "Set due date" });
  });

  it("shows scope, started and completed counts with percentages", async () => {
    await openProject();
    const progress = within(side()).getByRole("region", { name: "Progress" });
    const stats = progress.querySelector(".stats") as HTMLElement;
    const row = (label: string) => within(stats).getByText(label).closest("div")!;
    expect(row("Scope")).toHaveTextContent("6"); // two tickets, unestimated, 3 points each
    expect(row("Started")).toHaveTextContent("3");
    expect(row("Started")).toHaveTextContent("50%");
    expect(row("Completed")).toHaveTextContent("3");
    expect(row("Completed")).toHaveTextContent("50%");
  });

  it("draws the progress graph once the history has loaded", async () => {
    await openProject();
    const graph = await within(side()).findByRole("img", { name: /^Progress graph/ });
    expect(graph.querySelector('[data-line="scope"]')).not.toBeNull();
    expect(graph.querySelector('[data-line="started"]')).not.toBeNull();
    expect(graph.querySelector('[data-line="completed"]')).not.toBeNull();
    expect(graph).toHaveAccessibleName("Progress graph: 1 of 2 tickets completed");
  });

  it("marks the target date on the graph", async () => {
    seedProjects();
    server.put(mkIssue("ABC-10", { summary: "Platform migration", issuetype: "Epic", status: "In Development", statusCategory: "indeterminate", assignee: ana, duedate: "2026-12-31", updated: "2026-10-14T09:00:00.000+0000" }));
    const { user } = await renderApp();
    await user.keyboard("gpj{Enter}");
    const graph = await within(await screen.findByRole("complementary", { name: "Project details" })).findByRole("img", { name: /^Progress graph/ });
    expect(graph.querySelector('[data-line="target"]')).not.toBeNull();
  });

  it("says so when the history cannot be loaded", async () => {
    server.historyFails = true;
    await openProject();
    expect(await within(side()).findByText("Couldn’t load the progress graph.")).toBeInTheDocument();
  });

  it("breaks completion down by assignee and by label", async () => {
    const { user } = await openProject();
    const progress = within(side()).getByRole("region", { name: "Progress" });
    const people = within(progress).getByRole("list", { name: "Completion by assignee" });
    expect(within(people).getByText("No assignee").closest("li")).toHaveTextContent("100%");
    expect(within(people).getByText("Bea").closest("li")).toHaveTextContent("0%");
    await user.click(within(progress).getByRole("tab", { name: "Labels" }));
    expect(within(progress).getByText("No labels on these tickets.")).toBeInTheDocument();
  });

  it("lists resources (links) and lets you add one", async () => {
    seedProjects();
    server.links.set("ABC-10", [{ id: "l1", url: "https://wiki.example.com/spec", title: "Platform spec" }]);
    const { user } = await renderApp();
    await user.keyboard("gpj{Enter}");
    const resources = within(await screen.findByRole("complementary", { name: "Project details" })).getByRole("region", { name: "Resources" });
    const link = await within(resources).findByRole("link", { name: /Platform spec/ });
    expect(link).toHaveAttribute("href", "https://wiki.example.com/spec");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    await user.click(within(resources).getByRole("button", { name: "Add link" }));
    await user.type(within(resources).getByLabelText("Link URL"), "https://docs.example.com/design");
    await user.type(within(resources).getByLabelText("Link title"), "Design doc{Enter}");
    expect(await within(resources).findByRole("link", { name: /Design doc/ })).toBeInTheDocument();
    expect(server.links.get("ABC-10")).toHaveLength(2);
  });

  it("refuses a resource link that is not a web address", async () => {
    const { user } = await openProject();
    const resources = within(side()).getByRole("region", { name: "Resources" });
    await user.click(within(resources).getByRole("button", { name: "Add link" }));
    await user.type(within(resources).getByLabelText("Link URL"), "javascript:alert(1)");
    await user.type(within(resources).getByLabelText("Link title"), "Nope{Enter}");
    expect(within(resources).getByText("Use a web address that starts with http:// or https://.")).toBeInTheDocument();
    expect(server.links.get("ABC-10")).toBeUndefined();
  });

  it("is not shown on ticket lists or the project list", async () => {
    seedProjects();
    const { user } = await renderApp();
    expect(screen.queryByRole("complementary", { name: "Project details" })).not.toBeInTheDocument();
    await user.keyboard("gp");
    expect(screen.queryByRole("complementary", { name: "Project details" })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------- display options and filters
describe("display options", () => {
  const dlg = () => screen.getByRole("dialog", { name: "Display options" });
  const open = async () => {
    const r = await renderApp();
    await r.user.keyboard("{Shift>}v{/Shift}");
    await screen.findByRole("dialog", { name: "Display options" });
    return r;
  };
  const headers = () => screen.getAllByRole("button", { name: /^(?!Add issue)/, expanded: true }).map((b) => b.textContent?.replace(/\d+$/, ""));
  void headers;

  it("Shift+V or the Display button opens the panel", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole("button", { name: "Display" }));
    expect(await screen.findByRole("dialog", { name: "Display options" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Display options" })).not.toBeInTheDocument();
    await user.keyboard("{Shift>}v{/Shift}");
    expect(await screen.findByRole("dialog", { name: "Display options" })).toBeInTheDocument();
  });

  it("grouping by assignee regroups the list, and is remembered for this view only", async () => {
    const { user, settings } = await open();
    await user.selectOptions(within(dlg()).getByLabelText("Grouping"), "assignee");
    expect(screen.getByRole("group", { name: /^Ana, 1/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /^Raul, 1/ })).toBeInTheDocument();
    expect(settings.getState().resolveDisplay("active").groupBy).toBe("assignee");
    expect(settings.getState().resolveDisplay("backlog").groupBy).toBe("status");
  });

  it("grouping by priority, project and type uses their own groups", async () => {
    server.put(mkIssue("ABC-6", { summary: "A bug", issuetype: "Bug", status: "In Development", statusCategory: "indeterminate", parentKey: "ABC-4" }));
    const { user } = await open();
    await user.selectOptions(within(dlg()).getByLabelText("Grouping"), "type");
    expect(screen.getByRole("group", { name: /^Bug, 1/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /^Task, 2/ })).toBeInTheDocument();
    await user.selectOptions(within(dlg()).getByLabelText("Grouping"), "project");
    expect(screen.getByRole("group", { name: /^Quarterly reporting, 1/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /^No project, 2/ })).toBeInTheDocument();
    await user.selectOptions(within(dlg()).getByLabelText("Grouping"), "priority");
    expect(screen.getByRole("group", { name: /^High, 1/ })).toBeInTheDocument();
  });

  it("ordering and reverse change the order inside a group", async () => {
    server.put(mkIssue("ABC-6", { summary: "Old but urgent", status: "In Development", statusCategory: "indeterminate", priority: "Crítica", updated: "2026-01-01T00:00:00.000+0000" }));
    const { user } = await open();
    const order = () => within(screen.getByRole("group", { name: /^In Development/ })).getAllByRole("option").map((o) => o.getAttribute("data-key"));
    expect(order()).toEqual(["ABC-1", "ABC-6"]); // updated, newest first
    await user.selectOptions(within(dlg()).getByLabelText("Ordering"), "priority");
    expect(order()).toEqual(["ABC-6", "ABC-1"]);
    await user.click(within(dlg()).getByRole("checkbox", { name: "Reverse order" }));
    expect(order()).toEqual(["ABC-1", "ABC-6"]);
  });

  it("sub-issues are hidden until you ask for them", async () => {
    server.put(mkIssue("ABC-6", { summary: "Parent ticket", status: "In Development", statusCategory: "indeterminate" }));
    server.put(mkIssue("ABC-7", { summary: "Child ticket", issuetype: "Subtarea", parentKey: "ABC-6", status: "In Development", statusCategory: "indeterminate" }));
    const { user } = await open();
    expect(screen.queryByText("Child ticket")).not.toBeInTheDocument();
    await user.click(within(dlg()).getByRole("checkbox", { name: "Show sub-issues" }));
    expect(screen.getByText("Child ticket")).toBeInTheDocument();
  });

  it("can show empty groups", async () => {
    const { user } = await open();
    expect(screen.queryByRole("group", { name: /^In Testing \(QA\)/ })).not.toBeInTheDocument();
    await user.click(within(dlg()).getByRole("checkbox", { name: "Show empty groups" }));
    expect(screen.getByRole("group", { name: /^In Testing \(QA\), 0/ })).toBeInTheDocument();
  });

  it("limits completed issues in All issues to a window", async () => {
    const { user } = await renderApp();
    await user.keyboard("gt");
    await screen.findByRole("option", { name: /^ABC-5/ }); // done a while ago, within a month? ABC-5 is recent in this fixture
    await user.keyboard("{Shift>}v{/Shift}");
    await user.selectOptions(within(await screen.findByRole("dialog", { name: "Display options" })).getByLabelText("Completed issues"), "none");
    expect(screen.queryByRole("option", { name: /^ABC-5/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /^ABC-3/ })).not.toBeInTheDocument();
  });

  it("display properties can be hidden from the rows", async () => {
    const { user } = await open();
    expect(within(rowOf("ABC-2")).getByText("CA:backend")).toBeInTheDocument();
    await user.click(within(dlg()).getByRole("button", { name: "Labels", pressed: true }));
    expect(within(rowOf("ABC-2")).queryByText("CA:backend")).not.toBeInTheDocument();
    await user.click(within(dlg()).getByRole("button", { name: "ID", pressed: true }));
    expect(within(rowOf("ABC-2")).queryByText("ABC-2")).not.toBeInTheDocument();
    await user.click(within(dlg()).getByRole("button", { name: "Labels", pressed: false }));
    expect(within(rowOf("ABC-2")).getByText("CA:backend")).toBeInTheDocument();
  });

  it("Reset to default puts everything back", async () => {
    const { user, settings } = await open();
    await user.selectOptions(within(dlg()).getByLabelText("Grouping"), "assignee");
    await user.click(within(dlg()).getByRole("button", { name: "Reset to default" }));
    expect(settings.getState().resolveDisplay("active").groupBy).toBe("status");
    expect(screen.getByRole("group", { name: /^In Development/ })).toBeInTheDocument();
  });

  it("a group's + button starts from what the group means", async () => {
    const { user } = await open();
    await user.selectOptions(within(dlg()).getByLabelText("Grouping"), "assignee");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Add issue to Raul" }));
    const create = await screen.findByRole("dialog", { name: "Create issue" });
    expect(within(create).getByRole("button", { name: "Assignee: Raul" })).toBeInTheDocument();
  });
});

describe("filters", () => {
  const chips = () => screen.queryByRole("toolbar", { name: "Filters" });
  async function filterBy(user: ReturnType<typeof userEvent.setup>, field: string, value: string | RegExp) {
    await user.keyboard("f");
    const menu = await screen.findByRole("dialog", { name: "Filter" });
    await user.click(within(menu).getByRole("option", { name: new RegExp(`^${field}`) }));
    await user.click(await within(menu).findByRole("option", { name: value }));
  }

  it("F opens the filter menu; choosing a property and a value filters the list and adds a chip", async () => {
    const { user } = await renderApp();
    await filterBy(user, "Status", /^In Development/);
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Vendor access for Spotify")).not.toBeInTheDocument();
    expect(screen.getByText("Fix revenue chart")).toBeInTheDocument();
    const chip = within(chips()!).getByRole("group", { name: "Status is In Development" });
    expect(chip).toBeInTheDocument();
  });

  it("shows how many tickets each choice matches", async () => {
    const { user } = await renderApp();
    await user.keyboard("f");
    const menu = await screen.findByRole("dialog", { name: "Filter" });
    await user.click(within(menu).getByRole("option", { name: /^Assignee/ }));
    expect(within(await within(menu).findByRole("option", { name: /^Ana/ })).getByText("1")).toBeInTheDocument();
  });

  it("choosing a second value widens it to 'is either of', and the operator can be flipped to 'is not'", async () => {
    const { user } = await renderApp();
    await filterBy(user, "Status", /^In Development/);
    const menu = screen.getByRole("dialog", { name: "Filter" });
    await user.click(within(menu).getByRole("option", { name: /^Ready for Dev/ }));
    await user.keyboard("{Escape}");
    expect(within(chips()!).getByRole("group", { name: "Status is either of In Development, Ready for Dev" })).toBeInTheDocument();
    await user.click(within(chips()!).getByRole("button", { name: "Change operator" }));
    expect(within(chips()!).getByRole("group", { name: "Status is neither of In Development, Ready for Dev" })).toBeInTheDocument();
    expect(screen.queryByText("Fix revenue chart")).not.toBeInTheDocument();
  });

  it("assignee can be 'No assignee'", async () => {
    server.put(mkIssue("ABC-6", { summary: "Nobody has this", status: "In Development", statusCategory: "indeterminate" }));
    const { user } = await renderApp();
    await filterBy(user, "Assignee", /^No assignee/);
    await user.keyboard("{Escape}");
    expect(screen.getByText("Nobody has this")).toBeInTheDocument();
    expect(screen.queryByText("Fix revenue chart")).not.toBeInTheDocument();
  });

  it("a chip can be removed, and Clear removes them all", async () => {
    const { user } = await renderApp();
    await filterBy(user, "Status", /^In Development/);
    await user.keyboard("{Escape}");
    await user.click(within(chips()!).getByRole("button", { name: "Remove filter" }));
    expect(chips()).toBeNull();
    expect(screen.getByText("Vendor access for Spotify")).toBeInTheDocument();
    await filterBy(user, "Status", /^In Development/);
    await user.keyboard("{Escape}");
    await user.click(within(chips()!).getByRole("button", { name: "Clear all filters" }));
    expect(chips()).toBeNull();
  });

  it("filters belong to the view they were made in", async () => {
    const { user } = await renderApp();
    await filterBy(user, "Status", /^In Development/);
    await user.keyboard("{Escape}");
    await user.keyboard("gb");
    expect(chips()).toBeNull();
    await user.keyboard("ga");
    expect(within(chips()!).getByRole("group", { name: "Status is In Development" })).toBeInTheDocument();
  });

  it("filters combine with search", async () => {
    const { user } = await renderApp();
    await filterBy(user, "Status", /^Ready for Dev/);
    await user.keyboard("{Escape}");
    await user.keyboard("/");
    await user.keyboard("fix");
    expect(screen.queryByRole("option")).not.toBeInTheDocument(); // ABC-1 matches the search but not the filter
  });

  it("says when filters hide everything, and offers to clear them", async () => {
    const { user } = await renderApp();
    await filterBy(user, "Status", /^Code Review/);
    await user.keyboard("{Escape}");
    expect(screen.getByText("No issues match these filters.")).toBeInTheDocument();
    await user.click(within(screen.getByRole("status")).getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Fix revenue chart")).toBeInTheDocument();
  });
});

describe("saved views", () => {
  const sidebar = () => screen.getByRole("navigation", { name: "Views" });
  async function runCommand(user: ReturnType<typeof userEvent.setup>, text: string) {
    await user.keyboard("{Meta>}k{/Meta}");
    await screen.findByRole("dialog", { name: "Command palette" });
    await user.keyboard(`${text}{Enter}`);
  }

  it("saves the current filters and display under a name, listed in the sidebar", async () => {
    const { user, settings } = await renderApp();
    await user.keyboard("f");
    const menu = await screen.findByRole("dialog", { name: "Filter" });
    await user.click(within(menu).getByRole("option", { name: /^Status/ }));
    await user.click(await within(menu).findByRole("option", { name: /^In Development/ }));
    await user.keyboard("{Escape}");
    await runCommand(user, "save view");
    const name = await screen.findByRole("dialog", { name: "Save view" });
    await user.type(within(name).getByLabelText("Name"), "In flight{Enter}");
    const group = within(sidebar()).getByRole("group", { name: "Views" });
    expect(within(group).getByRole("button", { name: "In flight" })).toBeInTheDocument();
    expect(settings.getState().savedViews).toHaveLength(1);
  });

  it("opening a saved view restores its base view, filters and grouping", async () => {
    const { user, settings } = await renderApp();
    settings.getState().saveView("Ana's work", "active", [{ field: "assignee", not: false, values: ["u1"] }], { ...settings.getState().resolveDisplay("active"), groupBy: "priority" });
    await user.keyboard("gb"); // somewhere else first
    await user.click(within(within(sidebar()).getByRole("group", { name: "Views" })).getByRole("button", { name: "Ana's work" }));
    expect(within(sidebar()).getByRole("button", { name: "Ana's work" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Fix revenue chart")).toBeInTheDocument();
    expect(screen.queryByText("Vendor access for Spotify")).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: /^High, 1/ })).toBeInTheDocument();
  });

  it("can be deleted from the command menu", async () => {
    const { user, settings } = await renderApp();
    settings.getState().saveView("Temporary", "active", [], settings.getState().resolveDisplay("active"));
    await runCommand(user, "delete view: temporary");
    expect(settings.getState().savedViews).toEqual([]);
    expect(within(sidebar()).queryByRole("group", { name: "Views" })).not.toBeInTheDocument();
  });
});


// ------------------------------------------------ keys on non-US keyboard layouts
describe("keys that need Shift or AltGr (Spanish and other layouts)", () => {
  it("? opens the shortcuts even though it is typed with Shift held", async () => {
    const { user } = await renderApp();
    await user.keyboard("{Shift>}?{/Shift}");
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
  });

  it("F1 opens the shortcuts on any layout, and Escape closes them", async () => {
    const { user } = await renderApp();
    await user.keyboard("{F1}");
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).not.toBeInTheDocument();
  });

  it("there is always a visible button for the shortcuts", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
  });

  it("the shortcut list mentions every way in", async () => {
    const { user } = await renderApp();
    await user.keyboard("{F1}");
    const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    expect(within(dialog).getAllByText("Keyboard shortcuts").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("F1")).toBeInTheDocument();
  });

  it("/ focuses the search when typed with Shift (Shift+7 on a Spanish keyboard)", async () => {
    const { user } = await renderApp();
    await user.keyboard("{Shift>}/{/Shift}");
    expect(screen.getByRole("searchbox", { name: "Search issues" })).toHaveFocus();
  });

  it("] and [ move through the list when typed with AltGr (Ctrl+Alt)", async () => {
    const { user } = await renderApp();
    await user.keyboard("j");
    expect(selectedKeys()).toEqual(["ABC-1"]);
    await user.keyboard("{Control>}{Alt>}]{/Alt}{/Control}");
    expect(selectedKeys()).toEqual(["ABC-2"]);
    await user.keyboard("{Control>}{Alt>}[[{/Alt}{/Control}");
    expect(selectedKeys()).toEqual(["ABC-1"]);
  });

  it("with Option held (Mac Spanish layout) ] and [ still work", async () => {
    const { user } = await renderApp();
    await user.keyboard("j{Alt>}]{/Alt}");
    expect(selectedKeys()).toEqual(["ABC-2"]);
  });

  it("typing ? or / into a text field never triggers a shortcut", async () => {
    const { user } = await renderApp();
    await user.keyboard("/"); // focus search
    await user.keyboard("{Shift>}?{/Shift}");
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search issues" })).toHaveValue("?");
  });

  it("⌘[ is left for going back and does not step through issues", async () => {
    const { user } = await renderApp();
    await user.keyboard("jj");
    await user.keyboard("{Meta>}[[{/Meta}");
    expect(selectedKeys()).toEqual(["ABC-2"]);
  });
});


// ---------------------------------------------------------------- the issue page
describe("issue page", () => {
  const page = () => screen.getByRole("region", { name: "Issue detail" });
  const crumbs = () => screen.getByRole("navigation", { name: "Breadcrumb" });
  const list = () => screen.queryByRole("listbox", { name: "Issues" });
  async function openFirst() {
    const r = await renderApp();
    await r.user.keyboard("j{Enter}");
    await screen.findByRole("region", { name: "Issue detail" });
    return r;
  }

  it("Enter opens the ticket as a full page: the list is replaced, not squeezed beside it", async () => {
    await openFirst();
    expect(list()).toBeNull();
    expect(within(page()).getByRole("heading", { name: "Fix revenue chart" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Issue detail" })).toBeNull();
  });

  it("double-clicking a row opens the page too", async () => {
    const { user } = await renderApp();
    await user.dblClick(rowOf("ABC-2"));
    expect(within(await screen.findByRole("region", { name: "Issue detail" })).getByRole("heading", { name: "Vendor access for Spotify" })).toBeInTheDocument();
  });

  it("shows the ticket's properties in a sidebar of the page", async () => {
    await openFirst();
    for (const name of ["Status: In Development", "Priority: High", "Assignee: Ana", "Type: Task", "Labels: none", "Project: none", "Due date: none"]) {
      expect(within(page()).getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("has breadcrumbs: team, where you came from, and this ticket", async () => {
    const { user } = await openFirst();
    expect(within(crumbs()).getByRole("button", { name: "ABC" })).toBeInTheDocument();
    expect(within(crumbs()).getByRole("button", { name: "Active" })).toBeInTheDocument();
    expect(within(crumbs()).getByText("ABC-1")).toHaveAttribute("aria-current", "page");
    await user.click(within(crumbs()).getByRole("button", { name: "Active" }));
    expect(list()).not.toBeNull();
    expect(selectedKeys()).toEqual(["ABC-1"]); // you land back on the ticket you were looking at
  });

  it("the Back button, Escape and ⌘[ all return to the list", async () => {
    const { user } = await openFirst();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(list()).not.toBeNull();
    await user.keyboard("{Enter}");
    await screen.findByRole("region", { name: "Issue detail" });
    await user.keyboard("{Escape}");
    expect(list()).not.toBeNull();
    await user.keyboard("{Enter}");
    await screen.findByRole("region", { name: "Issue detail" });
    await user.keyboard("{Meta>}[[{/Meta}");
    expect(list()).not.toBeNull();
  });

  it("works with the browser's Back button", async () => {
    await openFirst();
    expect(window.history.state).toMatchObject({ issue: "ABC-1" });
    window.history.back();
    expect(await screen.findByRole("listbox", { name: "Issues" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Issue detail" })).toBeNull();
  });

  it("previous and next buttons step through the list you came from, with a counter", async () => {
    const { user } = await openFirst();
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous issue" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Next issue" }));
    expect(within(page()).getByRole("heading", { name: "Vendor access for Spotify" })).toBeInTheDocument();
    expect(screen.getByText("2 of 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next issue" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Previous issue" }));
    expect(within(page()).getByRole("heading", { name: "Fix revenue chart" })).toBeInTheDocument();
  });

  it("J K, the arrow keys and ] [ move between tickets while on the page", async () => {
    const { user } = await openFirst();
    const title = () => within(page()).getByRole("heading", { level: 1 }).textContent;
    await user.keyboard("j");
    expect(title()).toBe("Vendor access for Spotify");
    await user.keyboard("k");
    expect(title()).toBe("Fix revenue chart");
    await user.keyboard("{ArrowDown}");
    expect(title()).toBe("Vendor access for Spotify");
    await user.keyboard("{ArrowUp}");
    expect(title()).toBe("Fix revenue chart");
    await user.keyboard("]");
    expect(title()).toBe("Vendor access for Spotify");
    await user.keyboard("[[");
    expect(title()).toBe("Fix revenue chart");
  });

  it("opened from a project page, the breadcrumb names the project and Back returns there", async () => {
    seedProjects();
    const { user } = await renderApp();
    await user.keyboard("gpj{Enter}");
    await screen.findByRole("region", { name: "Project Platform migration" });
    await user.click(screen.getByRole("tab", { name: /^Issues/ }));
    await user.keyboard("j{Enter}");
    await screen.findByRole("region", { name: "Issue detail" });
    expect(within(crumbs()).getByRole("button", { name: "Platform migration" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("region", { name: "Project Platform migration" })).toBeInTheDocument();
  });

  it("property rows change this ticket, even with other rows ticked in the list", async () => {
    const { user } = await renderApp();
    await user.keyboard("jjx"); // tick ABC-2
    await user.keyboard("k{Enter}"); // open ABC-1
    await screen.findByRole("region", { name: "Issue detail" });
    await user.click(within(page()).getByRole("button", { name: /^Status:/ }));
    await screen.findByRole("dialog", { name: "Set status" });
    await user.keyboard("code review{Enter}");
    await waitFor(() => expect(server.rows.get("ABC-1")!.status).toBe("Code Review"));
    expect(server.rows.get("ABC-2")!.status).toBe("Ready for Dev");
  });

  it("click the title to edit it; Enter saves and Escape cancels", async () => {
    const { user } = await openFirst();
    await user.click(within(page()).getByRole("heading", { name: "Fix revenue chart" }));
    const input = within(page()).getByRole("textbox", { name: "Title" });
    expect(input).toHaveValue("Fix revenue chart");
    await user.clear(input);
    await user.type(input, "Fix the revenue chart{Enter}");
    await waitFor(() => expect(server.rows.get("ABC-1")!.summary).toBe("Fix the revenue chart"));
    expect(within(page()).getByRole("heading", { name: "Fix the revenue chart" })).toBeInTheDocument();
    await user.click(within(page()).getByRole("heading", { name: "Fix the revenue chart" }));
    await user.type(within(page()).getByRole("textbox", { name: "Title" }), " NOPE{Escape}");
    expect(within(page()).getByRole("heading", { name: "Fix the revenue chart" })).toBeInTheDocument();
    expect(server.rows.get("ABC-1")!.summary).toBe("Fix the revenue chart");
  });

  it("an empty title is not saved", async () => {
    const { user } = await openFirst();
    await user.click(within(page()).getByRole("heading", { name: "Fix revenue chart" }));
    await user.clear(within(page()).getByRole("textbox", { name: "Title" }));
    await user.keyboard("{Enter}");
    expect(server.rows.get("ABC-1")!.summary).toBe("Summary ABC-1".replace("Summary ABC-1", "Fix revenue chart"));
  });

  it("lists relations as tables of tickets and opens a related ticket's page", async () => {
    seedProjects();
    const { user } = await renderApp();
    await user.click(rowOf("ABC-13"));
    await user.keyboard("{Enter}");
    await screen.findByRole("region", { name: "Issue detail" });
    const relations = within(page()).getByRole("region", { name: "Relations" });
    const table = within(relations).getByRole("table", { name: "Blocked by" });
    await user.click(within(table).getByRole("row", { name: /ABC-14/ }));
    expect(within(page()).getByRole("heading", { level: 1 })).toHaveTextContent("Design invoice schema");
  });

  it("lists sub-issues with their progress", async () => {
    server.put(mkIssue("ABC-6", { summary: "Parent ticket", status: "In Development", statusCategory: "indeterminate" }));
    server.put(mkIssue("ABC-7", { summary: "Sub one", issuetype: "Subtarea", parentKey: "ABC-6", status: "Cerrada", statusCategory: "done" }));
    server.put(mkIssue("ABC-8", { summary: "Sub two", issuetype: "Subtarea", parentKey: "ABC-6", status: "In Development", statusCategory: "indeterminate" }));
    const { user } = await renderApp();
    await user.click(rowOf("ABC-6"));
    await user.keyboard("{Enter}");
    await screen.findByRole("region", { name: "Issue detail" });
    const subs = within(page()).getByRole("region", { name: "Sub-issues" });
    expect(within(subs).getByText("1/2")).toBeInTheDocument();
    expect(within(subs).getByRole("row", { name: /ABC-7/ })).toBeInTheDocument();
    expect(within(subs).getByRole("row", { name: /ABC-8/ })).toBeInTheDocument();
  });

  it("shows the description, the comments, and a comment box", async () => {
    server.put(mkIssue("ABC-1", { summary: "Fix revenue chart", status: "In Development", statusCategory: "indeterminate", assignee: ana, priority: "High", descriptionAdf: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "The chart is wrong" }] }] } }));
    await openFirst();
    expect(within(page()).getByText("The chart is wrong")).toBeInTheDocument();
    expect(within(page()).getByText("Looks good to me")).toBeInTheDocument();
    expect(within(page()).getByRole("textbox", { name: "Add a comment" })).toBeInTheDocument();
  });

  it("Open in Jira and Copy link are in the page header", async () => {
    const { user, openExternal, copyText } = await openFirst();
    await user.click(screen.getByRole("button", { name: "Open in Jira" }));
    expect(openExternal).toHaveBeenCalledWith("https://jira.test/browse/ABC-1");
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(copyText).toHaveBeenCalledWith("https://jira.test/browse/ABC-1");
  });

  it("opening a ticket from the command menu shows its page, and Back goes to the list", async () => {
    const { user } = await renderApp();
    await user.keyboard("{Meta>}k{/Meta}");
    await screen.findByRole("dialog", { name: "Command palette" });
    await user.keyboard("vendor access{Enter}");
    await screen.findByRole("region", { name: "Issue detail" });
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(list()).not.toBeNull();
  });
});

// ------------------------------------------------------------------- board layout
describe("board layout", () => {
  const board = () => document.querySelector(".board");
  const column = (name: RegExp) => screen.getByRole("group", { name });
  async function openBoard() {
    server.put(mkIssue("ABC-6", { summary: "Second in dev", status: "In Development", statusCategory: "indeterminate", updated: "2026-10-01T00:00:00.000+0000" }));
    server.put(mkIssue("ABC-7", { summary: "In review", status: "Code Review", statusCategory: "indeterminate" }));
    const r = await renderApp();
    await r.user.keyboard("{Meta>}b{/Meta}");
    await waitFor(() => expect(board()).not.toBeNull());
    return r;
  }

  it("⌘B turns the list into a board with a column per group, and back again", async () => {
    const { user } = await openBoard();
    expect(document.querySelector(".row")).toBeNull();
    expect(within(column(/^In Development/)).getByText("Fix revenue chart")).toBeInTheDocument();
    expect(within(column(/^Ready for Dev/)).getByText("Vendor access for Spotify")).toBeInTheDocument();
    await user.keyboard("{Meta>}b{/Meta}");
    expect(board()).toBeNull();
    expect(document.querySelector(".row")).not.toBeNull();
  });

  it("is also a choice in Display options and the command menu, remembered for the view", async () => {
    const { user, settings } = await renderApp();
    await user.keyboard("{Shift>}v{/Shift}");
    const dlg = await screen.findByRole("dialog", { name: "Display options" });
    await user.click(within(dlg).getByRole("button", { name: "Board" }));
    expect(settings.getState().resolveDisplay("active").layout).toBe("board");
    expect(board()).not.toBeNull();
    await user.keyboard("{Escape}");
    expect(settings.getState().resolveDisplay("backlog").layout).toBe("list"); // other views are untouched
    await user.keyboard("{Meta>}k{/Meta}");
    await screen.findByRole("dialog", { name: "Command palette" });
    await user.keyboard("layout: list{Enter}");
    expect(board()).toBeNull();
    await user.keyboard("{Meta>}k{/Meta}");
    await screen.findByRole("dialog", { name: "Command palette" });
    await user.keyboard("layout: board{Enter}");
    expect(board()).not.toBeNull();
  });

  it("a card's checkbox is easy to hit: clicking its corner handle ticks the card", async () => {
    const { user } = await openBoard();
    const handle = rowOf("ABC-2").querySelector("label.card-lead")!;
    await user.click(handle);
    expect(within(screen.getByRole("toolbar", { name: "Bulk actions" })).getByText("1 selected")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Issue detail" })).toBeNull();
  });

  it("cards show the ticket and behave like rows: select, tick, context menu, open", async () => {
    const { user } = await openBoard();
    await user.click(rowOf("ABC-1"));
    expect(selectedKeys()).toEqual(["ABC-1"]);
    await user.click(screen.getByRole("checkbox", { name: "Select ABC-2" }));
    expect(within(screen.getByRole("toolbar", { name: "Bulk actions" })).getByText("1 selected")).toBeInTheDocument();
    await user.pointer({ keys: "[MouseRight]", target: rowOf("ABC-7") });
    expect(await screen.findByRole("menu", { name: "Issue actions" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.dblClick(rowOf("ABC-7"));
    expect(await screen.findByRole("region", { name: "Issue detail" })).toBeInTheDocument();
  });

  it("arrow keys move across columns (keeping the row) and up and down within one", async () => {
    const { user } = await openBoard();
    await user.keyboard("{ArrowDown}");
    expect(selectedKeys()).toEqual(["ABC-7"]); // first card of the first column (Code Review is closest to done)
    await user.keyboard("{ArrowRight}");
    expect(selectedKeys()).toEqual(["ABC-1"]);
    await user.keyboard("{ArrowDown}");
    expect(selectedKeys()).toEqual(["ABC-6"]);
    await user.keyboard("{ArrowRight}");
    expect(selectedKeys()).toEqual(["ABC-2"]); // the next column has one card, so the row is clamped
    await user.keyboard("{ArrowLeft}");
    expect(selectedKeys()).toEqual(["ABC-1"]);
    await user.keyboard("k");
    expect(selectedKeys()).toEqual(["ABC-1"]); // already at the top of its column
    await user.keyboard("j");
    expect(selectedKeys()).toEqual(["ABC-6"]);
  });

  it("opening a card and going back returns to the board", async () => {
    const { user } = await openBoard();
    await user.keyboard("{ArrowDown}{Enter}");
    await screen.findByRole("region", { name: "Issue detail" });
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(board()).not.toBeNull();
    expect(selectedKeys()).toEqual(["ABC-7"]);
  });

  it("dragging a card to another column changes its status", async () => {
    await openBoard();
    fireEvent.dragStart(rowOf("ABC-2"));
    fireEvent.dragOver(column(/^In Development/));
    fireEvent.drop(column(/^In Development/));
    await waitFor(() => expect(server.rows.get("ABC-2")!.status).toBe("In Development"));
    expect(server.received.map((r) => r.op)).toEqual(["setStatus"]);
    expect(await screen.findByText("Status set to In Development")).toBeInTheDocument();
  });

  it("dragging one of several ticked cards moves them all", async () => {
    const { user } = await openBoard();
    await user.click(screen.getByRole("checkbox", { name: "Select ABC-1" }));
    await user.click(screen.getByRole("checkbox", { name: "Select ABC-2" }));
    fireEvent.dragStart(rowOf("ABC-2"));
    fireEvent.drop(column(/^Code Review/));
    await waitFor(() => expect([server.rows.get("ABC-1")!.status, server.rows.get("ABC-2")!.status]).toEqual(["Code Review", "Code Review"]));
  });

  it("dropping a card back on its own column does nothing", async () => {
    await openBoard();
    fireEvent.dragStart(rowOf("ABC-1"));
    fireEvent.drop(column(/^In Development/));
    await new Promise((r) => setTimeout(r, 50));
    expect(server.received).toHaveLength(0);
  });

  it("dragging an unticked card ignores other ticked cards", async () => {
    const { user } = await openBoard();
    await user.click(screen.getByRole("checkbox", { name: "Select ABC-1" }));
    fireEvent.dragStart(rowOf("ABC-2"));
    fireEvent.drop(column(/^Code Review/));
    await waitFor(() => expect(server.rows.get("ABC-2")!.status).toBe("Code Review"));
    expect(server.rows.get("ABC-1")!.status).toBe("In Development");
  });

  it("with a board grouped by assignee, dropping assigns the person", async () => {
    const { user, settings } = await openBoard();
    settings.getState().setDisplay("active", { groupBy: "assignee" });
    await screen.findByRole("group", { name: /^Raul/ });
    fireEvent.dragStart(rowOf("ABC-1"));
    fireEvent.drop(column(/^Raul/));
    await waitFor(() => expect(server.rows.get("ABC-1")!.assignee?.id).toBe("u2"));
    void user;
  });

  it("a board needs grouping, so 'No grouping' falls back to status columns", async () => {
    const { settings } = await openBoard();
    settings.getState().setDisplay("active", { groupBy: "none" });
    expect(await screen.findByRole("group", { name: /^In Development/ })).toBeInTheDocument();
  });

  it("a column's + button starts a new issue in that column", async () => {
    const { user } = await openBoard();
    await user.click(screen.getByRole("button", { name: "Add issue to Code Review" }));
    const create = await screen.findByRole("dialog", { name: "Create issue" });
    expect(within(create).getByRole("button", { name: "Status: Code Review" })).toBeInTheDocument();
  });

  it("shows empty columns when asked", async () => {
    const { settings } = await openBoard();
    settings.getState().setDisplay("active", { showEmptyGroups: true });
    expect(await screen.findByRole("group", { name: /^In Testing \(QA\), 0/ })).toBeInTheDocument();
  });
});


// ---------------------------------------------------------- adding and removing relations
describe("relations on the issue page", () => {
  const page = () => screen.getByRole("region", { name: "Issue detail" });
  const relations = () => within(page()).getByRole("region", { name: "Relations" });
  async function openWar1() {
    const r = await renderApp();
    await r.user.keyboard("j{Enter}");
    await screen.findByRole("region", { name: "Issue detail" });
    return r;
  }

  it("offers Add relation even when there are none yet", async () => {
    await openWar1();
    expect(within(relations()).getByText("No relations yet.")).toBeInTheDocument();
    expect(within(relations()).getByRole("button", { name: "Add relation" })).toBeInTheDocument();
  });

  it("Blocked by: pick a ticket and it blocks this one, shown at once", async () => {
    const { user } = await openWar1();
    await user.click(within(relations()).getByRole("button", { name: "Add relation" }));
    await user.click(within(await screen.findByRole("menu", { name: "Add relation" })).getByRole("menuitem", { name: "Blocked by…" }));
    const dlg = await screen.findByRole("dialog", { name: "Blocked by" });
    expect(within(dlg).queryByRole("option", { name: /ABC-1\b/ })).toBeNull(); // not itself
    expect(within(dlg).queryByRole("option", { name: /Quarterly reporting/ })).toBeNull(); // not a project
    await user.click(within(dlg).getByRole("option", { name: /Vendor access for Spotify/ }));
    await waitFor(() => expect(server.rows.get("ABC-2")!.links.map((l) => [l.direction, l.key])).toEqual([["outward", "ABC-1"]])); // ABC-2 blocks ABC-1
    const table = await within(relations()).findByRole("table", { name: "Blocked by" });
    expect(within(table).getByRole("row", { name: /ABC-2/ })).toBeInTheDocument();
  });

  it("Blocking and Related to go the other way / without a direction", async () => {
    const { user } = await openWar1();
    await user.click(within(relations()).getByRole("button", { name: "Add relation" }));
    await user.click(within(await screen.findByRole("menu", { name: "Add relation" })).getByRole("menuitem", { name: "Blocking…" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Blocking" })).getByRole("option", { name: /Vendor access for Spotify/ }));
    await waitFor(() => expect(server.rows.get("ABC-1")!.links.map((l) => [l.direction, l.key])).toEqual([["outward", "ABC-2"]])); // ABC-1 blocks ABC-2
    await user.click(within(relations()).getByRole("button", { name: "Add relation" }));
    await user.click(within(await screen.findByRole("menu", { name: "Add relation" })).getByRole("menuitem", { name: "Related to…" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Related to" })).getByRole("option", { name: /Old finished thing/ }));
    await waitFor(() => expect(server.rows.get("ABC-1")!.links.some((l) => l.type === "Relates" && l.key === "ABC-3")).toBe(true));
  });

  it("the picker filters tickets by what you type", async () => {
    const { user } = await openWar1();
    await user.click(within(relations()).getByRole("button", { name: "Add relation" }));
    await user.click(within(await screen.findByRole("menu", { name: "Add relation" })).getByRole("menuitem", { name: "Related to…" }));
    const dlg = await screen.findByRole("dialog", { name: "Related to" });
    await user.keyboard("spotify");
    expect(within(dlg).getAllByRole("option")).toHaveLength(1);
  });

  it("each relation can be removed, and removing can be undone", async () => {
    seedProjects();
    const { user } = await renderApp();
    await user.click(rowOf("ABC-13"));
    await user.keyboard("{Enter}");
    await screen.findByRole("region", { name: "Issue detail" });
    const row = within(within(relations()).getByRole("table", { name: "Blocked by" })).getByRole("row", { name: /ABC-14/ });
    await user.click(within(row).getByRole("button", { name: "Remove relation" }));
    await waitFor(() => expect(server.rows.get("ABC-13")!.links).toEqual([]));
    expect(within(relations()).queryByRole("table", { name: "Blocked by" })).toBeNull();
    const toast = await screen.findByRole("status", { name: "Relation removed" });
    await user.click(within(toast).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(server.rows.get("ABC-13")!.links.map((l) => [l.direction, l.key])).toEqual([["inward", "ABC-14"]]));
  });

  it("the command menu can add a relation to the highlighted ticket", async () => {
    const { user } = await renderApp();
    await user.keyboard("j{Meta>}k{/Meta}");
    await screen.findByRole("dialog", { name: "Command palette" });
    await user.keyboard("add relation: blocked by{Enter}");
    const dlg = await screen.findByRole("dialog", { name: "Blocked by" });
    await user.click(within(dlg).getByRole("option", { name: /Vendor access for Spotify/ }));
    await waitFor(() => expect(server.received.map((r) => r.op)).toContain("link"));
  });
});


// ---------------------------------------------------------------- activity timeline
describe("activity on the issue page", () => {
  const activity = () => within(screen.getByRole("region", { name: "Issue detail" })).getByRole("region", { name: "Activity" });
  const line = (re: RegExp) => within(activity()).findByText((_, el) => !!el && el.classList.contains("event") && re.test(el.textContent ?? ""));
  const ana = { id: "u1", name: "Ana" };
  async function openWar1() {
    const r = await renderApp();
    await r.user.keyboard("j{Enter}");
    await screen.findByRole("region", { name: "Issue detail" });
    return r;
  }

  it("shows who created the ticket and what changed, in the order it happened", async () => {
    server.put(mkIssue("ABC-1", { summary: "Fix revenue chart", status: "In Development", statusCategory: "indeterminate", assignee: ana, priority: "High", created: "2026-09-01T10:00:00.000+0000", reporter: { id: "u9", name: "Raul" } }));
    server.activity.set("ABC-1", [
      { id: "a1", at: "2026-09-02T10:00:00.000+0000", author: ana, field: "status", from: "Backlog", to: "In Development" },
      { id: "a2", at: "2026-10-20T10:00:00.000+0000", author: { id: "u2", name: "Bea" }, field: "priority", from: "Importante", to: "High" },
    ]);
    await openWar1();
    expect(await line(/Ana changed status from Backlog to In Development/)).toBeInTheDocument();
    const lines = within(activity()).getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(lines[0]).toMatch(/Raul created this issue/);
    expect(lines.findIndex((l) => /changed status/.test(l))).toBeLessThan(lines.findIndex((l) => /Looks good to me/.test(l)));
    expect(lines.findIndex((l) => /Looks good to me/.test(l))).toBeLessThan(lines.findIndex((l) => /changed priority/.test(l)));
  });

  it("still shows the comments if the history cannot be loaded", async () => {
    server.activityFails = true;
    await openWar1();
    expect(within(activity()).getByText("Looks good to me")).toBeInTheDocument();
  });

  it("loads the history of the ticket you step to", async () => {
    server.activity.set("ABC-2", [{ id: "b1", at: "2026-09-03T10:00:00.000+0000", author: ana, field: "labels", from: "", to: "CA:backend" }]);
    const { user } = await openWar1();
    await user.keyboard("j");
    expect(await line(/Ana added label CA:backend/)).toBeInTheDocument();
  });
});


// ------------------------------------------------- editing the description, sub-issues
describe("description and sub-issues on the issue page", () => {
  const page = () => screen.getByRole("region", { name: "Issue detail" });
  const adf = (text: string) => ({ type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
  const warOne = (descriptionAdf: unknown) =>
    server.put(mkIssue("ABC-1", { summary: "Fix revenue chart", status: "In Development", statusCategory: "indeterminate", assignee: ana, priority: "High", descriptionAdf: descriptionAdf as never }));
  async function openWar1() {
    const r = await renderApp();
    await r.user.keyboard("j{Enter}");
    await screen.findByRole("region", { name: "Issue detail" });
    return r;
  }

  it("clicking the description edits it as Markdown; ⌘Enter saves and the page updates at once", async () => {
    warOne(adf("The chart is wrong"));
    const { user } = await openWar1();
    await user.click(within(page()).getByText("The chart is wrong"));
    const box = within(page()).getByRole("textbox", { name: "Description" });
    expect(box).toHaveValue("The chart is wrong");
    await user.type(box, " and slow");
    server.gate = new Promise(() => {}); // the server never answers: the change must already be visible
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(within(page()).getByText("The chart is wrong and slow")).toBeInTheDocument();
    expect(within(page()).queryByRole("textbox", { name: "Description" })).toBeNull();
  });

  it("saving sends the Markdown to Jira", async () => {
    warOne(adf("Original"));
    const { user } = await openWar1();
    await user.click(within(page()).getByText("Original"));
    const box = within(page()).getByRole("textbox", { name: "Description" });
    await user.clear(box);
    await user.type(box, "## New plan");
    await user.click(within(page()).getByRole("button", { name: "Save description" }));
    await waitFor(() => expect(server.received.map((r) => r.op)).toContain("setDescription"));
  });

  it("Escape cancels without changing anything or leaving the page", async () => {
    warOne(adf("Original"));
    const { user } = await openWar1();
    await user.click(within(page()).getByText("Original"));
    await user.type(within(page()).getByRole("textbox", { name: "Description" }), " junk{Escape}");
    expect(within(page()).getByText("Original")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Issue detail" })).toBeInTheDocument();
    expect(server.received).toHaveLength(0);
  });

  it("saving an unchanged description sends nothing", async () => {
    warOne(adf("Same"));
    const { user } = await openWar1();
    await user.click(within(page()).getByText("Same"));
    await user.click(within(page()).getByRole("button", { name: "Save description" }));
    expect(server.received).toHaveLength(0);
  });

  it("a ticket with no description offers to add one", async () => {
    warOne(null);
    const { user } = await openWar1();
    await user.click(within(page()).getByRole("button", { name: "Add description" }));
    await user.type(within(page()).getByRole("textbox", { name: "Description" }), "Fresh text{Meta>}{Enter}{/Meta}");
    await waitFor(() => expect(server.received.map((r) => r.op)).toContain("setDescription"));
  });

  it("formatting the editor cannot keep is protected: it says so and points to Jira", async () => {
    warOne({ type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "mention", attrs: { text: "@Ana" } }, { type: "text", text: " please look" }] }] });
    const { user, openExternal } = await openWar1();
    await user.click(within(page()).getByText("please look", { exact: false }));
    expect(within(page()).queryByRole("textbox", { name: "Description" })).toBeNull();
    expect(within(page()).getByText(/can’t be edited here/)).toBeInTheDocument();
    await user.click(within(page()).getByRole("button", { name: "Edit in Jira" }));
    expect(openExternal).toHaveBeenCalledWith("https://jira.test/browse/ABC-1");
  });

  it("sub-issues can be added from the page with just a title", async () => {
    const { user } = await openWar1();
    const subs = within(page()).getByRole("region", { name: "Sub-issues" });
    await user.click(within(subs).getByRole("button", { name: "Add sub-issue" }));
    await user.type(within(subs).getByRole("textbox", { name: "Sub-issue title" }), "Check the legend{Enter}");
    await waitFor(() => expect(server.created.some((c) => c.summary === "Check the legend")).toBe(true));
    expect(server.created.find((c) => c.summary === "Check the legend")).toMatchObject({ parentKey: "ABC-1", issuetype: "Sub-task" });
    expect(await within(subs).findByText("Check the legend")).toBeInTheDocument();
  });

  it("an empty sub-issue title is ignored, and Escape closes the field", async () => {
    const { user } = await openWar1();
    const subs = within(page()).getByRole("region", { name: "Sub-issues" });
    await user.click(within(subs).getByRole("button", { name: "Add sub-issue" }));
    await user.type(within(subs).getByRole("textbox", { name: "Sub-issue title" }), "   {Enter}");
    expect(server.created).toHaveLength(0);
    await user.keyboard("{Escape}");
    expect(within(subs).queryByRole("textbox", { name: "Sub-issue title" })).toBeNull();
    expect(screen.getByRole("region", { name: "Issue detail" })).toBeInTheDocument();
  });

  it("a sub-issue cannot have sub-issues of its own", async () => {
    server.put(mkIssue("ABC-6", { summary: "Parent", status: "In Development", statusCategory: "indeterminate" }));
    server.put(mkIssue("ABC-7", { summary: "Child", issuetype: "Subtarea", parentKey: "ABC-6", status: "In Development", statusCategory: "indeterminate" }));
    const { user } = await renderApp();
    await user.keyboard("{Shift>}v{/Shift}");
    await user.click(within(await screen.findByRole("dialog", { name: "Display options" })).getByRole("checkbox", { name: "Show sub-issues" }));
    await user.keyboard("{Escape}");
    await user.click(rowOf("ABC-7"));
    await user.keyboard("{Enter}");
    await screen.findByRole("region", { name: "Issue detail" });
    expect(within(page()).queryByRole("button", { name: "Add sub-issue" })).toBeNull();
  });
});


// -------------------------------------------------------- project list options
describe("project list display options", () => {
  const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
  async function projectsView() {
    seedProjects();
    server.put(mkIssue("ABC-70", { summary: "Shipped long ago", issuetype: "Epic", status: "Lanzado", statusCategory: "done", updated: ago(90) }));
    server.put(mkIssue("ABC-71", { summary: "Shipped last week", issuetype: "Epic", status: "Lanzado", statusCategory: "done", updated: ago(8) }));
    const r = await renderApp();
    await r.user.keyboard("gp");
    await screen.findByRole("listbox", { name: "Projects" });
    return r;
  }
  const panel = () => screen.getByRole("dialog", { name: "Display options" });

  it("the Display button is there for projects too", async () => {
    const { user } = await projectsView();
    await user.click(screen.getByRole("button", { name: "Display" }));
    expect(await screen.findByRole("dialog", { name: "Display options" })).toBeInTheDocument();
    expect(within(panel()).getByLabelText("Completed projects")).toBeInTheDocument();
  });

  it("by default only the last month of completed projects is listed", async () => {
    await projectsView();
    expect(screen.getByRole("option", { name: /^Shipped last week/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /^Shipped long ago/ })).toBeNull();
  });

  it("completed projects can be shown in full or hidden", async () => {
    const { user } = await projectsView();
    await user.keyboard("{Shift>}v{/Shift}");
    await user.selectOptions(within(await screen.findByRole("dialog", { name: "Display options" })).getByLabelText("Completed projects"), "all");
    expect(screen.getByRole("option", { name: /^Shipped long ago/ })).toBeInTheDocument();
    await user.selectOptions(within(panel()).getByLabelText("Completed projects"), "none");
    expect(screen.queryByRole("option", { name: /^Shipped last week/ })).toBeNull();
  });

  it("projects can be grouped by lead", async () => {
    const { user } = await projectsView();
    await user.keyboard("{Shift>}v{/Shift}");
    await user.selectOptions(within(await screen.findByRole("dialog", { name: "Display options" })).getByLabelText("Grouping"), "lead");
    expect(screen.getByRole("group", { name: /^Ana, 1/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /^No lead/ })).toBeInTheDocument();
  });

  it("ordering by name sorts inside each group", async () => {
    const { user } = await projectsView();
    await user.keyboard("{Shift>}v{/Shift}");
    await user.selectOptions(within(await screen.findByRole("dialog", { name: "Display options" })).getByLabelText("Ordering"), "name");
    await user.selectOptions(within(panel()).getByLabelText("Grouping"), "none");
    const names = within(screen.getByRole("listbox", { name: "Projects" })).getAllByRole("option").map((o) => o.getAttribute("aria-label")!.split(",")[0]);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("the sidebar's active projects do not change with the list's grouping", async () => {
    const { user } = await projectsView();
    await user.keyboard("{Shift>}v{/Shift}");
    await user.selectOptions(within(await screen.findByRole("dialog", { name: "Display options" })).getByLabelText("Grouping"), "lead");
    await user.keyboard("{Escape}");
    const nav = screen.getByRole("navigation", { name: "Views" });
    expect(within(within(nav).getByRole("group", { name: "Active projects" })).getByRole("button", { name: /Platform migration/ })).toBeInTheDocument();
  });

  it("is remembered, and Reset to default puts it back", async () => {
    const { user, settings } = await projectsView();
    await user.keyboard("{Shift>}v{/Shift}");
    await user.selectOptions(within(await screen.findByRole("dialog", { name: "Display options" })).getByLabelText("Grouping"), "lead");
    expect(settings.getState().resolveProjectsDisplay().groupBy).toBe("lead");
    await user.click(within(panel()).getByRole("button", { name: "Reset to default" }));
    expect(settings.getState().resolveProjectsDisplay().groupBy).toBe("status");
  });
});


describe("My issues tabs", () => {
  const tabs = () => screen.getByRole("tablist", { name: "My issues" });
  it("has Assigned and Created tabs", async () => {
    server.put(mkIssue("ABC-8", { summary: "I reported this one", reporter: ana, assignee: { id: "u2", name: "Raul" }, status: "In Development", statusCategory: "indeterminate" }));
    const { user } = await renderApp();
    await user.keyboard("gi");
    expect(within(tabs()).getByRole("tab", { name: "Assigned" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Fix revenue chart")).toBeInTheDocument(); // assigned to me
    expect(screen.queryByText("I reported this one")).toBeNull();
    await user.click(within(tabs()).getByRole("tab", { name: "Created" }));
    expect(within(tabs()).getByRole("tab", { name: "Created" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("I reported this one")).toBeInTheDocument();
    expect(screen.queryByText("Fix revenue chart")).toBeNull();
  });
  it("the tabs only appear in My issues", async () => {
    const { user } = await renderApp();
    expect(screen.queryByRole("tablist", { name: "My issues" })).toBeNull();
    await user.keyboard("gi");
    expect(tabs()).toBeInTheDocument();
    await user.keyboard("ga");
    expect(screen.queryByRole("tablist", { name: "My issues" })).toBeNull();
  });
  it("the sidebar keeps My issues highlighted on both tabs", async () => {
    const { user } = await renderApp();
    await user.keyboard("gi");
    await user.click(within(tabs()).getByRole("tab", { name: "Created" }));
    expect(within(screen.getByRole("navigation", { name: "Views" })).getByRole("button", { name: "My issues" })).toHaveAttribute("aria-current", "page");
  });
});

describe("project quarter and planning dates", () => {
  function seedPlanned() {
    seedProjects();
    server.put(mkIssue("ABC-80", { summary: "Planned thing", issuetype: "Epic", status: "In Development", statusCategory: "indeterminate", assignee: ana,
      quarter: "FY2027 Q3", initialEstimate: "2027-01-10", revisedEstimate: "2027-02-09", statusChanged: daysAgo(4), updated: "2026-10-14T08:00:00.000+0000" }));
  }

  it("the project list shows the quarter, the effective target and how far it slipped", async () => {
    seedPlanned();
    const { user } = await renderApp();
    await user.keyboard("gp");
    const row = await screen.findByRole("option", { name: /^Planned thing/ });
    expect(within(row).getByText("FY2027 Q3")).toBeInTheDocument();
    expect(within(row).getByText("2027-02-09")).toBeInTheDocument(); // revised wins over initial
    expect(within(row).getByText("Slipped 30 d")).toBeInTheDocument();
  });

  it("projects can be grouped by quarter", async () => {
    seedPlanned();
    const { user } = await renderApp();
    await user.keyboard("gp");
    await screen.findByRole("option", { name: /^Planned thing/ });
    await user.keyboard("{Shift>}v{/Shift}");
    await user.selectOptions(within(await screen.findByRole("dialog", { name: "Display options" })).getByLabelText("Grouping"), "quarter");
    expect(screen.getByRole("group", { name: /^FY2027 Q3, 1/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /^No quarter/ })).toBeInTheDocument();
  });

  it("the details sidebar lists quarter, initial estimate, revised date and where the target comes from", async () => {
    seedPlanned();
    const { user } = await renderApp();
    await user.keyboard("gp");
    await user.click(await screen.findByRole("option", { name: /^Planned thing/ }));
    await user.keyboard("{Enter}");
    const side = await screen.findByRole("complementary", { name: "Project details" });
    expect(within(side).getByText("Quarter").nextSibling).toHaveTextContent("FY2027 Q3");
    expect(within(side).getByText("Initial estimate").nextSibling).toHaveTextContent("2027-01-10");
    expect(within(side).getByText("Revised date").nextSibling).toHaveTextContent("2027-02-09");
    expect(within(side).getByText("Revised date").nextSibling).toHaveTextContent("Slipped 30 d");
    expect(within(side).getByText("In status since").nextSibling).toHaveTextContent("4d");
    expect(within(side).getByRole("button", { name: /^Target date: / })).toHaveTextContent(/revised/i);
  });

  it("the page header shows them when the sidebar is hidden", async () => {
    seedPlanned();
    const { user } = await renderApp();
    await user.keyboard("gp");
    await user.click(await screen.findByRole("option", { name: /^Planned thing/ }));
    await user.keyboard("{Enter}");
    await screen.findByRole("complementary", { name: "Project details" });
    await user.keyboard("{Meta>}i{/Meta}");
    const page = screen.getByRole("region", { name: "Project Planned thing" });
    expect(within(page).getByText("FY2027 Q3")).toBeInTheDocument();
    expect(within(page).getByText("Slipped 30 d")).toBeInTheDocument();
  });
});

describe("for review (local marks, not synced to Jira)", () => {
  const nav = () => screen.getByRole("navigation", { name: "Views" });

  it("T marks the highlighted ticket, shows a flag, and never writes to Jira", async () => {
    const { user } = await renderApp();
    await user.keyboard("j");
    await user.keyboard("t");
    await waitFor(() => expect(server.review.has("ABC-1")).toBe(true));
    expect(within(rowOf("ABC-1")).getByLabelText("For review")).toBeInTheDocument();
    expect(await screen.findByText("Marked for review")).toBeInTheDocument();
    expect(server.received).toEqual([]);
  });

  it("T on a marked ticket removes the mark", async () => {
    server.review.set("ABC-1", "2026-10-14T10:00:00.000Z");
    const { user } = await renderApp();
    await waitFor(() => expect(within(rowOf("ABC-1")).getByLabelText("For review")).toBeInTheDocument());
    await user.keyboard("j");
    await user.keyboard("t");
    await waitFor(() => expect(server.review.has("ABC-1")).toBe(false));
    expect(within(rowOf("ABC-1")).queryByLabelText("For review")).toBeNull();
  });

  it("the toast can undo it", async () => {
    const { user } = await renderApp();
    await user.keyboard("j");
    await user.keyboard("t");
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(server.review.size).toBe(0));
    expect(within(rowOf("ABC-1")).queryByLabelText("For review")).toBeNull();
  });

  it("marks several selected tickets at once", async () => {
    const { user } = await renderApp();
    await user.click(within(rowOf("ABC-1")).getByRole("checkbox"));
    await user.click(within(rowOf("ABC-2")).getByRole("checkbox"));
    await user.click(within(screen.getByRole("toolbar", { name: "Bulk actions" })).getByRole("button", { name: "Review" }));
    await waitFor(() => expect([...server.review.keys()].sort()).toEqual(["ABC-1", "ABC-2"]));
  });

  it("a failed save puts things back and says so", async () => {
    server.reviewFail = true;
    const { user } = await renderApp();
    await user.keyboard("j");
    await user.keyboard("t");
    expect(await screen.findByText(/Couldn’t mark ABC-1 for review/)).toBeInTheDocument();
    expect(within(rowOf("ABC-1")).queryByLabelText("For review")).toBeNull();
  });

  it("has its own view with a count, listing marked tickets even when done", async () => {
    server.review.set("ABC-1", "2026-10-14T10:00:00.000Z");
    server.review.set("ABC-3", "2026-10-14T11:00:00.000Z");
    const { user } = await renderApp();
    await waitFor(() => expect(within(nav()).getByRole("button", { name: /For review/ })).toHaveTextContent("2"));
    await user.click(within(nav()).getByRole("button", { name: /For review/ }));
    expect(await screen.findByRole("heading", { name: /For review/ })).toBeInTheDocument();
    expect(screen.getByText("Fix revenue chart")).toBeInTheDocument();
    expect(screen.getByText("Old finished thing")).toBeInTheDocument(); // done tickets stay while marked
    expect(screen.queryByText("Vendor access for Spotify")).toBeNull();
  });

  it("G then R opens it, and an empty one explains itself", async () => {
    const { user } = await renderApp();
    await user.keyboard("gr");
    expect(await screen.findByText(/Nothing marked for review/)).toBeInTheDocument();
  });

  it("the ticket page has a Team review property that toggles the mark", async () => {
    const { user } = await renderApp();
    await user.keyboard("j{Enter}");
    await user.click(await screen.findByRole("button", { name: "Team review: not marked" }));
    await waitFor(() => expect(server.review.has("ABC-1")).toBe(true));
    expect(await screen.findByRole("button", { name: "Team review: marked" })).toBeInTheDocument();
  });

  it("is in the command palette", async () => {
    const { user } = await renderApp();
    await user.keyboard("j");
    await user.keyboard("{Meta>}k{/Meta}");
    await user.type(await screen.findByRole("combobox"), "review");
    expect(await screen.findByRole("option", { name: /Mark for review/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Go to For review/ })).toBeInTheDocument();
  });
});

describe("project progress chart with planning dates", () => {
  async function openPlanned() {
    seedProjects();
    server.put(mkIssue("ABC-80", { summary: "Planned thing", issuetype: "Epic", status: "In Development", statusCategory: "indeterminate", assignee: ana,
      quarter: "FY2027 Q3", initialEstimate: "2027-01-10", revisedEstimate: "2027-02-09", updated: "2026-10-14T08:00:00.000+0000" }));
    server.put(mkIssue("ABC-81", { summary: "Child done", parentKey: "ABC-80", status: "Cerrada", statusCategory: "done", created: daysAgo(40), updated: daysAgo(3) }));
    server.put(mkIssue("ABC-82", { summary: "Child todo", parentKey: "ABC-80", created: daysAgo(40), updated: daysAgo(2) }));
    server.history["ABC-80"] = [
      { key: "ABC-81", created: daysAgo(40), started: daysAgo(35), completed: daysAgo(3) },
      { key: "ABC-83", created: daysAgo(40), started: daysAgo(30), completed: daysAgo(10) },
      { key: "ABC-82", created: daysAgo(40), started: null, completed: null },
    ];
    const r = await renderApp();
    await r.user.keyboard("gp");
    await r.user.click(await screen.findByRole("option", { name: /^Planned thing/ }));
    await r.user.keyboard("{Enter}");
    return r;
  }

  it("marks the initial estimate and the revised date on the graph, and says what the target is", async () => {
    await openPlanned();
    const side = await screen.findByRole("complementary", { name: "Project details" });
    const graph = await within(side).findByRole("img", { name: /^Progress graph/ });
    expect(graph.querySelector('[data-line="initial"]')).not.toBeNull();
    expect(graph.querySelector('[data-line="revised"]')).not.toBeNull();
    expect(graph.querySelector('[data-line="target"]')).not.toBeNull();
    expect(within(side).getByText("Initial")).toBeInTheDocument(); // legend
    expect(within(side).getByText("Revised")).toBeInTheDocument();
  });

  it("draws completed-per-week bars", async () => {
    await openPlanned();
    const graph = await within(await screen.findByRole("complementary", { name: "Project details" })).findByRole("img", { name: /^Progress graph/ });
    expect(graph.querySelectorAll("[data-bar]").length).toBeGreaterThan(0);
  });

  it("writes the estimated completion in words and compares it with the target", async () => {
    await openPlanned();
    const side = await screen.findByRole("complementary", { name: "Project details" });
    const est = await within(side).findByRole("status", { name: "Estimated completion" });
    expect(est).toHaveTextContent(/Estimated completion/);
    expect(est).toHaveTextContent(/–/); // early – late range
  });
});

describe("story points", () => {
  function seedPointed() {
    server.put(mkIssue("ABC-90", { summary: "Pointed project", issuetype: "Epic", status: "In Development", statusCategory: "indeterminate", updated: "2026-10-14T08:00:00.000+0000" }));
    server.put(mkIssue("ABC-91", { summary: "Big done", parentKey: "ABC-90", parentSummary: "Pointed project", status: "Cerrada", statusCategory: "done", storyPoints: 8, assignee: ana, updated: daysAgo(3) }));
    server.put(mkIssue("ABC-92", { summary: "Small todo", parentKey: "ABC-90", parentSummary: "Pointed project", storyPoints: null, assignee: raul, updated: daysAgo(2) }));
    server.put(mkIssue("ABC-93", { summary: "Dropped", parentKey: "ABC-90", parentSummary: "Pointed project", status: "Cerrada", statusCategory: "done", resolution: "Won't Do", storyPoints: 13, updated: daysAgo(2) }));
  }
  async function openPointed() {
    seedPointed();
    const r = await renderApp();
    await r.user.keyboard("gp");
    await r.user.click(await screen.findByRole("option", { name: /^Pointed project/ }));
    await r.user.keyboard("{Enter}");
    return r;
  }

  it("project progress is weighted by points, with unestimated tickets counted as 3", async () => {
    await openPointed();
    const side = await screen.findByRole("complementary", { name: "Project details" });
    const progress = within(side).getByRole("region", { name: "Progress" });
    const row = (label: string) => within(progress.querySelector(".stats") as HTMLElement).getByText(label).closest("div")!;
    expect(row("Scope")).toHaveTextContent("11"); // 8 + 3, the dropped 13 is out
    expect(row("Completed")).toHaveTextContent("8");
    expect(row("Completed")).toHaveTextContent("73%");
  });

  it("the sidebar only states what unestimated tickets count as; it is not where you set it", async () => {
    await openPointed();
    const side = await screen.findByRole("complementary", { name: "Project details" });
    expect(within(side).queryByLabelText("Points for unestimated tickets")).toBeNull();
    expect(within(side).getByText(/no estimate count as 3 points/i)).toBeInTheDocument();
  });

  it("the default for unestimated tickets is a global setting, in Settings", async () => {
    const { user } = await openPointed();
    await user.keyboard("{Meta>}k{/Meta}");
    await user.type(await screen.findByRole("combobox"), "settings");
    await user.click(screen.getByRole("option", { name: /Settings/ }));
    const dlg = await screen.findByRole("dialog", { name: "Settings" });
    const input = within(dlg).getByLabelText("Points for unestimated tickets");
    expect(input).toHaveValue(3);
    await user.clear(input);
    await user.type(input, "8");
    await user.keyboard("{Escape}");
    const side = await screen.findByRole("complementary", { name: "Project details" });
    const progress = within(side).getByRole("region", { name: "Progress" });
    const row = (label: string) => within(progress.querySelector(".stats") as HTMLElement).getByText(label).closest("div")!;
    expect(row("Scope")).toHaveTextContent("16");
    expect(row("Completed")).toHaveTextContent("50%");
    expect(within(side).getByText(/no estimate count as 8 points/i)).toBeInTheDocument();
  });

  it("the sidebar has a Settings button too", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeInTheDocument();
  });

  it("the ticket page shows the estimate, and says what an unestimated ticket counts as", async () => {
    server.put(mkIssue("ABC-94", { summary: "Estimated one", status: "In Development", statusCategory: "indeterminate", storyPoints: 8, updated: "2026-10-14T12:00:00.000+0000" }));
    server.put(mkIssue("ABC-95", { summary: "Unestimated one", status: "In Development", statusCategory: "indeterminate", updated: "2026-10-14T11:00:00.000+0000" }));
    const { user } = await renderApp();
    await user.dblClick(rowOf("ABC-94"));
    expect(await screen.findByLabelText("Estimate: 8 points")).toBeInTheDocument();
    await user.keyboard("]"); // next ticket in the list
    expect(await screen.findByText(/No estimate, counts as 3/)).toBeInTheDocument();
  });
});

describe("project page tabs", () => {
  async function openProject() {
    seedProjects();
    const r = await renderApp();
    await r.user.keyboard("gpj{Enter}");
    await screen.findByRole("region", { name: "Project Platform migration" });
    return r;
  }
  const tabs = () => screen.getByRole("tablist", { name: "Project sections" });

  it("opens on the Overview tab, with the description and no ticket list", async () => {
    await openProject();
    expect(within(tabs()).getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Move everything to the new platform")).toBeInTheDocument();
    expect(screen.queryByRole("listbox", { name: "Issues" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Filter" })).toBeNull();
  });

  it("the Issues tab is a normal issues view with filters and display options, with the ticket count on the tab", async () => {
    const { user } = await openProject();
    expect(within(tabs()).getByRole("tab", { name: /^Issues/ })).toHaveTextContent("2");
    await user.click(within(tabs()).getByRole("tab", { name: /^Issues/ }));
    expect(await screen.findByRole("listbox", { name: "Issues" })).toBeInTheDocument();
    expect(screen.getByText("Migrate invoices endpoint")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Display" })).toBeInTheDocument();
    expect(screen.queryByText("Move everything to the new platform")).toBeNull();
  });

  it("opening a project always starts on Overview", async () => {
    const { user } = await openProject();
    await user.click(within(tabs()).getByRole("tab", { name: /^Issues/ }));
    await user.keyboard("gp");
    await screen.findByRole("listbox", { name: "Projects" });
    await user.keyboard("j{Enter}");
    await screen.findByRole("tablist", { name: "Project sections" });
    expect(within(tabs()).getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the details sidebar on both tabs", async () => {
    const { user } = await openProject();
    expect(screen.getByRole("complementary", { name: "Project details" })).toBeInTheDocument();
    await user.click(within(tabs()).getByRole("tab", { name: /^Issues/ }));
    expect(screen.getByRole("complementary", { name: "Project details" })).toBeInTheDocument();
  });
});

describe("Jira keys copy or open, and the issue links to its project", () => {
  async function openProject() {
    seedProjects();
    const r = await renderApp();
    await r.user.keyboard("gpj{Enter}");
    await screen.findByRole("region", { name: "Project Platform migration" });
    return r;
  }
  const keyChip = (scope: HTMLElement, key: string) => within(scope).getByRole("link", { name: key });

  it("the project page shows its Jira key; clicking copies the link", async () => {
    const { user, copyText, openExternal } = await openProject();
    await user.click(keyChip(screen.getByRole("region", { name: "Project Platform migration" }), "ABC-10"));
    expect(copyText).toHaveBeenCalledWith("https://jira.test/browse/ABC-10");
    expect(await screen.findByText("Link copied")).toBeInTheDocument();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("ctrl-click or middle-click opens it in Jira instead", async () => {
    const { user, copyText, openExternal } = await openProject();
    const chip = keyChip(screen.getByRole("region", { name: "Project Platform migration" }), "ABC-10");
    fireEvent.click(chip, { ctrlKey: true });
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenLastCalledWith("https://jira.test/browse/ABC-10");
    fireEvent.mouseDown(chip, { button: 1 });
    fireEvent(chip, new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
    expect(openExternal).toHaveBeenCalledTimes(2);
    fireEvent.click(chip, { metaKey: true });
    expect(openExternal).toHaveBeenCalledTimes(3);
    expect(copyText).not.toHaveBeenCalled();
    void user;
  });

  it("the issue page has the same key chip in its breadcrumb", async () => {
    const { user, copyText, openExternal } = await renderApp();
    await user.dblClick(rowOf("ABC-1"));
    const crumbs = await screen.findByRole("navigation", { name: "Breadcrumb" });
    await user.click(keyChip(crumbs, "ABC-1"));
    expect(copyText).toHaveBeenCalledWith("https://jira.test/browse/ABC-1");
    fireEvent.click(keyChip(crumbs, "ABC-1"), { ctrlKey: true });
    expect(openExternal).toHaveBeenCalledWith("https://jira.test/browse/ABC-1");
  });

  it("the project of an issue is a link to that project, separate from the button that changes it", async () => {
    seedProjects();
    const { user } = await renderApp();
    await user.dblClick(rowOf("ABC-13"));
    const side = await screen.findByRole("complementary", { name: "Issue properties" });
    await user.click(within(side).getByRole("button", { name: "Change project" }));
    expect(await screen.findByRole("dialog", { name: "Set project" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(within(side).getByRole("link", { name: "Platform migration" }));
    expect(await screen.findByRole("region", { name: "Project Platform migration" })).toBeInTheDocument();
  });

  it("the breadcrumb names the project too when the issue was not opened from it", async () => {
    seedProjects();
    const { user } = await renderApp();
    await user.dblClick(rowOf("ABC-13"));
    const crumbs = await screen.findByRole("navigation", { name: "Breadcrumb" });
    await user.click(within(crumbs).getByRole("button", { name: "Platform migration" }));
    expect(await screen.findByRole("region", { name: "Project Platform migration" })).toBeInTheDocument();
  });
});

describe("projects overview", () => {
  async function projectsPage() {
    seedProjects();
    server.put(mkIssue("ABC-80", { summary: "Late one", issuetype: "Epic", status: "In Development", statusCategory: "indeterminate", duedate: "2026-01-05", updated: "2026-10-14T08:00:00.000+0000" }));
    server.put(mkIssue("ABC-81", { summary: "Slipping one", issuetype: "Epic", status: "In Development", statusCategory: "indeterminate", initialEstimate: "2027-01-10", revisedEstimate: "2027-02-09", quarter: "FY2027 Q3", updated: "2026-10-14T07:00:00.000+0000" }));
    const r = await renderApp();
    await r.user.keyboard("gp");
    await screen.findByRole("listbox", { name: "Projects" });
    return r;
  }
  const overview = () => screen.getByRole("region", { name: "Projects overview" });

  it("shows how many projects are in each state, with their progress", async () => {
    await projectsPage();
    const tile = (name: string) => within(overview()).getByRole("listitem", { name });
    expect(tile("In progress")).toHaveTextContent("3"); // Platform migration, Late one, Slipping one
    expect(tile("Backlog")).toHaveTextContent("2"); // Billing revamp, Quarterly reporting
    expect(tile("Ongoing")).toHaveTextContent("1");
    expect(tile("In progress")).toHaveTextContent(/\d+%/);
  });

  it("flags projects that are overdue or have slipped", async () => {
    await projectsPage();
    expect(within(overview()).getByRole("listitem", { name: "Overdue" })).toHaveTextContent("2"); // Platform migration (June), Late one
    expect(within(overview()).getByRole("listitem", { name: "Slipped" })).toHaveTextContent("1");
  });

  it("the Display panel can switch the list to a board with a column per status", async () => {
    const { user } = await projectsPage();
    await user.keyboard("{Shift>}v{/Shift}");
    await user.click(within(await screen.findByRole("dialog", { name: "Display options" })).getByRole("button", { name: "Board" }));
    await user.keyboard("{Escape}");
    const board = await screen.findByRole("listbox", { name: "Projects board" });
    expect(within(board).getByRole("group", { name: "In progress, 3" })).toBeInTheDocument();
    expect(within(board).getByRole("group", { name: "Backlog, 2" })).toBeInTheDocument();
    const card = within(board).getByRole("option", { name: /^Slipping one/ });
    expect(within(card).getByText("FY2027 Q3")).toBeInTheDocument();
    expect(within(card).getByText("Slipped 30 d")).toBeInTheDocument();
    expect(within(card).getByText("2027-02-09")).toBeInTheDocument();
  });

  it("cards on the board select with a click and open with a double click", async () => {
    const { user } = await projectsPage();
    await user.keyboard("{Meta>}b{/Meta}");
    const board = await screen.findByRole("listbox", { name: "Projects board" });
    await user.click(within(board).getByRole("option", { name: /^Platform migration/ }));
    expect(within(board).getByRole("option", { name: /^Platform migration/ })).toHaveAttribute("aria-selected", "true");
    await user.dblClick(within(board).getByRole("option", { name: /^Platform migration/ }));
    expect(await screen.findByRole("region", { name: "Project Platform migration" })).toBeInTheDocument();
  });

  it("the layout is remembered", async () => {
    const { user, settings } = await projectsPage();
    await user.keyboard("{Meta>}b{/Meta}");
    expect(settings.getState().resolveProjectsDisplay().layout).toBe("board");
    await user.keyboard("{Meta>}b{/Meta}");
    expect(settings.getState().resolveProjectsDisplay().layout).toBe("list");
  });

  it("j and k still move between projects on the board", async () => {
    const { user } = await projectsPage();
    await user.keyboard("{Meta>}b{/Meta}");
    await screen.findByRole("listbox", { name: "Projects board" });
    await user.keyboard("j");
    expect(screen.getAllByRole("option", { selected: true })).toHaveLength(1);
  });
});

describe("checking Jira when you come back", () => {
  const setVisibility = (state: "visible" | "hidden") => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
  };

  it("asks the server to check Jira when the tab becomes visible, but not more than once a minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await renderApp();
      expect(server.jiraSyncs).toBe(0); // the first load is a normal sync, not a forced Jira check
      setVisibility("hidden");
      expect(server.jiraSyncs).toBe(0);
      setVisibility("visible");
      await waitFor(() => expect(server.jiraSyncs).toBe(1));
      setVisibility("visible");
      expect(server.jiraSyncs).toBe(1); // too soon
      vi.setSystemTime(Date.now() + 61_000);
      setVisibility("visible");
      await waitFor(() => expect(server.jiraSyncs).toBe(2));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("relation rows that are projects", () => {
  function seedEpicBlocker() {
    seedProjects();
    // a ticket of Platform migration is blocked by the whole Billing revamp epic
    server.put(mkIssue("ABC-13", { summary: "Migrate invoices endpoint", parentKey: "ABC-10", parentSummary: "Platform migration", status: "In Development", statusCategory: "indeterminate",
      links: [{ id: "x1", type: "Blocks", direction: "inward", phrase: "is blocked by", key: "ABC-11", summary: "Billing revamp" }] }));
  }

  it("clicking a blocker that is itself a project opens that project's page", async () => {
    seedEpicBlocker();
    const { user } = await renderApp();
    await user.keyboard("gpj{Enter}");
    await screen.findByRole("region", { name: "Project Platform migration" });
    const table = await screen.findByRole("table", { name: "Blocked by" });
    await user.click(within(table).getByText("ABC-11"));
    expect(await screen.findByRole("region", { name: "Project Billing revamp" })).toBeInTheDocument();
  });

  it("Enter on that row does the same", async () => {
    seedEpicBlocker();
    const { user } = await renderApp();
    await user.keyboard("gpj{Enter}");
    const table = await screen.findByRole("table", { name: "Blocked by" });
    within(table).getByText("ABC-11").closest("tr")!.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("region", { name: "Project Billing revamp" })).toBeInTheDocument();
  });
});

describe("projects in several quarters", () => {
  async function open() {
    seedProjects();
    server.put(mkIssue("ABC-85", { summary: "Spans quarters", issuetype: "Epic", status: "In Development", statusCategory: "indeterminate", quarter: "FY2027 Q2, FY2027 Q3", updated: "2026-10-14T08:00:00.000+0000" }));
    const r = await renderApp();
    await r.user.keyboard("gp");
    const row = await screen.findByRole("option", { name: /^Spans quarters/ });
    return { ...r, row };
  }

  it("the sidebar shows each quarter as its own tag", async () => {
    const { user, row } = await open();
    expect(within(row).getByText("FY2027 Q2")).toBeInTheDocument();
    expect(within(row).getByText("FY2027 Q3")).toBeInTheDocument();
    await user.click(row);
    await user.keyboard("{Enter}");
    const side = await screen.findByRole("complementary", { name: "Project details" });
    const quarter = within(side).getByText("Quarter").nextElementSibling as HTMLElement;
    expect(within(quarter).getByText("FY2027 Q2")).toHaveClass("chip");
    expect(within(quarter).getByText("FY2027 Q3")).toHaveClass("chip");
    expect(within(quarter).queryByText("FY2027 Q2, FY2027 Q3")).toBeNull();
  });
});

describe("sidebar project lists", () => {
  const nav = () => screen.getByRole("navigation", { name: "Views" });

  it("ongoing [PERMANENT] projects have their own list, not mixed into Active projects", async () => {
    seedProjects();
    await renderApp();
    const ongoing = await screen.findByRole("group", { name: "Ongoing projects" });
    expect(within(ongoing).getByRole("button", { name: /Tech refactor/ })).toBeInTheDocument();
    expect(within(within(nav()).getByRole("group", { name: "Active projects" })).queryByRole("button", { name: /Tech refactor/ })).toBeNull();
  });

  it("there is no Ongoing list when there are none", async () => {
    await renderApp();
    expect(screen.queryByRole("group", { name: "Ongoing projects" })).toBeNull();
  });

  it("a favorite project is always listed, whatever its status", async () => {
    seedProjects();
    const { settings } = await renderApp();
    settings.getState().toggleFavorite("project:ABC-11"); // Billing revamp is in Backlog
    settings.getState().toggleFavorite("project:ABC-15"); // an ongoing one
    const fav = await screen.findByRole("group", { name: "Favorites" });
    expect(within(fav).getByRole("button", { name: /Billing revamp/ })).toBeInTheDocument();
    expect(within(fav).getByRole("button", { name: /Tech refactor/ })).toBeInTheDocument();
  });
});

describe("how the estimate is explained", () => {
  async function openPlanned() {
    seedProjects();
    server.put(mkIssue("ABC-80", { summary: "Planned thing", issuetype: "Epic", status: "In Development", statusCategory: "indeterminate", updated: "2026-10-14T08:00:00.000+0000" }));
    for (const k of ["ABC-81", "ABC-82", "ABC-83", "ABC-84"]) server.put(mkIssue(k, { summary: `Done ${k}`, parentKey: "ABC-80", status: "Cerrada", statusCategory: "done", storyPoints: 8, updated: daysAgo(3) }));
    server.put(mkIssue("ABC-85", { summary: "Todo", parentKey: "ABC-80", storyPoints: 10, updated: daysAgo(2) }));
    server.history["ABC-80"] = [
      ...[3, 10, 17, 24].map((d, i) => ({ key: `ABC-8${i + 1}`, created: daysAgo(40), started: daysAgo(38), completed: daysAgo(d), canceled: null, points: 8 })),
      { key: "ABC-85", created: daysAgo(40), started: null, completed: null, canceled: null, points: 10 },
    ];
    const r = await renderApp();
    await r.user.keyboard("gp");
    await r.user.click(await screen.findByRole("option", { name: /^Planned thing/ }));
    await r.user.keyboard("{Enter}");
    return r;
  }

  it("the estimated completion has an info button that explains how it is worked out, with the real numbers", async () => {
    const { user } = await openPlanned();
    const side = await screen.findByRole("complementary", { name: "Project details" });
    const info = await within(side).findByRole("button", { name: "How the estimate is calculated" });
    await user.click(info);
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent(/last four weeks/i);
    expect(tip).toHaveTextContent(/8 points a week/); // 8 points finished every week
    expect(tip).toHaveTextContent(/10 points left/);
    expect(tip).toHaveTextContent(/40%/);
    expect(tip).toHaveTextContent(/3 points/); // what unestimated tickets count as
  });

  it("the tooltip also opens on hover and closes on Escape", async () => {
    const { user } = await openPlanned();
    const info = await within(await screen.findByRole("complementary", { name: "Project details" })).findByRole("button", { name: "How the estimate is calculated" });
    await user.hover(info);
    expect(await screen.findByRole("tooltip")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("story points as a display property", () => {
  it("rows show the estimate, and unestimated tickets show nothing", async () => {
    server.put(mkIssue("ABC-96", { summary: "Pointed", status: "In Development", statusCategory: "indeterminate", storyPoints: 5, updated: "2026-10-14T12:00:00.000+0000" }));
    await renderApp();
    expect(within(rowOf("ABC-96")).getByLabelText("5 story points")).toHaveTextContent("5");
    expect(within(rowOf("ABC-1")).queryByLabelText(/story points/)).toBeNull();
  });

  it("can be switched off in Display options", async () => {
    server.put(mkIssue("ABC-96", { summary: "Pointed", status: "In Development", statusCategory: "indeterminate", storyPoints: 5, updated: "2026-10-14T12:00:00.000+0000" }));
    const { user } = await renderApp();
    await user.keyboard("{Shift>}v{/Shift}");
    await user.click(within(await screen.findByRole("dialog", { name: "Display options" })).getByRole("button", { name: "Story points" }));
    await user.keyboard("{Escape}");
    expect(within(rowOf("ABC-96")).queryByLabelText(/story points/)).toBeNull();
  });

  it("cards on the board show it too", async () => {
    server.put(mkIssue("ABC-96", { summary: "Pointed", status: "In Development", statusCategory: "indeterminate", storyPoints: 5, updated: "2026-10-14T12:00:00.000+0000" }));
    const { user } = await renderApp();
    await user.keyboard("{Meta>}b{/Meta}");
    expect(await within(await screen.findByRole("listbox", { name: "Issues" })).findByLabelText("5 story points")).toBeInTheDocument();
  });
});

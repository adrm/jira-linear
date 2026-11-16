import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { InboxEntry, InboxEvent } from "@shared/inbox";
import { App } from "./App";
import { createAppStore, memoryPersistence } from "../store/store";
import { createUiStore } from "../store/ui";
import { createSettingsStore } from "../store/settings";
import { FakeServer, mkIssue } from "../test/fakeServer";

const ana = { id: "u1", name: "Ana" };
const raul = { id: "u2", name: "Raul" };
let server: FakeServer;

const event = (id: string, key: string, over: Partial<InboxEvent> = {}): InboxEvent => ({
  id, key, kind: "status", at: "2026-11-13T10:00:00.000Z", detectedAt: "2026-11-13T10:01:00.000Z", author: raul, from: null, to: null, ...over,
});
const entry = (key: string, state: InboxEntry["state"], events: InboxEvent[], over: Partial<InboxEntry> = {}): InboxEntry => ({
  key, state, updatedAt: events[events.length - 1].at, readAt: null, events, ...over,
});

beforeEach(() => {
  server = new FakeServer();
  server.put(mkIssue("ABC-1", { summary: "Fix revenue chart", status: "In Development", statusCategory: "indeterminate", assignee: ana, updated: "2026-10-14T10:00:00.000+0000" }));
  server.put(mkIssue("ABC-2", { summary: "Vendor access for Spotify", updated: "2026-10-13T10:00:00.000+0000" }));
  server.put(mkIssue("ABC-3", { summary: "Quarterly copy", updated: "2026-10-12T10:00:00.000+0000" }));
  server.put(mkIssue("ABC-5", { summary: "An archived one", updated: "2026-10-11T10:00:00.000+0000" }));
  server.inbox = [
    entry("ABC-1", "unread", [
      event("e1", "ABC-1", { kind: "status", from: "In Development", to: "In Review", at: "2026-11-13T12:00:00.000Z" }),
      event("e2", "ABC-1", { kind: "comment", excerpt: "Please take a look", at: "2026-11-13T12:05:00.000Z" }),
    ]),
    entry("ABC-2", "unread", [event("e3", "ABC-2", { kind: "comment", excerpt: "@Ana can you check?", mentionsMe: true, at: "2026-11-13T11:00:00.000Z" })]),
    entry("ABC-3", "read", [event("e4", "ABC-3", { kind: "duedate", to: "2026-11-20", at: "2026-11-12T09:00:00.000Z" })], { readAt: "2026-11-12T10:00:00.000Z" }),
    entry("ABC-5", "archived", [event("e5", "ABC-5", { kind: "priority", to: "High", at: "2026-11-10T09:00:00.000Z" })], { readAt: "2026-11-10T10:00:00.000Z" }),
  ];
});

async function renderApp(at = "/inbox") {
  window.history.replaceState(null, "", at);
  let n = 0;
  const app = createAppStore({ fetch: server.fetch, persistence: memoryPersistence(), newId: () => `t${++n}` });
  const ui = createUiStore();
  const mem = new Map<string, string>();
  const settings = createSettingsStore({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) });
  const user = userEvent.setup();
  render(<App app={app} ui={ui} settings={settings} fetchFn={server.fetch} jiraUrl="https://jira.test" openExternal={vi.fn()} copyText={vi.fn().mockResolvedValue(undefined)} pollMs={0} />);
  return { app, ui, user };
}
const list = () => screen.findByRole("listbox", { name: "Inbox" });
const rowOf = (key: string) => screen.getByRole("option", { name: new RegExp(`^${key}\\b`) });
const keysShown = () => screen.queryAllByRole("option").map((e) => e.getAttribute("data-key"));
const nav = () => screen.getByRole("navigation", { name: "Views" });
const sent = (keys: string[], action: string) => server.inboxActions.some((a) => a.action === action && a.keys.join() === keys.join());

describe("Inbox view", () => {
  it("lists only the unread entries by default, most recent first, each with what changed", async () => {
    await renderApp();
    await list();
    await waitFor(() => expect(keysShown()).toEqual(["ABC-1", "ABC-2"]));
    expect(rowOf("ABC-1")).toHaveTextContent("Fix revenue chart");
    expect(rowOf("ABC-1")).toHaveTextContent("Status In Development → In Review · 1 comment");
    expect(rowOf("ABC-2")).toHaveTextContent("Mentioned you");
  });

  it("has an All tab without archived entries and an Archived tab", async () => {
    const { user } = await renderApp();
    await waitFor(() => expect(keysShown()).toEqual(["ABC-1", "ABC-2"]));
    await user.click(screen.getByRole("tab", { name: /^All/ }));
    expect(keysShown()).toEqual(["ABC-1", "ABC-2", "ABC-3"]);
    await user.click(screen.getByRole("tab", { name: /^Archived/ }));
    expect(keysShown()).toEqual(["ABC-5"]);
  });

  it("opening a row marks it read, shows the ticket beside the list and what is new since the last visit", async () => {
    const { user } = await renderApp();
    await waitFor(() => expect(keysShown()).toEqual(["ABC-1", "ABC-2"]));
    await user.click(rowOf("ABC-1"));
    await waitFor(() => expect(sent(["ABC-1"], "read")).toBe(true));
    expect(await screen.findByRole("region", { name: "Issue detail" })).toBeInTheDocument();
    const block = screen.getByRole("region", { name: "Since your last visit" });
    expect(within(block).getByText("Status In Development → In Review")).toBeInTheDocument();
    expect(within(block).getByText("Commented: “Please take a look”")).toBeInTheDocument();
    expect(keysShown()).toContain("ABC-1"); // the row stays under the cursor although it is read now
  });

  it("E archives the row being looked at and moves on to the next one", async () => {
    const { user } = await renderApp();
    await waitFor(() => expect(keysShown()).toEqual(["ABC-1", "ABC-2"]));
    await user.click(rowOf("ABC-1"));
    await user.keyboard("e");
    await waitFor(() => expect(sent(["ABC-1"], "archive")).toBe(true));
    await waitFor(() => expect(keysShown()).toEqual(["ABC-2"]));
    expect(rowOf("ABC-2")).toHaveAttribute("aria-selected", "true");
  });

  it("E on the Archived tab brings the entry back", async () => {
    const { user } = await renderApp();
    await user.click(await screen.findByRole("tab", { name: /^Archived/ }));
    await user.click(rowOf("ABC-5"));
    await user.keyboard("e");
    await waitFor(() => expect(sent(["ABC-5"], "unarchive")).toBe(true));
  });

  it("U marks a read entry unread and keeps it that way while it stays open", async () => {
    const { user } = await renderApp();
    await user.click(await screen.findByRole("tab", { name: /^All/ }));
    await user.click(rowOf("ABC-3"));
    await user.keyboard("u");
    await waitFor(() => expect(sent(["ABC-3"], "unread")).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(sent(["ABC-3"], "read")).toBe(false);
  });

  it("Delete removes the entry", async () => {
    const { user } = await renderApp();
    await waitFor(() => expect(keysShown()).toEqual(["ABC-1", "ABC-2"]));
    await user.click(rowOf("ABC-2"));
    await user.keyboard("{Delete}");
    await waitFor(() => expect(sent(["ABC-2"], "delete")).toBe(true));
    await waitFor(() => expect(keysShown()).toEqual(["ABC-1"]));
  });

  it("Backspace, the Delete key of a Mac keyboard, removes the entry too", async () => {
    const { user } = await renderApp();
    await waitFor(() => expect(keysShown()).toEqual(["ABC-1", "ABC-2"]));
    await user.click(rowOf("ABC-2"));
    await user.keyboard("{Backspace}");
    await waitFor(() => expect(sent(["ABC-2"], "delete")).toBe(true));
  });

  it("each row has buttons to archive, mark read or unread, and delete, for the mouse", async () => {
    const { user } = await renderApp();
    await user.click(await screen.findByRole("tab", { name: /^All/ }));
    await user.click(within(rowOf("ABC-2")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(sent(["ABC-2"], "archive")).toBe(true));
    await user.click(within(rowOf("ABC-1")).getByRole("button", { name: "Mark as read" }));
    await waitFor(() => expect(sent(["ABC-1"], "read")).toBe(true));
    await user.click(within(rowOf("ABC-3")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(sent(["ABC-3"], "delete")).toBe(true));
  });

  it("a read row offers Mark as unread, an archived one Unarchive, and using a button does not open the ticket", async () => {
    const { user } = await renderApp();
    await user.click(await screen.findByRole("tab", { name: /^All/ }));
    await user.click(within(rowOf("ABC-3")).getByRole("button", { name: "Mark as unread" }));
    await waitFor(() => expect(sent(["ABC-3"], "unread")).toBe(true));
    expect(screen.queryByRole("region", { name: "Issue detail" })).toBeNull();
    await user.click(screen.getByRole("tab", { name: /^Archived/ }));
    await user.click(within(rowOf("ABC-5")).getByRole("button", { name: "Unarchive" }));
    await waitFor(() => expect(sent(["ABC-5"], "unarchive")).toBe(true));
  });

  it("an entry for a project (epic) shows what is new and a way into the project, instead of a blank pane", async () => {
    server.put(mkIssue("ABC-4", { summary: "Quarterly reporting", issuetype: "Epic", updated: "2026-10-01T10:00:00.000+0000" }));
    server.inbox = [entry("ABC-4", "unread", [event("e9", "ABC-4", { kind: "comment", excerpt: "@Ana please review the scope", mentionsMe: true, at: "2026-11-13T12:00:00.000Z" })])];
    const { user } = await renderApp();
    await waitFor(() => expect(keysShown()).toEqual(["ABC-4"]));
    await user.click(rowOf("ABC-4"));
    const block = await screen.findByRole("region", { name: "Since your last visit" });
    expect(within(block).getByText("Mentioned you: “@Ana please review the scope”")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open project" }));
    await waitFor(() => expect(window.location.pathname).toBe("/projects/ABC-4"));
  });

  it("J moves down the unread entries and a read one leaves the list once you move on", async () => {
    const { user } = await renderApp();
    await waitFor(() => expect(keysShown()).toEqual(["ABC-1", "ABC-2"]));
    await user.keyboard("j");
    expect(rowOf("ABC-1")).toHaveAttribute("aria-selected", "true");
    await user.keyboard("j");
    await waitFor(() => expect(keysShown()).toEqual(["ABC-2"]));
    expect(rowOf("ABC-2")).toHaveAttribute("aria-selected", "true");
  });

  it("J and K move between the rows of the All tab, which keeps read entries", async () => {
    const { user } = await renderApp();
    await user.click(await screen.findByRole("tab", { name: /^All/ }));
    await user.keyboard("j");
    expect(rowOf("ABC-1")).toHaveAttribute("aria-selected", "true");
    await user.keyboard("j");
    expect(rowOf("ABC-2")).toHaveAttribute("aria-selected", "true");
    await user.keyboard("k");
    expect(rowOf("ABC-1")).toHaveAttribute("aria-selected", "true");
  });

  it("says so when there is nothing to look at", async () => {
    server.inbox = [];
    await renderApp();
    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
  });
});

describe("Inbox elsewhere in the app", () => {
  it("G then N goes to the inbox", async () => {
    const { user } = await renderApp("/");
    await screen.findByRole("listbox", { name: "Issues" });
    await user.keyboard("gn");
    await list();
    expect(window.location.pathname).toBe("/inbox");
  });

  it("the sidebar shows the unread count, and no number when everything is read", async () => {
    await renderApp("/");
    await screen.findByRole("listbox", { name: "Issues" });
    await waitFor(() => expect(within(nav()).getByRole("button", { name: /Inbox/ })).toHaveTextContent("2"));
  });

  it("the sidebar has no number at zero unread", async () => {
    server.inbox = server.inbox.map((e) => ({ ...e, state: "read" as const }));
    await renderApp("/");
    await screen.findByRole("listbox", { name: "Issues" });
    await waitFor(() => expect(server.inbox.length).toBe(4));
    expect(within(nav()).getByRole("button", { name: /Inbox/ })).toHaveTextContent(/^Inbox/);
    expect(within(nav()).getByRole("button", { name: /Inbox/ }).textContent).not.toMatch(/\d/);
  });

  it("opening a ticket from another view marks its unread entry read", async () => {
    await renderApp("/issue/ABC-1");
    await screen.findByRole("region", { name: "Issue detail" });
    await waitFor(() => expect(sent(["ABC-1"], "read")).toBe(true));
  });
});

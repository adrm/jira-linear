import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createAppStore, memoryPersistence } from "../store/store";
import { createUiStore } from "../store/ui";
import { createSettingsStore } from "../store/settings";
import { FakeServer, mkIssue } from "../test/fakeServer";

let server: FakeServer;

beforeEach(() => {
  server = new FakeServer();
  server.put(mkIssue("ABC-1", { summary: "Fix revenue chart", status: "In Development", statusCategory: "indeterminate", updated: "2026-10-14T10:00:00.000+0000" }));
  server.put(mkIssue("ABC-4", { summary: "Quarterly reporting", issuetype: "Epic", updated: "2026-10-01T10:00:00.000+0000" }));
});

async function openSettings() {
  let n = 0;
  const app = createAppStore({ fetch: server.fetch, persistence: memoryPersistence(), newId: () => `t${++n}` });
  const ui = createUiStore();
  const mem = new Map<string, string>();
  const settings = createSettingsStore({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) });
  const user = userEvent.setup();
  render(<App app={app} ui={ui} settings={settings} fetchFn={server.fetch} jiraUrl="https://jira.test" openExternal={vi.fn()} copyText={vi.fn().mockResolvedValue(undefined)} pollMs={0} />);
  await screen.findByRole("listbox", { name: "Issues" });
  act(() => ui.getState().openOverlay("settings"));
  const dialog = await screen.findByRole("dialog", { name: "Settings" });
  await within(dialog).findByRole("group", { name: "Notification scope" });
  return { user, dialog };
}
const pressed = (dialog: HTMLElement, group: string) =>
  within(within(dialog).getByRole("group", { name: group })).getAllByRole("button").find((b) => b.getAttribute("aria-pressed") === "true")?.textContent;

describe("notification rules in settings", () => {
  it("shows the rules the server holds, starting with the defaults", async () => {
    const { dialog } = await openSettings();
    expect(pressed(dialog, "Notification scope")).toBe("Tickets I’m involved in");
    expect(pressed(dialog, "Status changes")).toBe("Any status");
    expect(pressed(dialog, "Comments")).toBe("Every comment");
    expect(pressed(dialog, "New tickets")).toBe("Assigned to me");
    expect(within(dialog).getByRole("checkbox", { name: "Mentions of me in comments" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "Assigned to me or taken off me" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "Notify on Priority changes" })).not.toBeChecked();
  });

  it("picking the whole project saves it at once", async () => {
    const { user, dialog } = await openSettings();
    await user.click(within(dialog).getByRole("button", { name: "Whole project" }));
    await waitFor(() => expect(server.rules.scope).toBe("project"));
    expect(pressed(dialog, "Notification scope")).toBe("Whole project");
  });

  it("a checkbox for a kind of change saves it", async () => {
    const { user, dialog } = await openSettings();
    await user.click(within(dialog).getByRole("checkbox", { name: "Notify on Priority changes" }));
    await waitFor(() => expect(server.rules.fields.priority).toBe(true));
    await user.click(within(dialog).getByRole("checkbox", { name: "Mentions of me in comments" }));
    await waitFor(() => expect(server.rules.mentions).toBe(false));
  });

  it("only moves into some statuses shows the status list, and ticking one saves it", async () => {
    const { user, dialog } = await openSettings();
    expect(within(dialog).queryByRole("checkbox", { name: "Notify when moved to Code Review" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Only moves into…" }));
    await user.click(await within(dialog).findByRole("checkbox", { name: "Notify when moved to Code Review" }));
    await waitFor(() => expect(server.rules.status).toEqual({ mode: "into", statuses: ["Code Review"] }));
  });

  it("unticking the last status turns status changes off, which the server would refuse empty", async () => {
    server.rules = { ...server.rules, status: { mode: "into", statuses: ["Code Review"] } };
    const { user, dialog } = await openSettings();
    await user.click(within(dialog).getByRole("checkbox", { name: "Notify when moved to Code Review" }));
    await waitFor(() => expect(server.rules.status).toEqual({ mode: "off" }));
  });

  it("new tickets in epics shows the epics, and ticking one saves it", async () => {
    const { user, dialog } = await openSettings();
    expect(within(dialog).queryByRole("checkbox", { name: /Notify for new tickets in/ })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "In epics…" }));
    await user.click(await within(dialog).findByRole("checkbox", { name: "Notify for new tickets in Quarterly reporting" }));
    await waitFor(() => expect(server.rules.newTickets).toEqual({ mode: "epics", epics: ["ABC-4"] }));
  });

  it("a refused save puts the control back and says so", async () => {
    server.rulesFail = true;
    const { user, dialog } = await openSettings();
    await user.click(within(dialog).getByRole("button", { name: "Whole project" }));
    expect(await screen.findByText(/Couldn’t save the notification rules/)).toBeInTheDocument();
    expect(pressed(dialog, "Notification scope")).toBe("Tickets I’m involved in");
    expect(server.rules.scope).toBe("involved");
  });
});

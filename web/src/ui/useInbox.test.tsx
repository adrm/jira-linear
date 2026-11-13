import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { InboxEntry } from "@shared/inbox";
import { FakeServer } from "../test/fakeServer";
import { useInbox } from "./useInbox";

const entry = (key: string, over: Partial<InboxEntry> = {}): InboxEntry => ({
  key, state: "unread", updatedAt: "2026-11-13T10:00:00.000Z", readAt: null,
  events: [{ id: `e-${key}`, key, kind: "status", at: "2026-11-13T10:00:00.000Z", author: null, from: "A", to: "B" }], ...over,
});

let server: FakeServer;
const notify = vi.fn();
beforeEach(() => {
  server = new FakeServer();
  server.inbox = [entry("ABC-1"), entry("ABC-2")];
  notify.mockReset();
});
const mount = async () => {
  const hook = renderHook(() => useInbox(server.fetch, notify));
  await waitFor(() => expect(hook.result.current.inbox).toHaveLength(2));
  return hook;
};

describe("useInbox", () => {
  it("loads the entries from the server", async () => {
    const { result } = await mount();
    expect(result.current.inbox.map((e) => e.key)).toEqual(["ABC-1", "ABC-2"]);
  });

  it("applies an action at once, before the server has answered, and then the server has it too", async () => {
    const { result } = await mount();
    act(() => result.current.inboxAct(["ABC-1"], "archive"));
    expect(result.current.inbox.find((e) => e.key === "ABC-1")!.state).toBe("archived");
    await waitFor(() => expect(server.inboxActions).toEqual([{ keys: ["ABC-1"], action: "archive" }]));
    expect(server.inbox.find((e) => e.key === "ABC-1")!.state).toBe("archived");
  });

  it("removes a deleted entry at once", async () => {
    const { result } = await mount();
    act(() => result.current.inboxAct(["ABC-2"], "delete"));
    expect(result.current.inbox.map((e) => e.key)).toEqual(["ABC-1"]);
  });

  it("puts the entry back and says so when the server refuses", async () => {
    server.inboxFail = true;
    const { result } = await mount();
    act(() => result.current.inboxAct(["ABC-1"], "archive"));
    expect(result.current.inbox.find((e) => e.key === "ABC-1")!.state).toBe("archived");
    await waitFor(() => expect(result.current.inbox.find((e) => e.key === "ABC-1")!.state).toBe("unread"));
    expect(notify).toHaveBeenCalledWith("Couldn’t archive ABC-1");
  });

  it("names several tickets by count when an action on them fails, and sends nothing for no change", async () => {
    server.inboxFail = true;
    const { result } = await mount();
    act(() => result.current.inboxAct(["ABC-1", "ABC-2"], "read"));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Couldn’t mark as read 2 tickets"));
    server.inboxFail = false;
    act(() => result.current.inboxAct(["ABC-1"], "unread")); // already unread after the rollback
    expect(server.inboxActions).toEqual([]);
  });
});

/** Wire types for the inbox, shared by server and web client. */
import type { UserRef } from "./types.ts";

export type InboxEventKind =
  | "created" | "status" | "assignee" | "priority" | "duedate" | "summary" | "description" | "labels" | "type" | "parent" | "links" | "qaAssignee" | "points" | "comment";

export interface InboxEvent {
  /** `h:<history id>:<item index>`, `c:<comment id>` or `new:<key>`; the same change always has the same id */
  id: string;
  key: string;
  kind: InboxEventKind;
  at: string;
  author: UserRef | null;
  from: string | null;
  to: string | null;
  /** first characters of a comment */
  excerpt?: string;
  mentionsMe?: boolean;
  assignment?: "to-me" | "from-me";
  /** set by the server when it stores the event; unseen events are the ones detected after the entry's `readAt` */
  detectedAt?: string;
}

export type InboxState = "unread" | "read" | "archived";

export interface InboxEntry {
  key: string;
  state: InboxState;
  updatedAt: string;
  /** when the entry was last read; events after it are the ones not seen yet */
  readAt: string | null;
  /** every event since the entry entered the inbox or came back from the archive, oldest first */
  events: InboxEvent[];
}

export type InboxAction = "read" | "unread" | "archive" | "unarchive" | "delete";

export interface InboxRules {
  /** tickets the owner is involved in, or the whole project; applies to every row except mentions, assignment and new tickets */
  scope: "involved" | "project";
  mentions: boolean;
  assigned: boolean;
  status: { mode: "off" | "any" } | { mode: "into"; statuses: string[] };
  comments: "off" | "mentions" | "all";
  newTickets: { mode: "off" | "assigned" | "all" | "epics"; epics: string[] };
  fields: { priority: boolean; duedate: boolean; summary: boolean; description: boolean; labels: boolean; type: boolean; parent: boolean; links: boolean; qaAssignee: boolean; points: boolean };
}

export const DEFAULT_RULES: InboxRules = {
  scope: "involved",
  mentions: true,
  assigned: true,
  status: { mode: "any" },
  comments: "all",
  newTickets: { mode: "assigned", epics: [] },
  fields: { priority: false, duedate: false, summary: false, description: true, labels: false, type: false, parent: false, links: false, qaAssignee: false, points: false },
};

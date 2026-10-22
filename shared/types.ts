/** Wire types shared by server and web client. */

export interface UserRef {
  id: string;
  name: string;
}

export interface IssueLink {
  id: string;
  type: string; // e.g. "Blocks"
  direction: "inward" | "outward";
  phrase: string; // e.g. "is blocked by"
  key: string; // the other issue
  summary: string;
}

export interface Issue {
  key: string;
  id: string;
  project: string;
  summary: string;
  descriptionAdf: unknown | null;
  status: string;
  statusCategory: string; // "new" | "indeterminate" | "done"
  issuetype: string;
  priority: string | null;
  assignee: UserRef | null;
  reporter: UserRef | null;
  parentKey: string | null;
  parentSummary: string | null;
  labels: string[];
  duedate: string | null;
  created: string;
  updated: string;
  links: IssueLink[];
  /** planning fields from Jira custom fields: Quarter (e.g. "FY2027 Q3"), initial and revised estimated dates */
  quarter: string | null;
  /** Jira "Story Points"; null when the ticket has no estimate */
  storyPoints: number | null;
  /** resolution name, e.g. "Won't Do"; null when unresolved or unset */
  resolution: string | null;
  initialEstimate: string | null;
  revisedEstimate: string | null;
  /** when the status last changed category (Jira's statuscategorychangedate) */
  statusChanged: string | null;
}

export interface Comment {
  id: string;
  issueKey: string;
  author: UserRef | null;
  bodyAdf: unknown | null;
  created: string;
  updated: string;
}

export interface Delta {
  syncId: number;
  issues: Array<Issue & { deleted: boolean }>;
  comments: Array<Comment & { deleted: boolean }>;
}

export type MutationBody =
  | { op: "setStatus"; key: string; status: string }
  | { op: "setAssignee"; key: string; accountId: string | null }
  | { op: "setPriority"; key: string; priority: string }
  | { op: "setLabels"; key: string; labels: string[] }
  | { op: "setType"; key: string; issuetype: string }
  | { op: "setSummary"; key: string; summary: string }
  | { op: "setDescription"; key: string; markdown: string }
  | { op: "setDueDate"; key: string; date: string | null }
  | { op: "setParent"; key: string; parentKey: string | null }
  | { op: "addComment"; key: string; markdown: string }
  | {
    op: "createIssue";
    summary: string;
    issuetype: string;
    markdown?: string;
    labels?: string[];
    parentKey?: string;
    duedate?: string;
    priority?: string;
    assigneeId?: string;
    /** status to move the new issue to after creating it */
    status?: string;
  }
  | { op: "link"; type: string; inwardKey: string; outwardKey: string }
  | { op: "addLink"; key: string; url: string; title: string }
  | { op: "unlink"; key: string; linkId: string; otherKey: string };

/** `id` is a client-generated idempotency key. */
export type Mutation = MutationBody & { id: string };

export interface MutationResult {
  syncId: number;
  key: string;
  /** the change was applied, but part of it could not be (e.g. the starting status) */
  warning?: string;
}

/** A mutation before the client assigns its idempotency id (distributes over the union). */
export type MutationInput = Mutation extends infer M ? (M extends Mutation ? Omit<M, "id"> : never) : never;

export interface TicketHistory {
  key: string;
  created: string;
  started: string | null;
  completed: string | null;
  /** when it left the scope without being done (closed as Won't Do, Duplicate…); null otherwise */
  canceled: string | null;
  points: number | null;
}

export interface ResourceLink {
  id: string;
  url: string;
  title: string;
}

export interface ActivityEntry {
  id: string;
  at: string;
  author: UserRef | null;
  /** status | assignee | priority | summary | labels | type | duedate | parent */
  field: string;
  from: string | null;
  to: string | null;
}


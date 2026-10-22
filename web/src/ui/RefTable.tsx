import { X } from "lucide-react";
import type { Issue } from "@shared/types";
import { isEpic, stripPermanent } from "../lib/projects";
import { blockState } from "../lib/relations";
import { Avatar, StatusIcon } from "./icons";
import { useCtx, useIssueMap, useStatusFractions } from "./context";

export interface RefRow {
  issue: Issue;
  /** the Jira link id, when the row can be removed */
  linkId?: string;
  /** the viewer's own tickets this reference affects, shown in the last column */
  ours?: Issue[];
}

/** A table of ticket references (status icon, key, title, project, assignee), as Linear lists related issues. */
export function RefTable({ label, rows, oursHeader, onRemove }: { label: string; rows: RefRow[]; oursHeader?: string; onRemove?: (row: RefRow) => void }) {
  const { ui } = useCtx();
  const issues = useIssueMap();
  const fractions = useStatusFractions();
  // a reference can be a whole project (epic): that opens its project page, since epics have no ticket page
  const open = (i: Issue) => (isEpic(i) ? ui.getState().setView(`project:${i.key}`) : ui.getState().openIssue(i.key));
  const projectOf = (i: Issue) => (i.parentKey && issues[i.parentKey] && isEpic(issues[i.parentKey]) ? issues[i.parentKey] : null);
  return (
    <table aria-label={label} className="reftable">
      <thead>
        <tr>
          <th scope="col">Ticket</th>
          <th scope="col">Project</th>
          <th scope="col">Assignee</th>
          {oursHeader && <th scope="col">{oursHeader}</th>}
          {onRemove && <th scope="col"><span className="sr-only">Actions</span></th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const { issue, ours } = row;
          const project = projectOf(issue);
          const pending = issue.key.startsWith("NEW-");
          return (
            <tr key={issue.key} tabIndex={0} onClick={() => !pending && open(issue)} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget && !pending) open(issue); }}>
              <td>
                <div className="ref-ticket">
                  <StatusIcon category={issue.statusCategory} status={issue.status} fraction={fractions.tickets[issue.status]} block={blockState(issue, issues)} />
                  <span className="row-key">{pending ? "New" : issue.key}</span>
                  <span className="ref-title">{issue.summary}</span>
                </div>
              </td>
              <td>
                {project ? (
                  <button type="button" className="chip chip-epic" onClick={(e) => { e.stopPropagation(); ui.getState().setView(`project:${project.key}`); }}>{stripPermanent(project.summary)}</button>
                ) : <span className="muted">No project</span>}
              </td>
              <td className="ref-assignee">{issue.assignee ? <span className="lead"><Avatar name={issue.assignee.name} /><span>{issue.assignee.name}</span></span> : <span className="muted">—</span>}</td>
              {oursHeader && (
                <td>
                  <div className="ref-ours">
                  {(ours ?? []).map((o) => (
                    <button key={o.key} type="button" className="chip" title={o.summary} onClick={(e) => { e.stopPropagation(); ui.getState().openIssue(o.key); }}>{o.key}</button>
                  ))}
                  </div>
                </td>
              )}
              {onRemove && (
                <td className="ref-actions">
                  <button type="button" className="icon-btn" aria-label="Remove relation" title="Remove relation" onClick={(e) => { e.stopPropagation(); onRemove(row); }}><X size={14} /></button>
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

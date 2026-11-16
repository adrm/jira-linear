import { createContext, useContext, useState, type ReactNode } from "react";
import { Paperclip } from "lucide-react";

// deno-lint-ignore no-explicit-any
type Node = any;

const SAFE_URL = /^(https?:|mailto:)/i;
const COLOR = /^#[0-9a-f]{3,8}$/i;

/** The issue whose files the rich text refers to; without it, pictures and attachments show only their name. */
const IssueCtx = createContext<string | null>(null);

function textOf(n: Node): string {
  if (typeof n?.text === "string") return n.text;
  return (n?.content ?? []).map(textOf).join("");
}

function marks(node: Node, child: ReactNode): ReactNode {
  return (node.marks ?? []).reduce((acc: ReactNode, m: Node) => {
    switch (m.type) {
      case "strong": return <strong>{acc}</strong>;
      case "em": return <em>{acc}</em>;
      case "code": return <code className="adf-code">{acc}</code>;
      case "strike": return <s>{acc}</s>;
      case "underline": return <u>{acc}</u>;
      case "textColor": return COLOR.test(String(m.attrs?.color)) ? <span style={{ color: m.attrs.color }}>{acc}</span> : acc;
      case "link": {
        const href = m.attrs?.href;
        return typeof href === "string" && SAFE_URL.test(href)
          ? <a href={href} target="_blank" rel="noopener noreferrer">{acc}</a>
          : acc;
      }
      default: return acc;
    }
  }, child);
}

function kids(n: Node): ReactNode[] {
  return (n.content ?? []).map((c: Node, i: number) => <Block key={i} node={c} />);
}

function mediaSrc(issueKey: string | null, a: Node): string | null {
  if (a.type === "external") return typeof a.url === "string" && /^https?:/i.test(a.url) ? a.url : null;
  if (a.type === "file" && issueKey && a.id) return `/api/media/${issueKey}/${encodeURIComponent(a.id)}${a.alt ? `?name=${encodeURIComponent(a.alt)}` : ""}`;
  return null;
}

/** A picture, or, for attachment groups, inline files and anything that is not a picture, a link to the file. */
function Media({ node, as }: { node: Node; as: "image" | "file" }) {
  const issueKey = useContext(IssueCtx);
  const [failed, setFailed] = useState(false);
  const a = node.attrs ?? {};
  const src = mediaSrc(issueKey, a);
  const label = String(a.alt || "Attachment");
  if (!src) return <span className="adf-file"><Paperclip size={12} aria-hidden="true" />{label}</span>;
  if (as === "file" || failed) {
    return <a className="adf-file" href={src} target="_blank" rel="noopener noreferrer"><Paperclip size={12} aria-hidden="true" />{label}</a>;
  }
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className="adf-img-link">
      <img className="adf-img" src={src} alt={label} loading="lazy" onError={() => setFailed(true)} />
    </a>
  );
}

function Block({ node }: { node: Node }): ReactNode {
  switch (node.type) {
    case "paragraph": return <p>{kids(node)}</p>;
    case "text": return marks(node, node.text);
    case "heading": {
      const level = Math.min(6, Math.max(1, node.attrs?.level ?? 3));
      const H = `h${level}` as "h1";
      return <H>{kids(node)}</H>;
    }
    case "bulletList": return <ul>{kids(node)}</ul>;
    case "orderedList": return <ol>{kids(node)}</ol>;
    case "listItem": return <li>{kids(node)}</li>;
    case "codeBlock": return <pre><code>{textOf(node)}</code></pre>;
    case "blockquote": return <blockquote>{kids(node)}</blockquote>;
    case "rule": return <hr />;
    case "hardBreak": return <br />;
    case "mention": return <span className="adf-mention">{node.attrs?.text ?? "@someone"}</span>;
    case "emoji": return <span>{node.attrs?.text ?? node.attrs?.shortName ?? ""}</span>;
    case "inlineCard": {
      const url: string = node.attrs?.url ?? "";
      const label = url.split("/").filter(Boolean).pop() ?? url;
      return SAFE_URL.test(url) ? <a href={url} target="_blank" rel="noopener noreferrer">{label}</a> : <span>{label}</span>;
    }
    case "table": return <table><tbody>{kids(node)}</tbody></table>;
    case "tableRow": return <tr>{kids(node)}</tr>;
    case "tableHeader": return <th>{kids(node)}</th>;
    case "tableCell": return <td>{kids(node)}</td>;
    case "panel": return <div className={`adf-panel adf-panel-${String(node.attrs?.panelType ?? "info").replace(/[^a-z]/gi, "")}`}>{kids(node)}</div>;
    case "taskList": return <ul className="adf-tasks">{kids(node)}</ul>;
    case "taskItem": return <li><input type="checkbox" checked={node.attrs?.state === "DONE"} disabled aria-label={node.attrs?.state === "DONE" ? "Done" : "To do"} /> {kids(node)}</li>;
    case "expand":
    case "nestedExpand": return <details className="adf-expand"><summary>{node.attrs?.title || "Details"}</summary>{kids(node)}</details>;
    case "blockCard": {
      const url: string = node.attrs?.url ?? "";
      const label = url.split("/").filter(Boolean).pop() ?? url;
      return <p>{SAFE_URL.test(url) ? <a href={url} target="_blank" rel="noopener noreferrer">{label}</a> : label}</p>;
    }
    case "mediaSingle": {
      const w = Number(node.attrs?.width);
      const width = w > 0 ? (node.attrs?.widthType === "pixel" ? `${w}px` : `${w}%`) : undefined;
      return <figure className="adf-media" style={{ width, maxWidth: "100%" }}>{kids(node)}</figure>;
    }
    case "mediaGroup": return <div className="adf-files">{(node.content ?? []).map((c: Node, i: number) => <Media key={i} node={c} as="file" />)}</div>;
    case "media": return <Media node={node} as="image" />;
    case "mediaInline": return <Media node={node} as="file" />;
    default: return node.content ? <div>{kids(node)}</div> : <span>{textOf(node)}</span>;
  }
}

export function Adf({ doc, issueKey }: { doc: unknown; issueKey?: string }) {
  if (!doc) return null;
  return <IssueCtx.Provider value={issueKey ?? null}><div className="adf">{kids(doc as Node)}</div></IssueCtx.Provider>;
}

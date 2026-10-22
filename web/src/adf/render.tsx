import type { ReactNode } from "react";

// deno-lint-ignore no-explicit-any
type Node = any;

const SAFE_URL = /^(https?:|mailto:)/i;

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
    case "panel": return <div className="adf-panel">{kids(node)}</div>;
    default: return node.content ? <div>{kids(node)}</div> : <span>{textOf(node)}</span>;
  }
}

export function Adf({ doc }: { doc: unknown }) {
  if (!doc) return null;
  return <div className="adf">{kids(doc as Node)}</div>;
}

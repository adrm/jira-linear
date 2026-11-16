import type { AttachmentInfo, JiraClient } from "./jira.ts";

type MediaClient = Pick<JiraClient, "getAttachments" | "mediaIdOf">;

const LIST_TTL_MS = 60_000;
/** A media id that is not in the list may belong to an attachment added a moment ago. */
const MISS_REFRESH_MS = 5_000;

/**
 * Finds the attachment a rich-text media node points at. Nodes name a file by the media service's id, which Jira
 * does not list with the attachments, so each attachment's id is looked up once and remembered. Pages migrated from
 * other tools use the file name as the id (`UNKNOWN_MEDIA_<name>`), and the node's alt text is the file name too.
 */
export function createMediaResolver(client: MediaClient, now: () => number = Date.now) {
  const lists = new Map<string, { at: number; items: AttachmentInfo[] }>();
  const mediaIds = new Map<string, string | null>();

  async function list(key: string, fresh: boolean): Promise<AttachmentInfo[]> {
    const hit = lists.get(key);
    if (hit && !fresh && now() - hit.at < LIST_TTL_MS) return hit.items;
    const items = await client.getAttachments(key);
    lists.set(key, { at: now(), items });
    return items;
  }

  async function lookup(items: AttachmentInfo[], mediaId: string, name?: string): Promise<AttachmentInfo | null> {
    const byName = (n: string) => items.find((a) => a.filename === n) ?? items.find((a) => a.filename.toLowerCase() === n.toLowerCase());
    if (mediaId.startsWith("UNKNOWN_MEDIA_")) return byName(mediaId.slice("UNKNOWN_MEDIA_".length)) ?? (name ? byName(name) ?? null : null);
    const wanted = mediaId.toLowerCase();
    await Promise.all(items.filter((a) => !mediaIds.has(a.id)).map(async (a) => {
      try {
        mediaIds.set(a.id, await client.mediaIdOf(a.id));
      } catch { /* try again next time */ }
    }));
    return items.find((a) => mediaIds.get(a.id) === wanted) ?? (name ? byName(name) ?? null : null);
  }

  return {
    async resolve(key: string, mediaId: string, name?: string): Promise<AttachmentInfo | null> {
      const hit = lists.get(key);
      const found = await lookup(await list(key, false), mediaId, name);
      if (found || !hit || now() - hit.at < MISS_REFRESH_MS) return found;
      return await lookup(await list(key, true), mediaId, name);
    },
    /** The media id of an attachment that was just uploaded. */
    async mediaIdFor(attachmentId: string): Promise<string | null> {
      const id = await client.mediaIdOf(attachmentId);
      mediaIds.set(attachmentId, id);
      return id;
    },
    forget(key: string) {
      lists.delete(key);
    },
  };
}

import { readableNote } from "../access";
import { readableRow } from "../collections/access";
import { parseStoredSchema, readValues, rowTitle } from "../collections/schema";
import { readableCard } from "../tasks/access";

export type LinkTargetType = "note" | "card" | "collection_row";
export const LINK_TARGET_TYPES: readonly LinkTargetType[] = ["note", "card", "collection_row"];
/** Links per event. Not in the plan's cap table; bounds a detail response. */
export const MAX_LINKS_PER_EVENT = 50;

export type ResolvedLink = { targetType: LinkTargetType; targetId: string; title: string | null; restricted: boolean };

/**
 * How each link target type is checked and titled for one viewer (§4.2, T59).
 * `readableTitle` returns the target's title when the viewer can read it, or
 * null when they cannot (or it no longer exists). Links never grant access.
 *
 * Each type uses its own module's `readable*` check: notes, cards (the
 * board is readable; the card's title), and collection rows (the collection
 * is readable; the row's primary field). Linking requires the linker to read
 * the target. A type without a resolver would be shape-checked only and
 * always resolve as restricted.
 */
type LinkResolver = { readableTitle: (targetId: string, userId: string) => string | null };

const resolvers: Partial<Record<LinkTargetType, LinkResolver>> = {
  note: { readableTitle: (targetId, userId) => readableNote(targetId, userId)?.title ?? null },
  card: { readableTitle: (targetId, userId) => readableCard(targetId, userId)?.card.title ?? null },
  collection_row: {
    readableTitle: (targetId, userId) => {
      const readable = readableRow(targetId, userId);
      if (!readable) return null;
      const schema = parseStoredSchema(readable.collection.schema_json);
      return rowTitle(schema, readValues(schema, JSON.parse(readable.row.values_json)));
    }
  }
};

export function registerLinkResolver(type: LinkTargetType, resolver: LinkResolver) {
  resolvers[type] = resolver;
}

/** Whether `userId` may link the target: readable when the type has a resolver, shape-checked otherwise. */
export function canLinkTarget(type: LinkTargetType, targetId: string, userId: string) {
  const resolver = resolvers[type];
  return resolver ? resolver.readableTitle(targetId, userId) !== null : true;
}

export function resolveLink(type: LinkTargetType, targetId: string, userId: string): ResolvedLink {
  const title = resolvers[type]?.readableTitle(targetId, userId) ?? null;
  return { targetType: type, targetId, title: title === null ? null : title || "Untitled", restricted: title === null };
}

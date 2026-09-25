import { readableNote } from "../access";

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
 * Extension point: `card` (Task Boards) and `collection_row` (Collections)
 * have no resolver in this module yet, so their ids are validated by shape
 * only when linking and always resolve as restricted. When those modules
 * land, register a resolver here that uses their own `readable*` predicate;
 * linking then also requires the linker to read the target.
 */
type LinkResolver = { readableTitle: (targetId: string, userId: string) => string | null };

const resolvers: Partial<Record<LinkTargetType, LinkResolver>> = {
  note: { readableTitle: (targetId, userId) => readableNote(targetId, userId)?.title ?? null }
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

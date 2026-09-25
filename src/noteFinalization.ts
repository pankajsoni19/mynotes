export type OpenNoteFinalization = "removed-empty" | "published" | "unchanged";

export type OpenNoteFinalizationSteps = {
  removeEmptyNewNote: () => Promise<boolean>;
  hasPublishableDelta: boolean;
  publish: () => Promise<boolean>;
};

// Shared by note/folder switches and leaving Notes: a blank never-published note is removed,
// otherwise a changed draft is saved and published. Errors propagate so callers can stay put.
export async function finalizeOpenNote({ removeEmptyNewNote, hasPublishableDelta, publish }: OpenNoteFinalizationSteps): Promise<OpenNoteFinalization> {
  if (await removeEmptyNewNote()) return "removed-empty";
  if (hasPublishableDelta && await publish()) return "published";
  return "unchanged";
}

export type AutoPublishInput = {
  isOwner: boolean;
  /** The user typed in this note's editor since it was opened (editor onChange). */
  sessionEdited: boolean;
  /** The server reports the saved draft differs from the published version. */
  serverHasDelta: boolean;
  /** The editor holds text that is not saved yet. */
  hasUnsavedChanges: boolean;
};

/**
 * Whether leaving a note publishes its draft. Only a draft edited in this
 * session is published on the way out. A draft that was already waiting when
 * the note was opened (from another session, or written by an MCP key) stays
 * a draft until the owner presses Publish.
 */
export function shouldAutoPublish({ isOwner, sessionEdited, serverHasDelta, hasUnsavedChanges }: AutoPublishInput) {
  return isOwner && sessionEdited && (serverHasDelta || hasUnsavedChanges);
}

/** Whether the explicit Publish button is offered: any owner draft that differs from the published version. */
export function canPublish({ isOwner, serverHasDelta, hasUnsavedChanges }: Omit<AutoPublishInput, "sessionEdited">) {
  return isOwner && (serverHasDelta || hasUnsavedChanges);
}

/** The "Draft by <key>" badge text for an owner's draft written by an MCP key, or null. */
export function mcpDraftBadge(keyName: string | null | undefined) {
  return keyName ? `Draft by ${keyName}` : null;
}

export const DRAFT_CHANGED_MESSAGE = "This draft changed since you last saw it — review it before publishing";

/** Whether a failed publish means the draft moved on (for example an MCP write) and must be reviewed first. */
export function isDraftChangedError(status: number, payload: unknown) {
  return status === 409 && typeof payload === "object" && payload !== null && (payload as { code?: unknown }).code === "DRAFT_CHANGED";
}

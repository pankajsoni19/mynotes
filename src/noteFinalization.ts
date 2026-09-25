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

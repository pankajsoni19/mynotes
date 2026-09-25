// Pure helpers for the Tasks UI: name validation that mirrors the server rules.
export type NameCheck = { ok: true; name: string; changed: boolean } | { ok: false; error: string };

// C0/C1 controls and bidi overrides, as refused by server/tasks/routes.ts.
const controlCharacters = /[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/;

function validateLabel(input: string, max: number, noun: string, current?: string): NameCheck {
  const name = input.trim();
  if (!name) return { ok: false, error: `Enter a ${noun}.` };
  if (name.length > max) return { ok: false, error: `Use at most ${max} characters.` };
  if (controlCharacters.test(name)) return { ok: false, error: "Remove control characters." };
  return { ok: true, name, changed: name !== current };
}

export const validateBoardName = (input: string, current?: string) => validateLabel(input, 120, "board name", current);
export const validateColumnName = (input: string, current?: string) => validateLabel(input, 60, "column name", current);
export const validateCardTitle = (input: string, current?: string) => validateLabel(input, 200, "card title", current);

export const sharingLabel = (visibility: "private" | "selected" | "all_users") =>
  visibility === "all_users" ? "Everyone here" : visibility === "selected" ? "Shared" : "Private";

export const cardCountLabel = (count: number) => count === 1 ? "1 card" : `${count} cards`;
export const commentCountLabel = (count: number) => count === 1 ? "1 comment" : `${count} comments`;
export const attachmentCountLabel = (count: number) => count === 1 ? "1 attachment" : `${count} attachments`;

/** The card dialog eyebrow: one “In”, even for a column already named “In progress”. */
export const columnEyebrow = (name: string) => /^in\s/i.test(name.trim()) ? name.trim() : `In ${name}`;

/** The second line in the user picker: the email, or a short id when another user has the same name. */
export function pickerDetail(user: { id: string; email?: string; displayName: string }, users: readonly { id: string; displayName: string }[]) {
  if (user.email) return user.email;
  const name = user.displayName.trim().toLowerCase();
  return users.some((other) => other.id !== user.id && other.displayName.trim().toLowerCase() === name) ? `ID ${user.id.slice(0, 8)}` : null;
}

export const COMMENT_MAX_BYTES = 16_384;

/** Why a comment body would be refused, or null. */
export function commentBodyError(body: string) {
  if (!body.trim()) return "Write a comment first.";
  if (new TextEncoder().encode(body).length > COMMENT_MAX_BYTES) return "Comments can be at most 16 KB.";
  return null;
}

type AttachmentLike = { document_id: string; comment_id: string | null; linked_by: string | null; preview_kind: string; mime_type: string };

/** Files attached to the card itself (null) or through one comment. */
export function attachmentsFor<T extends AttachmentLike>(attachments: readonly T[], commentId: string | null) {
  return attachments.filter((item) => item.comment_id === commentId);
}

/** Whether the viewer may remove an attachment: whoever linked it, or the board owner. */
export const canUnlink = (attachment: AttachmentLike, userId: string, boardOwner: boolean) => boardOwner || attachment.linked_by === userId;

/** Images the server previews inline are shown as thumbnails; everything else is a download. */
export const isInlineImage = (attachment: Pick<AttachmentLike, "preview_kind" | "mime_type">) =>
  attachment.preview_kind === "image" && ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(attachment.mime_type.split(";")[0]!.trim().toLowerCase());

export const unlinkConfirmMessage = (name: string, ownFile: boolean) => ownFile
  ? `Remove “${name}” from this card? If no other card uses it, it moves to your Bin for 30 days.`
  : `Remove “${name}” from this card? If no other card uses it, it moves to its uploader's Bin for 30 days.`;

/** The Files-style confirm copy for moving a card or board to the Bin. */
export const binConfirmMessage = (kind: "card" | "board", name: string) => kind === "card"
  ? `Move “${name}” to the Bin? You can restore it for 30 days.`
  : `Move the board “${name}” and all its cards to the Bin? You can restore it for 30 days.`;

/** A toast action, such as Undo after moving something to the Bin. */
export type TaskNotify = (message: string, action?: { label: string; run: () => void }) => void;

/**
 * After CARD_CHANGED on a title save: retrying at the new revision is safe only when the server's
 * title is still the one the edit started from, so another person's rename is never overwritten.
 */
export const canRetryTitle = (baseTitle: string, serverTitle: string) => baseTitle === serverTitle;

/** Whether leaving the card would lose description edits. */
export const descriptionDirty = (editing: boolean, draft: string, saved: string) => editing && draft !== saved;

/** Today's date in the viewer's time zone as YYYY-MM-DD. */
export function localDateString(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const dayNumber = (isoDate: string) => {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Math.round(Date.UTC(year!, month! - 1, day!) / 86_400_000);
};

export type DueStatus = { tone: "overdue" | "today" | "soon" | "later"; label: string; description: string };

/**
 * The due chip on a card. Done cards show no chip. `today` is the viewer's
 * local date (YYYY-MM-DD), so "overdue" matches what Today shows.
 */
export function dueStatus(dueOn: string | null, today: string, done = false): DueStatus | null {
  if (!dueOn || done) return null;
  const days = dayNumber(dueOn) - dayNumber(today);
  const [year, month, day] = dueOn.split("-").map(Number);
  const short = new Date(year!, month! - 1, day!).toLocaleDateString(undefined, { month: "short", day: "numeric", ...(dueOn.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" } : {}) });
  if (days < 0) return { tone: "overdue", label: short, description: `Overdue, was due ${short}` };
  if (days === 0) return { tone: "today", label: "Today", description: "Due today" };
  if (days === 1) return { tone: "soon", label: "Tomorrow", description: "Due tomorrow" };
  return { tone: days <= 7 ? "soon" : "later", label: short, description: `Due ${short}` };
}

/**
 * The due date to save from the date field, or null when there is nothing to save: the value
 * must be a complete real date from 1900 to 2999 (as the server requires) and differ from the
 * saved one. Browsers report partial years such as 0202 while a date is typed.
 */
export function committableDueDate(value: string, saved: string | null) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match || value === saved) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1900 || year > 2999) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : null;
}

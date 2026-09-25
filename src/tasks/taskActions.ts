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

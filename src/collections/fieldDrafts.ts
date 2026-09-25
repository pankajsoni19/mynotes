// Pure state helpers for the field editor. The server validates again (buildSchema); these give
// early feedback and build the PUT /schema body.
import type { FieldDefinition, FieldInput, FieldType, OptionColor } from "./collectionsApi";
import { allowedTypeChanges, validateName } from "./values";

export type OptionDraft = { key: string; id?: string; label: string; color: OptionColor };
export type FieldDraft = {
  key: string;
  id?: string;
  /** The stored type, which limits the type changes on offer. */
  originalType?: FieldType;
  name: string;
  type: FieldType;
  required: boolean;
  decimals: number;
  unit: string;
  options: OptionDraft[];
};

let counter = 0;
export const draftKey = () => `k${++counter}`;

export function toDrafts(fields: FieldDefinition[]): FieldDraft[] {
  return fields.map((field) => ({
    key: field.id,
    id: field.id,
    originalType: field.type,
    name: field.name,
    type: field.type,
    required: field.required === true,
    decimals: field.number?.decimals ?? 0,
    unit: field.number?.unit ?? "",
    options: (field.options ?? []).map((option) => ({ key: option.id, id: option.id, label: option.label, color: option.color }))
  }));
}

export function newFieldDraft(type: FieldType = "text", name = ""): FieldDraft {
  return { key: draftKey(), name, type, required: false, decimals: 0, unit: "", options: [] };
}

/** Types offered for a field: any type for a new field, the allowed changes for an existing one. */
export function typeChoices(draft: FieldDraft, all: FieldType[]): FieldType[] {
  return draft.originalType ? allowedTypeChanges(draft.originalType) : all;
}

export function fromDrafts(drafts: FieldDraft[]): FieldInput[] {
  return drafts.map((draft) => {
    const field: FieldInput = { name: draft.name.trim(), type: draft.type };
    if (draft.id) field.id = draft.id;
    if (draft.required && draft.type !== "file") field.required = true;
    if (draft.type === "number") field.number = { decimals: Math.min(6, Math.max(0, Math.floor(draft.decimals))), unit: draft.unit.trim().slice(0, 8) };
    if (draft.type === "select" || draft.type === "multi_select") {
      field.options = draft.options.map((option) => ({ ...(option.id ? { id: option.id } : {}), label: option.label.trim(), color: option.color }));
    }
    return field;
  });
}

/** The first problem with the drafts, or null. Mirrors the server's schema rules. */
export function validateDrafts(drafts: FieldDraft[]): string | null {
  if (!drafts.length) return "Keep at least one field";
  if (drafts.length > 50) return "A collection can have up to 50 fields";
  if (drafts[0]!.type !== "text") return "The first field must be a text field; it is each row's title";
  const names = new Set<string>();
  for (const draft of drafts) {
    const check = validateName(draft.name, 60);
    if (!check.ok) return `Field names: ${check.error.toLowerCase()}`;
    const folded = check.name.toLowerCase();
    if (names.has(folded)) return `Two fields are named “${check.name}”`;
    names.add(folded);
    if (draft.type === "select" || draft.type === "multi_select") {
      if (draft.options.length > 100) return `“${check.name}” can have up to 100 options`;
      const labels = new Set<string>();
      for (const option of draft.options) {
        const label = validateName(option.label, 60);
        if (!label.ok) return `Options of “${check.name}”: ${label.error.toLowerCase()}`;
        if (labels.has(label.name.toLowerCase())) return `“${check.name}” has two options named “${label.name}”`;
        labels.add(label.name.toLowerCase());
      }
    }
  }
  return null;
}

/** Moves the draft at `index` by `delta` (−1 up, +1 down); out-of-range moves return the list unchanged. */
export function moveDraft<T>(items: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item!);
  return next;
}

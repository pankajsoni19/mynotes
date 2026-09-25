import { useState } from "react";
import { Check } from "lucide-react";
import { ModalDialog } from "../files/Dialog";
import type { FieldDefinition } from "./collectionsApi";

type OptionPickerProps = {
  field: FieldDefinition;
  selected: string[];
  onSave: (ids: string[]) => Promise<boolean>;
  onClose: () => void;
};

// A field's option picker for multi-select values: a dialog on desktop, a full-screen sheet on
// phones. Pushes no history entry; Back closes it (dialogLayers). At most 20 options can be chosen.
export function OptionPicker({ field, selected, onSave, onClose }: OptionPickerProps) {
  const [chosen, setChosen] = useState<string[]>(selected);
  const [busy, setBusy] = useState(false);
  const options = field.options ?? [];

  async function save() {
    setBusy(true);
    if (await onSave(options.filter((option) => chosen.includes(option.id)).map((option) => option.id))) onClose();
    else setBusy(false);
  }

  return <ModalDialog title={field.name} eyebrow="Choose options" onClose={onClose} variant="sheet" busy={busy}>
    <div className="move-list" role="group" aria-label={field.name}>
      {options.map((option, index) => {
        const on = chosen.includes(option.id);
        return <button key={option.id} role="checkbox" aria-checked={on} className={`move-option${on ? " active" : ""}`} disabled={busy || (!on && chosen.length >= 20)} autoFocus={index === 0}
          onClick={() => setChosen((items) => on ? items.filter((id) => id !== option.id) : [...items, option.id])}>
          <span className={`option-dot color-${option.color}`} aria-hidden="true" />
          <span>{option.label}</span>
          {on ? <Check aria-hidden="true" /> : <span aria-hidden="true" />}
        </button>;
      })}
      {!options.length && <p className="empty-copy">This field has no options yet. The owner can add them in Fields.</p>}
    </div>
    <footer className="file-dialog-actions">
      <button className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button>
      <button className="primary-button" onClick={() => { void save(); }} disabled={busy}>{busy ? "Saving…" : "Done"}</button>
    </footer>
  </ModalDialog>;
}

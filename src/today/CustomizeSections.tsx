import { ModalDialog } from "../files/Dialog";
import { useHistoryDialogGuard } from "../tasks/useHistoryDialogGuard";
import { TODAY_SECTIONS } from "./todaySections";

type CustomizeSectionsProps = {
  names: readonly string[];
  hidden: readonly string[];
  onChange: (name: string, visible: boolean) => void;
  onShowAll: () => void;
  onClose: () => void;
};

/**
 * "Customize sections" (§2.3). A dialog that pushes no history entry: it
 * registers the history dialog guard, so browser Back only closes it (D69).
 * Changes apply at once and are kept in this browser for this user.
 */
export function CustomizeSections({ names, hidden, onChange, onShowAll, onClose }: CustomizeSectionsProps) {
  useHistoryDialogGuard(true, onClose);
  return <ModalDialog title="Customize sections" eyebrow="Today" onClose={onClose} describedBy="today-customize-copy">
    <p id="today-customize-copy" className="file-dialog-copy">Choose what Today shows. This is saved in this browser only.</p>
    <fieldset className="today-customize-list">
      <legend className="sr-only">Sections</legend>
      {names.map((name, index) => {
        const visible = !hidden.includes(name);
        return <label key={name} className="today-customize-option">
          <input type="checkbox" checked={visible} autoFocus={index === 0} onChange={(event) => onChange(name, event.target.checked)} />
          <span>{TODAY_SECTIONS[name]?.title ?? name}</span>
        </label>;
      })}
    </fieldset>
    <footer className="file-dialog-actions">
      <button className="secondary-button" onClick={onShowAll} disabled={hidden.length === 0}>Show all</button>
      <button className="primary-button" onClick={onClose}>Done</button>
    </footer>
  </ModalDialog>;
}

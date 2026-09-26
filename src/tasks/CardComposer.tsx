import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Columns3, File as FileIcon, Link2, Paperclip, Plus, X } from "lucide-react";
import { ApiError } from "../api";
import { imageAltText, imageContentUrl, IMAGE_REJECTED_MESSAGE, isInsertableImageType } from "../editor/imageUpload";
import { NoteEditor } from "../editor/NoteEditor";
import { ConfirmDialog, trapTabKey } from "../files/Dialog";
import { deleteFile, formatBytes } from "../files/filesApi";
import { Select } from "../ui/Select";
import { CardFields } from "./CardFields";
import {
  applyFieldChange,
  composerDirty,
  composerError,
  createBody,
  defaultColumnId,
  draftCard,
  emptyDraft,
  MAX_COMPOSER_ATTACHMENTS,
  MAX_COMPOSER_RELATIONS,
  type ComposerDraft,
  type ComposerError,
  type FieldContext
} from "./composerDraft";
import { RelationAdder, RelationList } from "./RelationsSection";
import { canEnterColumn, validateCardTitle } from "./taskActions";
import { createCard, taskErrorCode, taskErrorMessage, uploadAttachment, type BoardColumn, type CardDetail, type CardSearchResult, type RelationType } from "./tasksApi";
import { useHistoryDialogGuard } from "./useHistoryDialogGuard";

export type ComposerMode = "close" | "open" | "another";

type CardComposerProps = {
  boardId: string;
  boardName: string;
  userId: string;
  columns: BoardColumn[];
  /** The board's cards, to tell which columns are full (D108). */
  cards: readonly { id: string; column_id: string }[];
  /** The column it was opened from ("+ Add card"); null from "New card". */
  initialColumnId: string | null;
  onClose: () => void;
  /** The card was created; for "another" the composer stays open and starts over. */
  onCreated: (card: CardDetail, mode: ComposerMode, options: { hadRelations: boolean }) => void;
  notify: (message: string) => void;
};

/**
 * Creates a card with every detail in one call (WAVE_13_TASK_CARD_UX.md §4.3): title, column,
 * `CardFields`, description, staged relations, and attachments uploaded as you add them. It is a
 * guarded dialog, not a route (D69): full screen on phones, a large modal on desktop. Back, Escape,
 * and Close ask first when anything was entered, and discarding moves the uploads to the Bin.
 */
export function CardComposer({ boardId, boardName, userId, columns, cards, initialColumnId, onClose, onCreated, notify }: CardComposerProps) {
  const [draft, setDraft] = useState<ComposerDraft>(() => emptyDraft(defaultColumnId(columns, cards, initialColumnId)));
  const [titleError, setTitleError] = useState<string | null>(null);
  const [error, setError] = useState<ComposerError | null>(null);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [addingRelation, setAddingRelation] = useState(false);
  // Remounts the description editor when the form starts over ("Create another").
  const [round, setRound] = useState(0);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const titleRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const column = columns.find((item) => item.id === draft.columnId);

  const update = (change: (current: ComposerDraft) => ComposerDraft) => setDraft((current) => {
    const next = change(current);
    draftRef.current = next;
    return next;
  });

  const requestClose = useCallback(() => {
    if (composerDirty(draftRef.current)) setConfirmDiscard(true);
    else onClose();
  }, [onClose]);
  // Back closes the composer (or asks first); Back with the prompt open only closes the prompt.
  useHistoryDialogGuard(!confirmDiscard, requestClose);
  const keepEditing = useCallback(() => setConfirmDiscard(false), []);
  useHistoryDialogGuard(confirmDiscard, keepEditing);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || confirmDiscard) return;
      if (window.document.querySelector(".file-dialog")) return;
      event.preventDefault();
      requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmDiscard, requestClose]);

  /** Moves uploads that will not be attached to the Bin (T100); the hourly sweeper catches any left over. */
  const discardUploads = (ids: string[]) => {
    for (const id of ids) deleteFile(id).catch(() => undefined);
  };

  async function submit(mode: ComposerMode) {
    if (creating || uploading > 0) return;
    const current = draftRef.current;
    const check = validateCardTitle(current.title);
    if (!check.ok) {
      setTitleError(check.error);
      titleRef.current?.focus();
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const { card } = await createCard(boardId, createBody(current, check.name));
      onCreated(card, mode, { hadRelations: current.relations.length > 0 });
      if (mode === "another") {
        notify(`Added “${card.title}”. Add another.`);
        update(() => emptyDraft(current.columnId));
        setTitleError(null);
        setAddingRelation(false);
        setRound((value) => value + 1);
        titleRef.current?.focus();
      }
    } catch (reason) {
      const payload = reason instanceof ApiError && reason.payload && typeof reason.payload === "object" ? reason.payload as { wipLimit?: unknown } : {};
      setError(composerError({
        status: reason instanceof ApiError ? reason.status : undefined,
        code: taskErrorCode(reason),
        wipLimit: payload.wipLimit,
        message: taskErrorMessage(reason, "Could not create the card")
      }, column, current.relations.length > 0));
    } finally {
      setCreating(false);
    }
  }

  // Ctrl/⌘+Enter creates from anywhere in the form; with Shift it creates and starts another. It is
  // caught on the way down, before a focused dropdown or the editor treats Enter as its own.
  function onKeyDownCapture(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    void submit(event.shiftKey ? "another" : "close");
  }

  async function upload(file: File) {
    if (draftRef.current.attachments.length >= MAX_COMPOSER_ATTACHMENTS) throw new Error(`A card can have at most ${MAX_COMPOSER_ATTACHMENTS} attachments`);
    setUploading((count) => count + 1);
    try {
      const uploaded = await uploadAttachment(file);
      update((current) => ({ ...current, attachments: [...current.attachments, uploaded] }));
      return uploaded;
    } finally {
      setUploading((count) => count - 1);
    }
  }

  async function attachFiles(list: FileList | null) {
    for (const file of Array.from(list ?? [])) {
      try {
        await upload(file);
      } catch (reason) {
        notify(`${file.name}: ${taskErrorMessage(reason, "could not upload")}`);
      }
    }
  }

  // Images pasted or dropped into the description are attachments of the new card, shown inline.
  async function uploadDescriptionImage(file: File) {
    if (!isInsertableImageType(file.type)) throw new Error(IMAGE_REJECTED_MESSAGE);
    const uploaded = await upload(file);
    if (uploaded.preview_kind !== "image" || !isInsertableImageType(uploaded.mime_type.split(";")[0]!.trim())) {
      throw new Error("Attached as a file: only PNG, JPEG, GIF, and WebP images show inline");
    }
    return { src: imageContentUrl(uploaded.id), alt: imageAltText(uploaded.name || file.name) };
  }

  function removeFile(id: string) {
    update((current) => ({ ...current, attachments: current.attachments.filter((file) => file.id !== id) }));
    discardUploads([id]);
  }

  async function stageRelation(type: RelationType, card: CardSearchResult) {
    if (draftRef.current.relations.some((relation) => relation.card.id === card.id)) return "That card is already linked.";
    if (draftRef.current.relations.length >= MAX_COMPOSER_RELATIONS) return `A card can have at most ${MAX_COMPOSER_RELATIONS} relations.`;
    update((current) => ({ ...current, relations: [...current.relations, { key: `${type}:${card.id}`, type, card }] }));
    if (error?.field === "relations") setError(null);
    return null;
  }

  const saveField = async (change: object, _success: string, context?: FieldContext) => {
    update((current) => applyFieldChange(current, change as Record<string, unknown>, context));
    return true;
  };

  const columnOptions = columns.map((item) => {
    const full = !canEnterColumn(cards, item, null);
    return { value: item.id, label: item.name, disabled: full, ...(full ? { description: `Full (limit ${item.wip_limit})` } : item.is_done === 1 ? { description: "Done column" } : {}) };
  });
  const busy = creating || uploading > 0;
  const fieldError = (field: ComposerError["field"]) => error?.field === field && <p className="file-dialog-error" role="alert">{error.message}</p>;
  const stagedRows = draft.relations.map((relation) => ({ key: relation.key, type: relation.type, restricted: false, card: relation.card }));

  return <>
    <button className="panel-scrim task-card-scrim" onClick={requestClose} aria-label="Close the new card" tabIndex={-1} />
    <section className="task-card-dialog task-composer" role="dialog" aria-modal="true" aria-labelledby={`${baseId}-heading`} onKeyDownCapture={onKeyDownCapture} onKeyDown={trapTabKey}>
      <header className="task-card-dialog-header">
        <div className="task-card-dialog-heading">
          <span className="eyebrow" id={`${baseId}-heading`}>New card · {boardName}</span>
          <input
            ref={titleRef}
            id={titleId}
            className="task-card-title-input"
            value={draft.title}
            autoFocus
            placeholder="Card title"
            aria-label="Card title"
            aria-invalid={titleError ? true : undefined}
            aria-describedby={titleError ? `${baseId}-title-error` : undefined}
            maxLength={200}
            onChange={(event) => { const title = event.target.value; update((current) => ({ ...current, title })); setTitleError(null); }}
            onKeyDown={(event) => {
              // Enter in the one-line title creates, as Ctrl/⌘+Enter does.
              if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit(event.shiftKey ? "another" : "close");
              }
            }}
          />
          {titleError && <p id={`${baseId}-title-error`} className="file-dialog-error" role="alert">{titleError}</p>}
        </div>
        <button type="button" className="icon-button" onClick={requestClose} aria-label="Close the new card" title="Close"><X /></button>
      </header>

      <div className="task-card-dialog-body">
        <div className="task-card-details">
          <div className="task-card-field">
            <label id={`${baseId}-column-label`}><Columns3 aria-hidden="true" />Column</label>
            <Select id={`${baseId}-column`} labelledBy={`${baseId}-column-label`} label="Column" value={draft.columnId} options={columnOptions} disabled={busy}
              onChange={(columnId) => { update((current) => ({ ...current, columnId })); if (error?.field === "column") setError(null); }} />
            {fieldError("column")}
          </div>
        </div>
        <CardFields card={draftCard(draft, boardId)} userId={userId} idPrefix={baseId} done={column?.is_done === 1} saving={creating} onSave={saveField} />

        <section className="task-card-section" aria-labelledby={`${baseId}-description`}>
          <header><h3 id={`${baseId}-description`}>Description</h3></header>
          <div className="task-description-editor">
            <NoteEditor key={round} markdown={draft.description} editable={!creating} onNotice={notify} label="Card description" placeholder="Describe the work… Type / for commands"
              onChange={(description) => update((current) => ({ ...current, description }))} uploadImage={uploadDescriptionImage} />
          </div>
        </section>

        <section className="task-card-section" aria-labelledby={`${baseId}-relations`}>
          <header>
            <h3 id={`${baseId}-relations`}><Link2 aria-hidden="true" />Relations</h3>
            {!addingRelation && <button type="button" className="secondary-button task-small-button" onClick={() => setAddingRelation(true)} disabled={busy || draft.relations.length >= MAX_COMPOSER_RELATIONS}><Plus />Add relation</button>}
          </header>
          {addingRelation && <RelationAdder idPrefix={baseId} boardId={boardId} excluded={new Set(draft.relations.map((relation) => relation.card.id))} disabled={creating}
            onAdd={stageRelation} onDone={() => setAddingRelation(false)} />}
          {stagedRows.length > 0 && <RelationList rows={stagedRows} boardId={boardId}
            onRemove={(row) => update((current) => ({ ...current, relations: current.relations.filter((relation) => relation.key !== row.key) }))} />}
          {!stagedRows.length && !addingRelation && <p className="task-comment-empty">Linked when the card is created.</p>}
          {fieldError("relations")}
        </section>

        <section className="task-card-section" aria-labelledby={`${baseId}-files`}>
          <header>
            <h3 id={`${baseId}-files`}><Paperclip aria-hidden="true" />Attachments</h3>
            <button type="button" className="secondary-button task-small-button" onClick={() => fileRef.current?.click()} disabled={creating || draft.attachments.length >= MAX_COMPOSER_ATTACHMENTS}><Paperclip />{uploading ? "Uploading…" : "Attach"}</button>
            <input ref={fileRef} type="file" multiple hidden onChange={(event) => { void attachFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />
          </header>
          {draft.attachments.length
            ? <ul className="task-attachments" aria-label="Files to attach">
              {draft.attachments.map((file) => <li key={file.id} className="task-attachment">
                <span className="task-attachment-icon" aria-hidden="true"><FileIcon /></span>
                <span className="task-attachment-copy"><span title={file.name}>{file.name}</span><small>{formatBytes(file.size_bytes)}</small></span>
                <span />
                <button type="button" className="icon-button" onClick={() => removeFile(file.id)} disabled={creating} aria-label={`Don't attach ${file.name}`} title="Don't attach"><X /></button>
              </li>)}
            </ul>
            : <p className="task-comment-empty">Files upload now and are attached when the card is created.</p>}
        </section>
      </div>

      <footer className="task-composer-footer">
        {fieldError("form")}
        <span className="task-composer-hint">{/Mac|iPhone|iPad/.test(typeof navigator === "undefined" ? "" : navigator.platform) ? "⌘" : "Ctrl"}+Enter creates</span>
        <span className="task-composer-buttons">
          <button type="button" className="secondary-button" onClick={() => { void submit("another"); }} disabled={busy}>Create another</button>
          <button type="button" className="secondary-button" onClick={() => { void submit("open"); }} disabled={busy}>Create and open</button>
          <button type="button" className="primary-button" onClick={() => { void submit("close"); }} disabled={busy} aria-keyshortcuts="Control+Enter Meta+Enter">{creating ? "Creating…" : "Create"}</button>
        </span>
      </footer>
    </section>
    {confirmDiscard && <ConfirmDialog title="Discard this card?" message={draft.attachments.length
      ? `Nothing is saved, and the ${draft.attachments.length === 1 ? "uploaded file moves" : `${draft.attachments.length} uploaded files move`} to your Bin.`
      : "Nothing you entered is saved."} confirmLabel="Discard" danger
      onConfirm={() => {
        setConfirmDiscard(false);
        discardUploads(draftRef.current.attachments.map((file) => file.id));
        onClose();
      }} onCancel={keepEditing} />}
  </>;
}

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ArrowRightLeft, Copy, MessageSquare, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { ApiError } from "../api";
import { NoteEditor } from "../editor/NoteEditor";
import { ConfirmDialog, trapTabKey } from "../files/Dialog";
import { relativeTime } from "../files/format";
import { commentBodyError, validateCardTitle } from "./taskActions";
import {
  createComment,
  deleteComment,
  getCard,
  listComments,
  taskErrorCode,
  taskErrorMessage,
  updateCard,
  updateComment,
  type BoardColumn,
  type CardComment,
  type CardDetail
} from "./tasksApi";
import { useHistoryDialogGuard } from "./useHistoryDialogGuard";

type CardDialogProps = {
  cardId: string;
  columns: BoardColumn[];
  /** The card's column as the board knows it (moves happen on the board). */
  columnId?: string;
  /** The caller owns the board (may delete anyone's comment). */
  boardOwner: boolean;
  onClose: () => void;
  onMissing: () => void;
  onChanged: (card: CardDetail) => void;
  onMove: (card: CardDetail) => void;
  notify: (message: string) => void;
  /** Stores an image pasted or picked into the description (stage C attachments). */
  uploadImage?: (cardId: string, file: File) => Promise<{ src: string; alt: string }>;
};

const payloadCard = (reason: unknown) => reason instanceof ApiError && reason.payload && typeof reason.payload === "object"
  ? (reason.payload as { card?: CardDetail }).card ?? null
  : null;

/**
 * The card at /tasks/:boardId/card/:cardId. It is a view with its own history entry, so Back
 * closes it; the dialogs inside it (delete a comment) push nothing and Back only closes them.
 * The description is Markdown shown through the notes renderer read-only (D44) and edited with
 * an explicit Save; a revision conflict offers Reload or Copy my text.
 */
export function CardDialog({ cardId, columns, columnId, boardOwner, onClose, onMissing, onChanged, onMove, notify, uploadImage }: CardDialogProps) {
  const [card, setCard] = useState<CardDetail | null>(null);
  const [comments, setComments] = useState<CardComment[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<CardDetail | null>(null);
  const [composer, setComposer] = useState("");
  const [posting, setPosting] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [editingComment, setEditingComment] = useState<{ id: string; body: string } | null>(null);
  const [deletingComment, setDeletingComment] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const cardRef = useRef<CardDetail | null>(null);
  cardRef.current = card;
  const titleId = useId();

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const view = await getCard(cardId);
      setCard(view.card);
      setTitle(view.card.title);
      setComments(view.comments);
      setHasMore(view.hasMoreComments);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 404) onMissing();
      else setLoadError(taskErrorMessage(reason, "Could not load this card"));
    }
  }, [cardId, onMissing]);
  useEffect(() => { void load(); }, [load]);

  const closeSubDialog = useCallback(() => setDeletingComment(null), []);
  useHistoryDialogGuard(deletingComment !== null, closeSubDialog);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || deletingComment || editing || editingComment) return;
      // A dialog opened over the card (Move to…) handles its own Escape.
      if (window.document.querySelector(".file-dialog, .side-panel")) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deletingComment, editing, editingComment, onClose]);

  function applyCard(next: CardDetail) {
    setCard(next);
    onChanged(next);
  }

  // The title saves on blur. A concurrent edit elsewhere only moved the revision on: retry once on
  // top of it (the last title wins), which never touches the description.
  async function saveTitle() {
    const current = cardRef.current;
    if (!current) return;
    const check = validateCardTitle(title, current.title);
    if (!check.ok) {
      setTitleError(check.error);
      return;
    }
    setTitleError(null);
    if (!check.changed) {
      setTitle(current.title);
      return;
    }
    try {
      applyCard((await updateCard(current.id, { title: check.name, revision: current.revision })).card);
    } catch (reason) {
      const latest = taskErrorCode(reason) === "CARD_CHANGED" ? payloadCard(reason) : null;
      if (latest) {
        try {
          applyCard((await updateCard(current.id, { title: check.name, revision: latest.revision })).card);
          return;
        } catch (retry) {
          reason = retry;
        }
      }
      setTitle(current.title);
      notify(taskErrorMessage(reason, "Could not rename the card"));
    }
  }

  function startEditing() {
    if (!card) return;
    setDraft(card.description);
    setConflict(null);
    setEditing(true);
  }

  async function saveDescription() {
    const current = cardRef.current;
    if (!current) return;
    setSaving(true);
    try {
      applyCard((await updateCard(current.id, { description: draft, revision: current.revision })).card);
      setEditing(false);
      setConflict(null);
      notify("Description saved");
    } catch (reason) {
      const latest = taskErrorCode(reason) === "CARD_CHANGED" ? payloadCard(reason) : null;
      if (latest) setConflict(latest);
      else notify(taskErrorMessage(reason, "Could not save the description"));
    } finally {
      setSaving(false);
    }
  }

  function reloadFromConflict() {
    if (!conflict) return;
    applyCard(conflict);
    setTitle(conflict.title);
    setDraft(conflict.description);
    setConflict(null);
  }

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(draft);
      notify("Your text is on the clipboard");
    } catch {
      notify("Could not copy. Select the text and copy it yourself.");
    }
  }

  async function loadEarlier() {
    const first = comments[0];
    if (!first) return;
    setLoadingMore(true);
    try {
      const page = await listComments(cardId, first.id);
      setComments((current) => [...page.comments, ...current]);
      setHasMore(page.hasMore);
    } catch (reason) {
      notify(taskErrorMessage(reason, "Could not load earlier comments"));
    } finally {
      setLoadingMore(false);
    }
  }

  async function post() {
    const error = commentBodyError(composer);
    if (error) {
      notify(error);
      return;
    }
    setPosting(true);
    try {
      const { comment } = await createComment(cardId, composer);
      setComments((current) => [...current, comment]);
      setComposer("");
      if (card) onChanged({ ...card, comment_count: card.comment_count + 1 });
    } catch (reason) {
      notify(taskErrorCode(reason) === "LIMIT_REACHED" ? "This card has reached its comment limit" : taskErrorMessage(reason, "Could not post the comment"));
    } finally {
      setPosting(false);
    }
  }

  async function saveComment() {
    if (!editingComment) return;
    const error = commentBodyError(editingComment.body);
    if (error) {
      notify(error);
      return;
    }
    try {
      const { comment } = await updateComment(editingComment.id, editingComment.body);
      setComments((current) => current.map((item) => item.id === comment.id ? comment : item));
      setEditingComment(null);
    } catch (reason) {
      notify(taskErrorMessage(reason, "Could not edit the comment"));
    }
  }

  async function removeComment(commentId: string) {
    setDeleteBusy(true);
    try {
      await deleteComment(commentId);
      setComments((current) => current.filter((item) => item.id !== commentId));
      if (card) onChanged({ ...card, comment_count: Math.max(0, card.comment_count - 1) });
      setDeletingComment(null);
      notify("Comment deleted");
    } catch (reason) {
      setDeletingComment(null);
      notify(taskErrorMessage(reason, "Could not delete the comment"));
    } finally {
      setDeleteBusy(false);
    }
  }

  const column = card ? columns.find((item) => item.id === (columnId ?? card.column_id)) : undefined;
  const composerKey = (event: ReactKeyboardEvent<HTMLTextAreaElement>, submit: () => void) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  };

  return <>
    <button className="panel-scrim task-card-scrim" onClick={onClose} aria-label="Close card" tabIndex={-1} />
    <section className="task-card-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={trapTabKey}>
      <header className="task-card-dialog-header">
        <div className="task-card-dialog-heading">
          <span className="eyebrow">{column ? `In ${column.name}` : "Card"}</span>
          {card
            ? <input
              id={titleId}
              className="task-card-title-input"
              value={title}
              onChange={(event) => { setTitle(event.target.value); setTitleError(null); }}
              onBlur={() => { void saveTitle(); }}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
                if (event.key === "Escape") { event.preventDefault(); setTitle(card.title); setTitleError(null); }
              }}
              aria-label="Card title"
              aria-invalid={titleError ? true : undefined}
              maxLength={200}
            />
            : <h2 id={titleId}>Loading…</h2>}
          {titleError && <p className="file-dialog-error" role="alert">{titleError}</p>}
        </div>
        {card && <button className="icon-button" onClick={() => onMove(card)} aria-haspopup="dialog" aria-label="Move card" title="Move to…"><ArrowRightLeft /></button>}
        <button className="icon-button" onClick={onClose} aria-label="Close card" title="Close"><X /></button>
      </header>

      <div className="task-card-dialog-body">
        {loadError && <div className="bin-state bin-error" role="alert">
          <h2>Could not load this card</h2><p>{loadError}</p>
          <button className="primary-button" onClick={() => { void load(); }}><RotateCcw />Try again</button>
        </div>}
        {!loadError && !card && <p className="bin-loading" role="status">Loading the card…</p>}
        {card && <>
          <p className="task-card-byline">{card.creator_name ? `Added by ${card.creator_name}` : "Added"} · <time dateTime={card.created_at}>{relativeTime(card.created_at)}</time>{card.updated_at !== card.created_at && <> · Updated <time dateTime={card.updated_at}>{relativeTime(card.updated_at)}</time></>}</p>

          <section className="task-card-section" aria-labelledby={`${titleId}-description`}>
            <header><h3 id={`${titleId}-description`}>Description</h3>{!editing && <button className="secondary-button task-small-button" onClick={startEditing}><Pencil />Edit</button>}</header>
            {editing
              ? <div className="task-description-editor">
                <NoteEditor
                  markdown={draft}
                  editable={!saving}
                  onChange={setDraft}
                  onNotice={notify}
                  label="Card description"
                  placeholder="Describe the work… Type / for commands"
                  uploadImage={uploadImage ? (file) => uploadImage(card.id, file) : () => Promise.reject(new Error("Images can't be added to cards yet"))}
                />
                {conflict && <div className="task-conflict" role="alert">
                  <p>Someone else changed this card while you were editing. Reload shows their version and replaces your text.</p>
                  <span>
                    <button className="secondary-button task-small-button" onClick={reloadFromConflict}><RotateCcw />Reload</button>
                    <button className="secondary-button task-small-button" onClick={() => { void copyDraft(); }}><Copy />Copy my text</button>
                  </span>
                </div>}
                <footer className="task-description-actions">
                  <button className="secondary-button" onClick={() => { setEditing(false); setConflict(null); }} disabled={saving}>Cancel</button>
                  <button className="primary-button" onClick={() => { void saveDescription(); }} disabled={saving || conflict !== null}>{saving ? "Saving…" : "Save"}</button>
                </footer>
              </div>
              : card.description.trim()
                ? <div className="task-description-view"><NoteEditor key={`${card.id}:${card.revision}`} markdown={card.description} editable={false} onChange={() => undefined} label="Card description" /></div>
                : <button className="task-description-empty" onClick={startEditing}>Add a description…</button>}
          </section>

          <section className="task-card-section" aria-labelledby={`${titleId}-comments`}>
            <header><h3 id={`${titleId}-comments`}><MessageSquare aria-hidden="true" />Comments</h3></header>
            {hasMore && <button className="task-load-earlier" onClick={() => { void loadEarlier(); }} disabled={loadingMore}>{loadingMore ? "Loading…" : "Load earlier comments"}</button>}
            <ol className="task-comments">
              {comments.map((comment) => <li key={comment.id} className="task-comment">
                <header>
                  <strong>{comment.author_name ?? "Former member"}</strong>
                  <time dateTime={comment.created_at}>{relativeTime(comment.created_at)}</time>
                  {comment.edited_at && <span className="task-comment-edited">edited</span>}
                  <span className="task-comment-actions">
                    {comment.is_author === 1 && editingComment?.id !== comment.id && <button className="icon-button" onClick={() => setEditingComment({ id: comment.id, body: comment.body })} aria-label="Edit comment" title="Edit"><Pencil /></button>}
                    {(comment.is_author === 1 || boardOwner) && <button className="icon-button" onClick={() => setDeletingComment(comment.id)} aria-haspopup="dialog" aria-label="Delete comment" title="Delete"><Trash2 /></button>}
                  </span>
                </header>
                {editingComment?.id === comment.id
                  ? <div className="task-comment-edit">
                    <textarea value={editingComment.body} onChange={(event) => setEditingComment({ id: comment.id, body: event.target.value })} onKeyDown={(event) => {
                      if (event.key === "Escape") { event.preventDefault(); setEditingComment(null); }
                      composerKey(event, () => { void saveComment(); });
                    }} aria-label="Edit comment" autoFocus rows={3} />
                    <span><button className="secondary-button task-small-button" onClick={() => setEditingComment(null)}>Cancel</button><button className="primary-button task-small-button" onClick={() => { void saveComment(); }}>Save</button></span>
                  </div>
                  : <p className="task-comment-body">{comment.body}</p>}
              </li>)}
              {!comments.length && <li className="task-comment-empty">No comments yet.</li>}
            </ol>
            <div className="task-comment-composer">
              <textarea value={composer} onChange={(event) => setComposer(event.target.value)} onKeyDown={(event) => composerKey(event, () => { void post(); })} placeholder="Write a comment" aria-label="Write a comment" rows={2} disabled={posting} />
              <button className="primary-button" onClick={() => { void post(); }} disabled={posting || !composer.trim()}>{posting ? "Posting…" : "Comment"}</button>
            </div>
          </section>
        </>}
      </div>
    </section>
    {deletingComment && <ConfirmDialog title="Delete this comment?" message="The comment is deleted for everyone. This cannot be undone." confirmLabel="Delete comment" danger busy={deleteBusy} onConfirm={() => { void removeComment(deletingComment); }} onCancel={closeSubDialog} />}
  </>;
}

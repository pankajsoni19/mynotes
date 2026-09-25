import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import { Bold, Code2, Italic, Link2, Strikethrough } from "lucide-react";
import { SlashCommands } from "./slash";
import { markdownOptions, noteContentExtensions } from "./extensions";
import { ImageInsert } from "./imageInsert";
import { IMAGE_REJECTED_MESSAGE, isInsertableImageType, uploadNoteImage } from "./imageUpload";
import "./editor.css";

type Props = {
  markdown: string;
  editable: boolean;
  onChange: (markdown: string) => void;
  /** Folder that uploaded images are stored in; null uploads to the Default folder. */
  folderId?: string | null;
  /** Shows a short status message (the app toast). */
  onNotice?: (message: string) => void;
};

export function NoteEditor({ markdown, editable, onChange, folderId = null, onNotice }: Props) {
  // The editor is created once, so the upload handler reads the latest props through a ref.
  const latest = useRef({ folderId, onNotice });
  latest.current = { folderId, onNotice };

  const insertImages = async (activeEditor: Editor, files: File[]) => {
    const notice = (message: string) => latest.current.onNotice?.(message);
    for (const file of files) {
      if (!isInsertableImageType(file.type)) {
        notice(IMAGE_REJECTED_MESSAGE);
        continue;
      }
      notice(`Uploading ${file.name || "image"}…`);
      try {
        const image = await uploadNoteImage(file, latest.current.folderId);
        if (activeEditor.isDestroyed || !activeEditor.isEditable) {
          notice("Image saved to Files, but the note is no longer open for editing");
          continue;
        }
        activeEditor.chain().focus().setImage(image).run();
        notice("Image added");
      } catch (reason) {
        notice(reason instanceof Error ? reason.message : "Image upload failed");
      }
    }
  };

  const editor = useEditor({
    extensions: [
      ...noteContentExtensions(),
      Placeholder.configure({ placeholder: "Start writing… Type / for commands" }),
      Markdown.configure({ markedOptions: markdownOptions }),
      ImageInsert.configure({ onFiles: (activeEditor, files) => { void insertImages(activeEditor, files); } }),
      SlashCommands
    ],
    content: markdown,
    contentType: "markdown",
    editable,
    editorProps: {
      attributes: { class: "note-prose", spellcheck: "true", "aria-label": "Note content" }
    },
    onUpdate: ({ editor: activeEditor }) => onChange(activeEditor.getMarkdown())
  });

  useEffect(() => {
    if (!editor) return;
    // Never emit an update here: Tiptap would report its normalised Markdown as a user change.
    editor.setEditable(editable, false);
  }, [editable, editor]);

  useEffect(() => {
    if (!editor || editor.getMarkdown() === markdown) return;
    editor.commands.setContent(markdown, { contentType: "markdown", emitUpdate: false });
  }, [editor, markdown]);

  if (!editor) return <div className="editor-skeleton" />;

  return (
    <div className="editor-surface">
      {editable && (
        <BubbleMenu editor={editor} className="bubble-menu">
          <button type="button" className={editor.isActive("bold") ? "active" : ""} onClick={() => editor.chain().focus().toggleBold().run()} aria-label="Bold"><Bold /></button>
          <button type="button" className={editor.isActive("italic") ? "active" : ""} onClick={() => editor.chain().focus().toggleItalic().run()} aria-label="Italic"><Italic /></button>
          <button type="button" className={editor.isActive("strike") ? "active" : ""} onClick={() => editor.chain().focus().toggleStrike().run()} aria-label="Strikethrough"><Strikethrough /></button>
          <button type="button" className={editor.isActive("code") ? "active" : ""} onClick={() => editor.chain().focus().toggleCode().run()} aria-label="Inline code"><Code2 /></button>
          <button type="button" onClick={() => {
            const href = window.prompt("Link URL", editor.getAttributes("link").href ?? "https://");
            if (href === null) return;
            if (!href) editor.chain().focus().unsetLink().run();
            else editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
          }} aria-label="Add link"><Link2 /></button>
        </BubbleMenu>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}


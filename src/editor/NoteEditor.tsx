import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Markdown } from "@tiptap/markdown";
import { Bold, Code2, Italic, Link2, Strikethrough } from "lucide-react";
import { SlashCommands } from "./slash";

type Props = {
  markdown: string;
  editable: boolean;
  onChange: (markdown: string) => void;
};

export function NoteEditor({ markdown, editable, onChange }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false, autolink: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: "Start writing… Type / for commands" }),
      Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
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
    editor.setEditable(editable);
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


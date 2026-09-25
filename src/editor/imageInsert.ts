import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { IMAGE_ACCEPT } from "./imageUpload";

export type ImageFilesHandler = (editor: Editor, files: File[]) => void;

type ImageInsertOptions = { onFiles: ImageFilesHandler };

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    imageInsert: {
      /** Opens the system file picker and hands the chosen images to the upload handler. */
      openImagePicker: () => ReturnType;
    };
  }
}

// Office apps and browsers put a rendered snapshot next to rich text; keep the text paste then,
// and only take over when the clipboard holds nothing but the image.
function pastedFiles(data: DataTransfer | null) {
  const files = Array.from(data?.files ?? []);
  if (!files.length || !data) return [];
  const html = data.getData("text/html");
  if (html && new DOMParser().parseFromString(html, "text/html").body.textContent?.trim()) return [];
  return files;
}

// Routes images picked, pasted, or dropped into the note to one upload handler. Nothing is
// inserted here: the handler adds the image node only after the server has stored the file.
export const ImageInsert = Extension.create<ImageInsertOptions>({
  name: "imageInsert",
  addOptions() {
    return { onFiles: () => undefined };
  },
  addCommands() {
    return {
      openImagePicker: () => ({ editor }) => {
        if (typeof document === "undefined") return false;
        const input = document.createElement("input");
        input.type = "file";
        input.accept = IMAGE_ACCEPT;
        input.multiple = true;
        input.addEventListener("change", () => {
          const files = Array.from(input.files ?? []);
          if (files.length) this.options.onFiles(editor, files);
        }, { once: true });
        input.click();
        return true;
      }
    };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    const options = this.options;
    return [
      new Plugin({
        key: new PluginKey("imageInsert"),
        props: {
          handlePaste: (_view, event) => {
            const files = pastedFiles(event.clipboardData);
            if (!files.length || !editor.isEditable) return false;
            event.preventDefault();
            options.onFiles(editor, files);
            return true;
          },
          handleDrop: (view, event, _slice, moved) => {
            if (moved) return false;
            const files = Array.from(event.dataTransfer?.files ?? []);
            if (!files.length || !editor.isEditable) return false;
            event.preventDefault();
            const target = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (target) editor.commands.setTextSelection(target.pos);
            options.onFiles(editor, files);
            return true;
          }
        }
      })
    ];
  }
});

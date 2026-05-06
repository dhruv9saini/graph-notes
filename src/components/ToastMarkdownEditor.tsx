import Editor from "@toast-ui/editor";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export type MarkdownEditorView = "edit" | "split" | "preview";

export type MarkdownEditorHandle = {
  focus: () => void;
  blur: () => void;
  getRoot: () => HTMLDivElement | null;
};

type ToastMarkdownEditorProps = {
  value: string;
  onChange: (next: string) => void;
  view: MarkdownEditorView;
  minHeightPx?: number;
};

const ToastMarkdownEditor = forwardRef<MarkdownEditorHandle, ToastMarkdownEditorProps>(function ToastMarkdownEditor(
  { value, onChange, view, minHeightPx = 220 }: ToastMarkdownEditorProps,
  ref
) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useImperativeHandle(
    ref,
    () => ({
      focus: () => editorRef.current?.focus(),
      blur: () => editorRef.current?.blur?.(),
      getRoot: () => rootRef.current,
    }),
    []
  );

  useEffect(() => {
    if (!mountRef.current) return;

    const editor = new Editor({
      el: mountRef.current,
      initialValue: value ?? "",
      initialEditType: "markdown",
      previewStyle: "vertical",
      usageStatistics: false,
      hideModeSwitch: true,
      theme: "dark",
      autofocus: false,
      height: "100%",
      minHeight: `${minHeightPx}px`,
      events: {
        change: () => {
          onChangeRef.current(editor.getMarkdown());
        },
      },
    });

    editorRef.current = editor;
    return () => {
      editor.destroy();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a") as HTMLAnchorElement | null;
      if (!anchor) return;
      const rawHref = anchor.getAttribute("href");
      if (!rawHref) return;
      const href = rawHref.trim();
      if (!href || href.startsWith("#") || /^javascript:/i.test(href)) return;

      const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href);
      if (!hasScheme) return;
      const protocol = href.split(":")[0]?.toLowerCase();
      if (protocol !== "http" && protocol !== "https") return;

      event.preventDefault();
      event.stopPropagation();
      window.open(href, "_blank", "noopener,noreferrer");
    };

    root.addEventListener("click", handleClick);
    return () => root.removeEventListener("click", handleClick);
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const current = editor.getMarkdown();
    if (current === (value ?? "")) return;
    editor.setMarkdown(value ?? "", false);
  }, [value]);

  return (
    <div ref={rootRef} className={`notes-editor notes-toast-editor view-${view}`}>
      <div ref={mountRef} />
    </div>
  );
});

export default ToastMarkdownEditor;

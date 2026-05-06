declare module "@toast-ui/editor" {
  export type EditorType = "markdown" | "wysiwyg";
  export type PreviewStyle = "vertical" | "tab";

  export type EditorOptions = {
    el: HTMLElement;
    initialValue?: string;
    initialEditType?: EditorType;
    previewStyle?: PreviewStyle;
    height?: string;
    minHeight?: string;
    usageStatistics?: boolean;
    hideModeSwitch?: boolean;
    theme?: string;
    autofocus?: boolean;
    events?: Record<string, (...args: unknown[]) => void>;
  };

  export default class Editor {
    constructor(options: EditorOptions);
    getMarkdown(): string;
    setMarkdown(markdown: string, cursorToEnd?: boolean): void;
    setHeight(height: string): void;
    setMinHeight(minHeight: string): void;
    changeMode(type: EditorType, withoutFocus?: boolean): void;
    focus(): void;
    blur(): void;
    destroy(): void;
  }
}

// Page-realm shapes for execute() callbacks, imported with `import type` and cast inline: callbacks are serialized
// into the page, where a runtime helper is undefined, and the e2e tsconfig omits DOM because specs run in Node.

export type PageElement = { id: string; textContent: string | null };
// `pointerType` and `isPrimary` are set only on PointerEvents.
export type PageMouseEventFields = {
  type: string;
  button: number;
  buttons: number;
  pointerType?: string;
  isPrimary?: boolean;
};
export type PageMouseEvent = PageMouseEventFields & { preventDefault(): void };
export type PageDocument = {
  getElementById(id: string): PageElement | null;
  addEventListener(type: string, listener: (event: PageMouseEvent) => void, capture?: boolean): void;
  removeEventListener(type: string, listener: (event: PageMouseEvent) => void, capture?: boolean): void;
};
export type PageWindow = { document: PageDocument };

const COPIED = [
  "boxSizing", "width", "overflowX", "overflowY", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "fontStyle", "fontVariant", "fontWeight", "fontStretch",
  "fontSize", "fontFamily", "lineHeight", "textAlign", "textTransform", "textIndent", "letterSpacing", "wordSpacing", "tabSize",
] as const;

/**
 * Where the caret sits inside a textarea, in pixels from the textarea's top-left corner (scrolling included),
 * plus the line height. Measured on a hidden copy of the text, since textareas do not report it.
 */
export function caretPosition(el: HTMLTextAreaElement, index: number): { left: number; top: number; height: number } {
  const style = getComputedStyle(el);
  const mirror = document.createElement("div");
  for (const p of COPIED) mirror.style[p as never] = style[p as never];
  Object.assign(mirror.style, { position: "absolute", visibility: "hidden", top: "0", left: "-9999px", whiteSpace: "pre-wrap", overflowWrap: "break-word" });
  mirror.textContent = el.value.slice(0, index);
  const marker = document.createElement("span");
  marker.textContent = el.value.slice(index) || ".";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const height = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4 || 18;
  const pos = {
    left: marker.offsetLeft + parseFloat(style.borderLeftWidth || "0") - el.scrollLeft,
    top: marker.offsetTop + parseFloat(style.borderTopWidth || "0") - el.scrollTop,
    height,
  };
  document.body.removeChild(mirror);
  return pos;
}

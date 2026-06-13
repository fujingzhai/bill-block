/** 跟随宿主思源的明暗主题；独立打开时保持浅色默认值 */
export function syncTheme(): void {
  try {
    const pdoc = window.parent.document;
    const dark = pdoc.documentElement.getAttribute("data-theme-mode") === "dark";
    document.documentElement.classList.toggle("dark", dark);
    const pstyle = window.parent.getComputedStyle(pdoc.body);
    document.documentElement.style.setProperty("--siyuan-font-family", pstyle.fontFamily);
    document.documentElement.style.setProperty("--siyuan-font-size", pstyle.fontSize);
  } catch {
    // 非同源（独立调试）时忽略
  }
}

/** 把当前挂件高度（含 iframe 与其所在块元素）设为指定像素值 */
export function setWidgetHeight(px: number): void {
  try {
    const frame = window.frameElement as HTMLElement | null;
    if (!frame) return;
    frame.style.height = `${px}px`;
    const blockEl = frame.closest("[data-node-id]") as HTMLElement | null;
    if (blockEl) blockEl.style.height = `${px}px`;
  } catch {
    // 忽略
  }
}

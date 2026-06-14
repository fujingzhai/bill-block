import { LedgerStore } from "../shared/store";
import { getBlockAttrs } from "../shared/api";
import { watchTheme } from "./theme";
import { showError } from "./ui";
import { mountBillApp, WEEK_ATTR, MONTH_ATTR, SORT_BY_ATTR, SORT_ORDER_ATTR } from "./views/app";
import type { SortKey, SortDir } from "../shared/model";
import { mountQuickAdd } from "./views/quickadd";

export interface ViewHandle {
  /** 数据被其他块改写后的重绘；编辑中可自行跳过 */
  render(): void;
}

const root = document.getElementById("app") as HTMLElement;
const params = new URLSearchParams(location.search);
const view = params.get("view") || "ledger";
const panel = params.get("mode") === "panel";
const UI_CHANNEL = "bill-block-ui";

/** 取挂件所在块的 ID（用于读写本块的默认周/月等设置） */
function resolveBlockId(): string {
  try {
    const frame = window.frameElement as HTMLElement | null;
    const blockEl = frame?.closest("[data-node-id]") as HTMLElement | null;
    return blockEl?.getAttribute("data-node-id") || "";
  } catch {
    return "";
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target instanceof HTMLElement ? target : null;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
}

function postUiMessage(message: Record<string, unknown>): void {
  try {
    const channel = new BroadcastChannel(UI_CHANNEL);
    channel.postMessage(message);
    channel.close();
  } catch {
    // BroadcastChannel 不可用时忽略
  }
}

function isQuickAddShortcut(event: KeyboardEvent): boolean {
  return !event.metaKey
    && !event.altKey
    && !event.ctrlKey
    && !event.shiftKey
    && event.key.toLowerCase() === "b";
}

function installQuickAddShortcutBridge(): void {
  document.addEventListener("keydown", (event) => {
    if (isEditableTarget(event.target)) return;
    if (!isQuickAddShortcut(event)) return;
    event.preventDefault();
    event.stopPropagation();
    postUiMessage({ type: "quickadd-open" });
  }, true);
}

(async function init() {
  watchTheme();

  const store = new LedgerStore();
  try {
    await store.load();
  } catch (err) {
    showError(root, err);
    // 读取失败也继续挂载轮询，等待自愈
  }

  let handle: ViewHandle;
  if (view === "quickadd") {
    handle = mountQuickAdd(root, store);
  } else {
    installQuickAddShortcutBridge();
    const initial = view === "calendar" ? "month" : view === "stats" ? "stats" : "flow";
    const blockId = resolveBlockId();
    const attrs = blockId ? await getBlockAttrs(blockId) : {};
    handle = mountBillApp(root, store, {
      initial,
      blockId,
      anchorWeek: attrs[WEEK_ATTR] || "",
      anchorMonth: attrs[MONTH_ATTR] || "",
      sortBy: (attrs[SORT_BY_ATTR] as SortKey) || undefined,
      sortOrder: (attrs[SORT_ORDER_ATTR] as SortDir) || undefined,
      panel
    });
  }

  store.onRemoteChange = () => handle.render();
  store.startAutoRefresh();

  // Cmd/Ctrl+Z 撤销最近一次账单操作
  document.addEventListener("keydown", async (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      e.preventDefault();
      try {
        if (await store.undo()) handle.render();
      } catch {
        // 数据未加载时忽略
      }
    }
  });
})();

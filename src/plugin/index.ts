import { Dialog, Menu, Plugin, Protyle, fetchPost, getActiveEditor, getAllEditor, openTab, showMessage } from "siyuan";

const BLOCK_HEIGHT = 520;
const PANEL_TAB = "billPanel";

interface ApiResponse<T = unknown> {
  code: number;
  msg: string;
  data: T;
}

interface BlockOperation {
  doOperations?: Array<{ id?: string }>;
}

interface BlockRow {
  id: string;
  root_id: string;
  type: string;
}

interface InsertContext {
  blockID: string;
  docID: string;
}

export default class BillBlockPlugin extends Plugin {
  private topBarElement?: HTMLElement;
  private quickDialog: Dialog | null = null;
  private uiChannel: BroadcastChannel | null = null;

  onload() {
    this.addIcons(`
      <symbol id="iconBillBlock" viewBox="0 0 32 32">
        <path d="M16 3a13 13 0 1 1 0 26 13 13 0 0 1 0-26Zm0 2.5A10.5 10.5 0 1 0 26.5 16 10.5 10.5 0 0 0 16 5.5Z"></path>
        <path d="M11.2 9.5 16 14.3l4.8-4.8 1.7 1.7-3.8 3.8H22v2h-5v1.6h5v2h-5V25h-2v-4.4h-5v-2h5V17h-5v-2h3.3l-3.8-3.8 1.7-1.7Z"></path>
      </symbol>
    `);

    this.topBarElement = this.addTopBar({
      icon: "iconBillBlock",
      title: "记账块",
      position: "right",
      callback: (event) => this.openTopBarMenu(event)
    });

    // 独立记账面板：在标签页里放大显示同一套挂件（mode=panel）。
    // 用 SiYuan 的 flex 填充类（fn__flex* ）让 iframe 从确定高度的标签页拿到确定高度，
    // 避免 iframe 在 height:100% 下解析不出高度而跟随内容无限膨胀。
    this.addTab({
      type: PANEL_TAB,
      init() {
        this.element.innerHTML = `<div class="fn__flex fn__flex-column fn__flex-1">
          <iframe class="fn__flex-1" allowfullscreen src="/plugins/bill-block/widget/index.html?mode=panel"
            style="border:0;width:100%;min-height:0;display:block;background:transparent;"></iframe>
        </div>`;
      }
    });

    this.protyleSlash = [{
      id: "bill-block",
      filter: ["记账块", "记账", "账单", "jizhang", "zhangdan", "expense", "ledger"],
      html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconBillBlock"></use></svg><span class="b3-list-item__text">插入记账块</span></div>`,
      callback: (protyle: Protyle, nodeElement: HTMLElement) => {
        this.insertFromSlash(protyle, nodeElement);
      }
    }];

    this.addCommand({
      langKey: "billQuickAdd",
      langText: "快速记一笔",
      hotkey: "⌥⌘B",
      callback: () => this.openQuickAdd()
    });
    this.addCommand({
      langKey: "insertBillBlock",
      langText: "插入记账块",
      hotkey: "",
      callback: () => this.insertAtCursor()
    });

    // 监听快记弹窗的保存/取消消息
    try {
      this.uiChannel = new BroadcastChannel("bill-block-ui");
      this.uiChannel.onmessage = (e) => {
        const msg = e.data || {};
        if (msg.type === "quickadd-saved") {
          showMessage(msg.text || "已记一笔", 3000);
          this.closeQuickAdd();
        } else if (msg.type === "quickadd-cancel") {
          this.closeQuickAdd();
        } else if (msg.type === "quickadd-open") {
          this.openQuickAdd();
        }
      };
    } catch {
      this.uiChannel = null;
    }
  }

  onunload() {
    this.uiChannel?.close();
    this.closeQuickAdd();
  }

  private openQuickAdd() {
    this.closeQuickAdd();
    this.quickDialog = new Dialog({
      title: "",
      content: `<iframe src="/plugins/bill-block/widget/index.html?view=quickadd"
        style="width:100%;height:188px;border:0;display:block;border-radius:8px;" allowfullscreen></iframe>`,
      width: "440px",
      destroyCallback: () => {
        this.quickDialog = null;
      }
    });
  }

  private closeQuickAdd() {
    this.quickDialog?.destroy();
    this.quickDialog = null;
  }

  private openPanel() {
    openTab({
      app: this.app,
      custom: {
        id: this.name + PANEL_TAB,
        icon: "iconBillBlock",
        title: "记账",
        data: {}
      }
    });
  }

  private openTopBarMenu(event: MouseEvent) {
    const context = getCurrentContext();
    const menu = new Menu("bill-block-topbar");
    menu.addItem({
      icon: "iconBillBlock",
      label: "快速记一笔",
      accelerator: "⌥⌘B",
      click: () => this.openQuickAdd()
    });
    menu.addSeparator();
    menu.addItem({
      icon: "iconBillBlock",
      label: "插入记账块",
      click: () => this.insertAtCursor(context)
    });
    menu.addSeparator();
    menu.addItem({
      icon: "iconBillBlock",
      label: "打开记账面板",
      click: () => this.openPanel()
    });
    const rect = this.menuAnchorRect(event);
    menu.open({ x: rect.left, y: rect.bottom, w: rect?.width, h: rect?.height });
  }

  private menuAnchorRect(event: MouseEvent): DOMRect {
    if (event.clientX > 0 && event.clientY > 0) {
      const size = 28;
      return new DOMRect(event.clientX - size / 2, event.clientY - size / 2, size, size);
    }
    const target = event.target instanceof Element
      ? event.target.closest("button,[data-type],.toolbar__item,.b3-menu__item") || event.target
      : null;
    const candidates = [
      target,
      event.currentTarget instanceof Element ? event.currentTarget : null,
      this.topBarElement || null,
      this.findPluginMenuAnchor()
    ];
    for (const el of candidates) {
      const rect = el?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0) {
        return rect;
      }
    }
    const fallbackSize = 28;
    return new DOMRect(Math.max(window.innerWidth - fallbackSize - 12, 0), 8, fallbackSize, fallbackSize);
  }

  private findPluginMenuAnchor(): HTMLElement | null {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(
      [
        ".toolbar__item",
        "button",
        "[data-type]"
      ].join(",")
    ));
    let best: { el: HTMLElement; score: number } | null = null;
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.right <= 0) {
        continue;
      }
      if (rect.top > 96 || rect.left < window.innerWidth / 2) {
        continue;
      }
      const label = [
        el.getAttribute("aria-label"),
        el.getAttribute("title"),
        el.getAttribute("data-type"),
        el.textContent
      ].filter(Boolean).join(" ").toLowerCase();
      const isPluginButton = label.includes("插件") || label.includes("plugin") || label.includes("plugins");
      const score = rect.right + (isPluginButton ? 10000 : 0);
      if (!best || score > best.score) {
        best = { el, score };
      }
    }
    return best?.el || null;
  }

  /** 斜杠菜单使用编辑器原生插入，避免先插入再延迟删除触发块造成闪烁 */
  private insertFromSlash(protyle: Protyle, nodeElement: HTMLElement) {
    const context = contextFromProtyle(protyle, nodeElement);
    try {
      protyle.insert(widgetMarkdown(), true, true);
    } catch (err) {
      console.error("bill-block: protyle.insert 失败，回退到内核插入", err);
      this.insertAtCursor(context);
    }
  }

  /** 在光标所在块下方插入挂件块；找不到光标时追加到当前文档末尾 */
  private async insertAtCursor(context = getCurrentContext()) {
    const docID = await resolveDocID(context);
    if (!docID) {
      showMessage("请先把光标放进文档", 5000, "error");
      return;
    }
    try {
      const previousID = context.blockID && context.blockID !== docID ? context.blockID : undefined;
      const operations = await insertWidgetBlock(docID, previousID);
      const insertedID = operations?.[0]?.doOperations?.[0]?.id || "";
      if (isBlockID(insertedID)) {
        await post("/api/attr/setBlockAttrs", {
          id: insertedID,
          attrs: { "custom-bill-block": "true", style: `height: ${BLOCK_HEIGHT}px;` }
        });
      }
    } catch (err) {
      showMessage(`插入失败：${err instanceof Error ? err.message : err}`, 6000, "error");
    }
  }
}

function widgetMarkdown(): string {
  const src = "/plugins/bill-block/widget/index.html";
  // 与日程块保持一致：iframe 不写内联宽高，宽度交给思源挂件块默认（与日程块同宽），高度由挂件内部按内容设定
  return `<iframe src="${src}" data-subtype="widget" border="0" frameborder="no" framespacing="0" allowfullscreen="true"></iframe>`;
}

async function insertWidgetBlock(docID: string, previousID?: string): Promise<BlockOperation[]> {
  const payload: Record<string, unknown> = {
    dataType: "markdown",
    data: widgetMarkdown(),
    parentID: docID
  };
  if (previousID) {
    payload.previousID = previousID;
  }
  return post<BlockOperation[]>("/api/block/insertBlock", payload);
}

function post<T>(url: string, data?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    fetchPost(url, data, (response: ApiResponse<T>) => {
      if (response.code !== 0) {
        reject(new Error(response.msg || `${url} 调用失败`));
        return;
      }
      resolve(response.data);
    });
  });
}

async function resolveDocID(context: InsertContext): Promise<string> {
  const candidates = [context.blockID, context.docID].filter(isBlockID);
  for (const id of candidates) {
    const rows = await post<BlockRow[]>("/api/query/sql", {
      stmt: `SELECT id, root_id, type FROM blocks WHERE id='${id}' LIMIT 1`
    });
    const row = rows?.[0];
    if (!row) {
      continue;
    }
    if (row.type === "d" && isBlockID(row.id)) {
      return row.id;
    }
    if (isBlockID(row.root_id)) {
      return row.root_id;
    }
  }
  return "";
}

function contextFromProtyle(protyle: Protyle | undefined, nodeElement?: HTMLElement | null): InsertContext {
  const blockID = nodeElement?.dataset?.nodeId || "";
  const docID = protyle?.protyle?.block?.rootID || "";
  return {
    blockID: isBlockID(blockID) ? blockID : "",
    docID: isBlockID(docID) ? docID : ""
  };
}

function getCurrentContext(): InsertContext {
  let activeEditor: Protyle | undefined;
  try {
    activeEditor = getActiveEditor(false) || getAllEditor()?.[0];
  } catch {
    activeEditor = undefined;
  }
  const activeDocID = activeEditor?.protyle?.block?.rootID || "";
  const blockID = getCurrentBlockID(activeEditor);
  return {
    blockID,
    docID: isBlockID(activeDocID) ? activeDocID : ""
  };
}

function getBlockIDFromRange(range: Range | null | undefined): string {
  if (!range) return "";
  const node = range.startContainer;
  const element = node instanceof Element ? node : node?.parentElement;
  const blockEl = element?.closest?.("[data-node-id]") as HTMLElement | null;
  const blockID = blockEl?.getAttribute("data-node-id") || "";
  return isBlockID(blockID) ? blockID : "";
}

function getCurrentBlockID(activeEditor?: any): string {
  if (activeEditor) {
    const range = activeEditor.protyle?.toolbar?.range;
    const rangeBlockID = getBlockIDFromRange(range);
    if (isBlockID(rangeBlockID)) {
      return rangeBlockID;
    }
    const wysiwyg = activeEditor.protyle?.wysiwyg?.element;
    if (wysiwyg) {
      const selectors = [
        ".protyle-wysiwyg--active",
        ".protyle-wysiwyg--select",
        "[contenteditable='true']:focus",
        ":focus-within"
      ];
      for (const selector of selectors) {
        const el = wysiwyg.querySelector(selector);
        const block = el?.closest("[data-node-id]");
        const blockID = block?.getAttribute("data-node-id") || "";
        if (isBlockID(blockID)) {
          return blockID;
        }
      }
    }
    const selectEl = activeEditor.protyle?.selectElement;
    const selectID = selectEl?.getAttribute("data-node-id") || "";
    if (isBlockID(selectID)) {
      return selectID;
    }
    const docID = activeEditor.protyle?.block?.rootID || "";
    const blockID = activeEditor.protyle?.block?.id || "";
    if (isBlockID(blockID) && blockID !== docID) {
      return blockID;
    }
  }
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const selBlockID = getBlockIDFromRange(selection.getRangeAt(0));
    if (isBlockID(selBlockID)) {
      return selBlockID;
    }
  }
  const active = document.activeElement instanceof HTMLElement
    ? (document.activeElement.closest("[data-node-id]") as HTMLElement | null)
    : null;
  const activeID = active?.dataset?.nodeId || "";
  return isBlockID(activeID) ? activeID : "";
}

function isBlockID(value: string): boolean {
  return /^\d{14}-[a-z0-9]{7}$/.test(value);
}

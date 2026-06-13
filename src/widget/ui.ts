import { LedgerStore } from "../shared/store";
import { Tx, dateStr, fmtMoney, parseDate, todayStr } from "../shared/model";

/** 在 YYYY-MM-DD 基础上偏移若干天 */
function shiftDateStr(s: string, delta: number): string {
  const d = parseDate(s || todayStr());
  d.setDate(d.getDate() + delta);
  return dateStr(d);
}

export const ICONS = {
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  del: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>`,
  /** 真正的齿轮图标：分类管理按钮 */
  cog: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.4 13c.04-.33.06-.66.06-1s-.02-.67-.06-1l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.73-1l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.62.25-1.2.59-1.73 1l-2.39-.96a.5.5 0 0 0-.6.22L2.45 8.78a.5.5 0 0 0 .12.64L4.6 11c-.04.33-.06.66-.06 1s.02.67.06 1l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.53.41 1.11.75 1.73 1l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.62-.25 1.2-.59 1.73-1l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64L19.4 13ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"/></svg>`,
  /** 滑杆/锚定图标：周月默认时间设置按钮 */
  sliders: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/><circle cx="14" cy="6" r="2.4" fill="var(--card)"/><circle cx="8" cy="12" r="2.4" fill="var(--card)"/><circle cx="16" cy="18" r="2.4" fill="var(--card)"/></svg>`,
  /** 六点拖拽柄（2 列 × 3 行） */
  grip: `<svg viewBox="0 0 10 16" fill="currentColor"><circle cx="2.5" cy="3" r="1.3"/><circle cx="7.5" cy="3" r="1.3"/><circle cx="2.5" cy="8" r="1.3"/><circle cx="7.5" cy="8" r="1.3"/><circle cx="2.5" cy="13" r="1.3"/><circle cx="7.5" cy="13" r="1.3"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>`,
  /** 相机图标：保存当前视图为图片 */
  camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h3l1.5-2h7L17 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z"/><circle cx="12" cy="12.5" r="3.2"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  /** 日历图标：日期步进器的取期按钮 */
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="2.5" x2="8" y2="6"/><line x1="16" y1="2.5" x2="16" y2="6"/></svg>`
};

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

/** 浮层式两级分类选择器。返回按钮元素；选中回调里拿到 catId */
export function catPicker(store: LedgerStore, initial: string, onPick: (catId: string) => void): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "cat-pick";
  let current = initial;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cat-pick-btn";
  const paint = () => {
    const c = store.cat(current);
    btn.innerHTML = `<span class="dot" style="background:${c.color}"></span>${esc(store.catLabel(current))} <span style="color:var(--fg-faint)">▾</span>`;
  };
  paint();
  wrap.appendChild(btn);

  btn.addEventListener("click", () => {
    closeMenus();
    const menu = document.createElement("div");
    menu.className = "cat-menu";
    for (const { parent, children } of store.catTree()) {
      menu.appendChild(item(parent.id, parent.name, parent.color, false));
      for (const ch of children) {
        menu.appendChild(item(ch.id, ch.name, ch.color, true));
      }
    }
    menu.addEventListener("mousedown", (e) => e.stopPropagation());
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect();
    const mh = Math.min(menu.scrollHeight, 290);
    const below = window.innerHeight - r.bottom;
    menu.style.left = `${Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)}px`;
    menu.style.top = below > mh + 8 || below > r.top
      ? `${r.bottom + 4}px`
      : `${Math.max(4, r.top - mh - 4)}px`;
    const close = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        menu.remove();
        document.removeEventListener("mousedown", close, true);
      }
    };
    document.addEventListener("mousedown", close, true);

    function item(id: string, name: string, color: string, child: boolean): HTMLElement {
      const el = document.createElement("button");
      el.type = "button";
      el.className = `cat-menu-item${child ? " child" : ""}${id === current ? " on" : ""}`;
      el.innerHTML = `<span class="dot" style="background:${color}"></span>${esc(name)}`;
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        current = id;
        paint();
        menu.remove();
        onPick(id);
      });
      return el;
    }
  });

  return wrap;
}

function closeMenus(): void {
  document.querySelectorAll(".cat-menu").forEach((m) => m.remove());
}

export interface TxFormResult {
  amount: number;
  project: string;
  catId: string;
  note: string;
  date: string;
}

/** 记账表单行（快记与行内编辑共用）。submit 返回 false 表示校验未通过 */
export function txForm(
  store: LedgerStore,
  init: Partial<Tx>,
  opts: { submitLabel: string; showDate?: boolean; showCancel?: boolean; dateStepper?: boolean; onSubmit: (v: TxFormResult) => void; onCancel?: () => void }
): HTMLElement {
  const row = document.createElement("div");
  row.className = "quick-row";

  const project = document.createElement("input");
  project.className = "q-project";
  project.placeholder = "项目";
  project.value = init.project || "";
  project.required = true;

  const amount = document.createElement("input");
  amount.className = "q-amount";
  amount.placeholder = `金额`;
  amount.inputMode = "decimal";
  if (init.amount) amount.value = String(init.amount);

  let catId = init.catId ?? defaultCatId(store);
  const picker = catPicker(store, catId, (id) => { catId = id; });

  const note = document.createElement("input");
  note.className = "q-note";
  note.placeholder = "备注（可选）";
  note.value = init.note || "";

  const date = document.createElement("input");
  date.className = "q-date";
  date.type = "date";
  date.value = init.date || todayStr();

  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "q-add";
  submit.textContent = opts.submitLabel;

  const doSubmit = () => {
    const projectText = project.value.trim();
    if (!projectText) {
      project.focus();
      return;
    }
    const v = parseFloat(amount.value);
    if (!Number.isFinite(v) || v <= 0) {
      amount.focus();
      return;
    }
    opts.onSubmit({ amount: Math.round(v * 100) / 100, project: projectText, catId, note: note.value.trim(), date: date.value || todayStr() });
  };
  submit.addEventListener("click", doSubmit);
  for (const el of [project, amount, note, date]) {
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doSubmit();
      if (e.key === "Escape" && opts.onCancel) opts.onCancel();
    });
  }

  row.append(picker, project, amount, note);
  if (opts.showDate !== false) {
    if (opts.dateStepper) {
      const group = document.createElement("div");
      group.className = "q-date-group";
      const prev = document.createElement("button");
      prev.type = "button";
      prev.className = "q-date-step";
      prev.textContent = "‹";
      prev.title = "前一天";
      prev.addEventListener("click", () => { date.value = shiftDateStr(date.value, -1); });
      const next = document.createElement("button");
      next.type = "button";
      next.className = "q-date-step";
      next.textContent = "›";
      next.title = "后一天";
      next.addEventListener("click", () => { date.value = shiftDateStr(date.value, 1); });
      // 日历图标按钮：放在「›」右侧，点击唤起原生日期选择器（隐藏 input 内置图标，顺序为 ‹ 日期 › 📅）
      date.classList.add("q-date-stepper");
      const cal = document.createElement("button");
      cal.type = "button";
      cal.className = "q-date-cal";
      cal.innerHTML = ICONS.calendar;
      cal.title = "选择日期";
      cal.addEventListener("click", () => {
        const d = date as HTMLInputElement & { showPicker?: () => void };
        if (typeof d.showPicker === "function") d.showPicker();
        else { date.focus(); date.click(); }
      });
      group.append(prev, date, next, cal);
      row.append(group);
    } else {
      row.append(date);
    }
  }
  row.append(submit);
  if (opts.onCancel && opts.showCancel !== false) {
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "nav-btn";
    cancel.textContent = "✕";
    cancel.title = "取消";
    cancel.addEventListener("click", opts.onCancel);
    row.append(cancel);
  }
  return row;
}

function defaultCatId(store: LedgerStore): string {
  const last = store.txs[store.txs.length - 1];
  if (last && store.cat(last.catId).id) return last.catId;
  const first = store.catTree()[0];
  return first ? first.parent.id : "";
}

/** 单条流水行（账本块与月历明细共用） */
export function txRow(
  store: LedgerStore,
  tx: Tx,
  opts: { onEdit: (tx: Tx, rowEl: HTMLElement) => void; onDelete: (tx: Tx) => void }
): HTMLElement {
  const cat = store.cat(tx.catId);
  const row = document.createElement("div");
  row.className = "tx-row";
  row.innerHTML = `
    <span class="tx-cat-col">
      <span class="dot" style="background:${cat.color}"></span>
      <span class="tx-cat">${esc(store.catLabel(tx.catId))}</span>
    </span>
    <span class="tx-project">${esc(tx.project || "未填项目")}</span>
    <span class="tx-amt">${esc(store.currency)}${fmtMoney(tx.amount)}</span>
    <span class="tx-note">${esc(tx.note)}</span>
    <span class="tx-ops">
      <button class="tx-op" title="编辑">${ICONS.edit}</button>
      <button class="tx-op del" title="删除">${ICONS.del}</button>
    </span>`;
  const [editBtn, delBtn] = row.querySelectorAll<HTMLButtonElement>(".tx-op");
  row.addEventListener("dblclick", (e) => {
    if ((e.target as HTMLElement).closest(".tx-op")) return;
    opts.onEdit(tx, row);
  });
  editBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    opts.onEdit(tx, row);
  });
  delBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    opts.onDelete(tx);
  });
  return row;
}

export function showError(root: HTMLElement, err: unknown): void {
  root.innerHTML = `<div class="load-error">⚠ ${esc(err instanceof Error ? err.message : String(err))}</div>`;
}

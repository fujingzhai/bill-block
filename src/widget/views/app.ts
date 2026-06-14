import { LedgerStore } from "../../shared/store";
import {
  Dim,
  PALETTE,
  Tx,
  dateStr,
  fmtMoney,
  isHexColor,
  isoWeek,
  parseDate,
  periodLabel,
  periodStart,
  shiftPeriod,
  SortKey,
  SortDir,
  todayStr,
  WEEKDAYS,
  weekLabel
} from "../../shared/model";
import { setBlockAttrs } from "../../shared/api";
import { setWidgetHeight } from "../theme";
import { ICONS, esc, showError, txForm, txRow } from "../ui";
import type { ViewHandle } from "../main";
import html2canvas from "html2canvas";

interface TrendRow { name: string; tip: string; amount: number; }

/** 高度配对：两两取较高者，使流水≈周账、月账≈统计 */
/** 额外留白，消除“差一点点”导致的滚动条 */
const HEIGHT_BUFFER = 18;

/** 本块默认周（周一日期）与默认月（当月 1 号）写在块属性里，跨重载保留 */
export const WEEK_ATTR = "custom-bill-week";
export const MONTH_ATTR = "custom-bill-month";

export interface AppOptions {
  initial?: MainView;
  blockId?: string;
  /** 默认周的周一日期（YYYY-MM-DD），空表示未设定 */
  anchorWeek?: string;
  /** 默认月的当月 1 号日期（YYYY-MM-DD），空表示未设定 */
  anchorMonth?: string;
}

type MainView = "flow" | "week" | "month" | "stats";
type SortMode = "default" | "amount-desc" | "amount-asc";
type LineUnit = "day" | "week" | "month" | "year";

const VIEW_LABEL: Record<MainView, string> = {
  flow: "流水",
  week: "周账",
  month: "月账",
  stats: "统计"
};

const VIEWS: MainView[] = ["flow", "week", "month", "stats"];

const LINE_UNIT_LABEL: Record<LineUnit, string> = {
  day: "按日",
  week: "按周",
  month: "按月",
  year: "按年"
};

const pctStr = (p: number) => (p <= 0 ? "0%" : p < 0.01 ? "<1%" : `${(p * 100).toFixed(0)}%`);

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function rangeEnd(start: Date, dim: Dim): Date {
  return addDays(shiftPeriod(start, dim, 1), -1);
}

function inRange(t: Tx, start: string, end: string): boolean {
  return (!start || t.date >= start) && (!end || t.date <= end);
}

function samePeriod(date: string, start: Date, dim: Dim): boolean {
  return periodStart(parseDate(date), dim).getTime() === start.getTime();
}

function defaultRange(): { start: string; end: string } {
  return { start: "", end: "" };
}

function rangeLabel(start: string, end: string): string {
  return start === end ? start : `${start} 至 ${end}`;
}

function unitStart(date: string, unit: LineUnit): Date {
  const d = parseDate(date);
  if (unit === "day") return d;
  if (unit === "week" || unit === "month" || unit === "year") return periodStart(d, unit);
  return d;
}

function shiftUnit(start: Date, unit: LineUnit, n: number): Date {
  if (unit === "day") return addDays(start, n);
  return shiftPeriod(start, unit, n);
}

function unitLabel(start: Date, unit: LineUnit): string {
  if (unit === "day") return `${start.getMonth() + 1}/${start.getDate()}`;
  if (unit === "week") {
    const { year, week } = isoWeek(start);
    return `${year}W${week}`;
  }
  if (unit === "year") return String(start.getFullYear());
  return `${start.getFullYear()}/${start.getMonth() + 1}`;
}

function catKey(store: LedgerStore, tx: Tx): string {
  return store.topCat(tx.catId).id;
}

function catName(store: LedgerStore, id: string): string {
  return id ? store.cat(id).name : "未分类";
}

/**
 * 排序：日期始终降序（新的在前）；同一天内部按用户在「排序管理」里的选择排序。
 * - category：依分类拖拽顺序（store.cats 数组次序），不区分升降
 * - amount / created：按金额或创建时间，asc 升序 / desc 降序
 * 排序仅作用于「同一个时间格子」内（流水的每个日期分组、周/月的每个日格）。
 */
function txsSorted(store: LedgerStore, txs: Tx[]): Tx[] {
  const by = store.sortBy;
  const dir = store.sortOrder;
  const sign = dir === "asc" ? 1 : -1;
  const catOrder = (id: string): number => {
    const idx = store.cats.findIndex((c) => c.id === id);
    return idx < 0 ? Number.MAX_SAFE_INTEGER : idx;
  };
  const within = (a: Tx, b: Tx): number => {
    let cmp = 0;
    if (by === "category") {
      // 类别排序固定按拖拽顺序，不随升降切换
      cmp = catOrder(a.catId) - catOrder(b.catId);
      if (cmp === 0) return b.created - a.created;
      return cmp;
    }
    if (by === "amount") cmp = a.amount - b.amount;
    else cmp = a.created - b.created;
    if (cmp === 0) cmp = a.created - b.created;
    return cmp * sign;
  };
  return [...txs].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : within(a, b)));
}

function rangeTxs(store: LedgerStore, start: string, end: string): Tx[] {
  return store.txs.filter((t) => (!start || t.date >= start) && (!end || t.date <= end));
}

function effectiveRange(store: LedgerStore, range: { start: string; end: string }): { start: string; end: string } {
  if (!store.txs.length) return { start: "", end: "" };
  const dates = store.txs.map((t) => t.date).sort();
  return { start: range.start || dates[0], end: range.end || dates[dates.length - 1] };
}

function aggregateCats(store: LedgerStore, txs: Tx[]): Array<{ id: string; name: string; color: string; amount: number; pct: number }> {
  const total = txs.reduce((s, t) => s + t.amount, 0);
  const map = new Map<string, { name: string; color: string; amount: number }>();
  for (const { parent } of store.catTree()) {
    map.set(parent.id, { name: parent.name, color: parent.color, amount: 0 });
  }
  for (const tx of txs) {
    const cat = store.topCat(tx.catId);
    const cell = map.get(cat.id) || { name: cat.name, color: cat.color, amount: 0 };
    cell.amount += tx.amount;
    map.set(cat.id, cell);
  }
  return [...map.entries()].map(([id, v]) => ({ id, ...v, pct: total ? v.amount / total : 0 }));
}

function sortCats<T extends { name: string; amount: number }>(rows: T[], sort: SortMode): T[] {
  return [...rows].sort((a, b) => {
    if (sort === "amount-asc") return a.amount - b.amount;
    if (sort === "default") return 0;
    return b.amount - a.amount;
  });
}

/** 统一记账块：流水/周/月为记账视图，柱状/折线/饼状为统计视图 */
export function mountBillApp(root: HTMLElement, store: LedgerStore, opts: AppOptions = {}): ViewHandle {
  const initial = opts.initial ?? "flow";
  const blockId = opts.blockId || "";
  let view: MainView = VIEWS.includes(initial) ? initial : "flow";
  // 默认周/月：块属性里有就用块属性，否则用本周/本月
  let defaultWeek = opts.anchorWeek ? periodStart(parseDate(opts.anchorWeek), "week") : periodStart(new Date(), "week");
  let defaultMonth = opts.anchorMonth ? periodStart(parseDate(opts.anchorMonth), "month") : periodStart(new Date(), "month");
  let week = new Date(defaultWeek);
  let month = new Date(defaultMonth);
  let selectedDate = todayStr();
  let editingId: string | null = null;
  let inlineDay: string | null = null;
  let managerOpen = false;
  let anchorOpen = false;
  let searchOpen = false;
  let popoverClose: (() => void) | null = null;
  /** 流水视图的多条件筛选；catId 为 "__all__" 表示不限分类（"" 为「未分类」） */
  const flowFilter = { kw: "", catId: "__all__", min: "", max: "", start: "", end: "" };
  function flowFilterActive(): boolean {
    return !!(flowFilter.kw.trim() || flowFilter.catId !== "__all__" ||
      flowFilter.min !== "" || flowFilter.max !== "" || flowFilter.start || flowFilter.end);
  }
  /** 对流水按当前筛选条件过滤；无条件时原样返回 */
  function applyFlowFilter(txs: Tx[]): Tx[] {
    if (!flowFilterActive()) return txs;
    const kw = flowFilter.kw.trim().toLowerCase();
    const min = flowFilter.min === "" ? null : Number(flowFilter.min);
    const max = flowFilter.max === "" ? null : Number(flowFilter.max);
    return txs.filter((t) => {
      if (kw && !`${t.project || ""} ${t.note || ""}`.toLowerCase().includes(kw)) return false;
      if (flowFilter.catId !== "__all__" && t.catId !== flowFilter.catId) return false;
      if (min !== null && !isNaN(min) && t.amount < min) return false;
      if (max !== null && !isNaN(max) && t.amount > max) return false;
      if (flowFilter.start && t.date < flowFilter.start) return false;
      if (flowFilter.end && t.date > flowFilter.end) return false;
      return true;
    });
  }
  /** 配对视图的内容高度缓存，render 时刷新 */
  let pairedHeight = 0;
  let chartRange = defaultRange();
  let barSort: SortMode = "default";
  let lineUnit: LineUnit = "day";
  /** 统计走势图：未选具体分类时，false=总额+各分类全显，true=仅总额 */
  let statTotalOnly = false;
  const selectedCats = new Set<string>();

  /** 把当前默认周/月写入块属性，跨重载保留 */
  function persistAnchor(dim: "week" | "month"): void {
    if (!blockId) return;
    const attrs: Record<string, string> = dim === "week"
      ? { [WEEK_ATTR]: dateStr(defaultWeek) }
      : { [MONTH_ATTR]: dateStr(defaultMonth) };
    setBlockAttrs(blockId, attrs).catch(() => {
      // 独立打开或离线时忽略
    });
  }

  function render(): void {
    if (store.loadFailed) {
      showError(root, "账单数据未正确加载");
      return;
    }
    if (managerOpen) return;
    document.body.dataset.view = view;
    root.innerHTML = shellHtml();
    bindShell();
    const host = root.querySelector("#viewHost") as HTMLElement;
    if (view === "flow") renderFlow(host);
    else if (view === "week") renderPeriod(host, "week");
    else if (view === "month") renderPeriod(host, "month");
    else renderStats(host);
    // 仅流水视图需要测量周账高度作为固定外框（内部滚动）；周/月/统计各按自身内容定高
    pairedHeight = view === "flow" ? measureViewHeight("week") : 0;
    applyHeight();
  }

  /** 把视图 v 的整图内容离屏渲染一次以测出其自然高度（不影响当前状态） */
  function measureViewHeight(v: MainView): number {
    const app = document.getElementById("app");
    if (!app) return 0;
    const snap = { view, selectedDate, inlineDay, editingId };
    view = v;
    inlineDay = null;
    editingId = null;
    const temp = document.createElement("div");
    temp.style.cssText = `position:absolute;left:-99999px;top:0;visibility:hidden;width:${app.clientWidth}px`;
    document.body.appendChild(temp);
    temp.innerHTML = shellHtml();
    const host = temp.querySelector("#viewHost") as HTMLElement;
    if (v === "flow") renderFlow(host);
    else if (v === "week") renderPeriod(host, "week");
    else if (v === "month") renderPeriod(host, "month");
    else renderStats(host);
    const shell = temp.querySelector(".bill-shell") as HTMLElement | null;
    const h = Math.ceil((shell || temp).getBoundingClientRect().height);
    temp.remove();
    view = snap.view;
    selectedDate = snap.selectedDate;
    inlineDay = snap.inlineDay;
    editingId = snap.editingId;
    return h;
  }

  /** 当前视图与配对视图取较高者，加内边距与缓冲设为挂件高度 */
  function applyHeight(): void {
    const app = document.getElementById("app");
    if (!app) return;
    const cs = getComputedStyle(document.body);
    const pad = parseFloat(cs.paddingTop || "0") + parseFloat(cs.paddingBottom || "0");
    const cur = Math.ceil(app.getBoundingClientRect().height);
    // 流水视图固定为周账高度并允许内部滚动；周/月/统计各按自身内容完整展开（不强制配对、不留白）
    const base = view === "flow" ? (pairedHeight || cur) : cur;
    setWidgetHeight(base + pad + HEIGHT_BUFFER);
  }

  function shellHtml(): string {
    return `
      <div class="bill-shell view-${view}">
        <div class="view-tabs">
          <button class="icon-btn always" data-act="manage" title="管理分类">${ICONS.cog}</button>
          <div class="tab-group" aria-label="记账视图">
            ${VIEWS.map((v) => `<button class="${view === v ? "on" : ""}" data-view="${v}">${VIEW_LABEL[v]}</button>`).join("")}
          </div>
          <div class="tabs-right">
            <div class="toolbar-slot">${toolbarHtml()}</div>
            <button class="icon-btn always" data-act="shot" title="保存当前视图为图片">${ICONS.camera}</button>
          </div>
        </div>
        <div id="viewHost"></div>
      </div>`;
  }

  function toolbarHtml(): string {
    if (view === "week" || view === "month") {
      const dim = view;
      const cur = dim === "week" ? week : month;
      const start = dateStr(cur);
      const end = dateStr(rangeEnd(cur, dim));
      const txs = rangeTxs(store, start, end);
      const total = txs.reduce((s, t) => s + t.amount, 0);
      const def = dim === "week" ? defaultWeek : defaultMonth;
      const onDefault = periodStart(cur, dim).getTime() === def.getTime();
      const unit = dim === "week" ? "周" : "月";
      return `<div class="period-tools">
        <div class="period-nav-group">
          <div class="nav">
            <button class="nav-btn" data-period-nav="-1" title="上一${unit}">‹</button>
            <button class="anchor-label${onDefault ? " on" : ""}" data-go-default title="回到默认${unit}">${periodLabel(cur, dim)}</button>
            <button class="nav-btn" data-period-nav="1" title="下一${unit}">›</button>
          </div>
          <button class="icon-btn always" data-set-anchor title="把某${unit}设为本块默认">${ICONS.sliders}</button>
        </div>
        <span class="top-total">共 ${txs.length} 笔 · <b>${store.currency}${fmtMoney(total)}</b></span>
      </div>`;
    }
    if (view === "stats") {
      const empty = !chartRange.start && !chartRange.end;
      const txs = rangeTxs(store, chartRange.start, chartRange.end);
      const total = txs.reduce((s, t) => s + t.amount, 0);
      return `<div class="stats-tools">
        <div class="range-tools${empty ? " is-empty" : ""}">
          <input id="rangeStart" type="date" value="${chartRange.start}" title="起始时间，不填表示不限定">
          <span class="range-dash">-</span>
          <input id="rangeEnd" type="date" value="${chartRange.end}" title="结束时间，不填表示不限定">
        </div>
        <span class="top-total">共 ${txs.length} 笔 · <b>${store.currency}${fmtMoney(total)}</b></span>
      </div>`;
    }
    const txs = applyFlowFilter(store.txs);
    const total = txs.reduce((s, t) => s + t.amount, 0);
    const active = flowFilterActive();
    return `<div class="flow-tools">
      <button class="icon-btn always flow-search-btn${active ? " on" : ""}" data-act="search" title="筛选流水">${ICONS.search}</button>
      <span class="top-total">共 ${txs.length} 笔 · <b>${store.currency}${fmtMoney(total)}</b></span>
    </div>`;
  }

  function bindShell(): void {
    root.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        view = btn.dataset.view as MainView;
        if ((view === "week" || view === "month") && !samePeriod(selectedDate, view === "week" ? week : month, view)) {
          selectedDate = todayStr();
        }
        inlineDay = null;
        render();
      });
    });
    root.querySelector<HTMLButtonElement>("[data-act=manage]")?.addEventListener("click", (e) => {
      if (managerOpen) {
        closePopovers();
        return;
      }
      openManager(e.currentTarget as HTMLElement);
    });
    root.querySelector<HTMLButtonElement>("[data-act=shot]")?.addEventListener("click", (e) => {
      captureView(e.currentTarget as HTMLButtonElement);
    });
    root.querySelector<HTMLButtonElement>("[data-act=search]")?.addEventListener("click", (e) => {
      if (searchOpen) {
        closePopovers();
        return;
      }
      openSearch(e.currentTarget as HTMLElement);
    });
    root.querySelectorAll<HTMLButtonElement>("[data-period-nav]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (view === "week") week = shiftPeriod(week, "week", Number(btn.dataset.periodNav));
        if (view === "month") month = shiftPeriod(month, "month", Number(btn.dataset.periodNav));
        selectedDate = dateStr(view === "week" ? week : month);
        inlineDay = null;
        render();
      });
    });
    root.querySelector<HTMLButtonElement>("[data-go-default]")?.addEventListener("click", () => {
      if (view === "week") {
        week = new Date(defaultWeek);
        selectedDate = dateStr(week);
      }
      if (view === "month") {
        month = new Date(defaultMonth);
        selectedDate = dateStr(month);
      }
      inlineDay = null;
      render();
    });
    root.querySelector<HTMLButtonElement>("[data-set-anchor]")?.addEventListener("click", (e) => {
      if (anchorOpen) {
        closePopovers();
        return;
      }
      openAnchorPicker(e.currentTarget as HTMLElement, view === "week" ? "week" : "month");
    });
    const updateRange = () => {
      const start = (root.querySelector("#rangeStart") as HTMLInputElement | null)?.value || "";
      const end = (root.querySelector("#rangeEnd") as HTMLInputElement | null)?.value || "";
      chartRange = start && end && start > end ? { start: end, end: start } : { start, end };
      render();
    };
    root.querySelector("#rangeStart")?.addEventListener("change", updateRange);
    root.querySelector("#rangeEnd")?.addEventListener("change", updateRange);
  }

  function renderQuick(host: HTMLElement, initDate?: string): void {
    const box = document.createElement("div");
    box.className = "quick-card";
    box.appendChild(txForm(store, { date: initDate || selectedDate }, {
      submitLabel: "记一笔",
      dateStepper: true,
      onSubmit: async (v) => {
        const date = v.date;
        await store.addTx({ ...v, date });
        selectedDate = date;
        week = periodStart(parseDate(date), "week");
        month = periodStart(parseDate(date), "month");
        render();
      }
    }));
    host.appendChild(box);
  }

  function renderFlow(host: HTMLElement): void {
    renderQuick(host, todayStr());
    const txs = txsSorted(store, applyFlowFilter(store.txs));
    host.insertAdjacentHTML("beforeend", `<div id="flowList" class="flow-list-scroll"></div>`);
    const list = host.querySelector("#flowList") as HTMLElement;
    renderGroupedList(list, txs, flowFilterActive() ? "没有符合筛选条件的记录" : "还没有支出记录，从上方记第一笔");
  }

  /** 筛选条件变化时，仅就地刷新流水列表与顶部计数，保持筛选弹层不关 */
  function refreshFlowResults(): void {
    if (view !== "flow") return;
    const filtered = applyFlowFilter(store.txs);
    const list = root.querySelector("#flowList") as HTMLElement | null;
    if (list) {
      renderGroupedList(list, txsSorted(store, filtered),
        flowFilterActive() ? "没有符合筛选条件的记录" : "还没有支出记录，从上方记第一笔");
    }
    const total = filtered.reduce((s, t) => s + t.amount, 0);
    const totalEl = root.querySelector(".flow-tools .top-total") as HTMLElement | null;
    if (totalEl) totalEl.innerHTML = `共 ${filtered.length} 笔 · <b>${store.currency}${fmtMoney(total)}</b>`;
    root.querySelector(".flow-search-btn")?.classList.toggle("on", flowFilterActive());
  }

  function renderPeriod(host: HTMLElement, dim: "week" | "month"): void {
    const cur = dim === "week" ? week : month;
    const start = dateStr(cur);
    const end = dateStr(rangeEnd(cur, dim));
    const txs = rangeTxs(store, start, end);
    const selected = samePeriod(selectedDate, cur, dim) ? selectedDate : start;
    selectedDate = selected;
    host.innerHTML = "";

    if (dim === "week") renderWeekBoard(host, cur, txs);
    else renderMonthBoard(host, cur, txs);
  }

  function renderWeekBoard(host: HTMLElement, start: Date, txs: Tx[]): void {
    const today = todayStr();
    const board = document.createElement("div");
    board.className = "cal-grid week-board";
    board.innerHTML = ["一", "二", "三", "四", "五", "六", "日"].map((w) => `<div class="cal-dow">${w}</div>`).join("");
    const dayMax = maxDaySum(txs);
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      const ds = dateStr(d);
      const dayTxs = txs.filter((t) => t.date === ds);
      const sum = dayTxs.reduce((s, t) => s + t.amount, 0);
      const card = document.createElement("div");
      card.className = `week-day${ds === selectedDate ? " on" : ""}${ds === today ? " today" : ""}`;
      card.style.setProperty("--heat", heatAlpha(sum, dayMax));
      const head = document.createElement("button");
      head.type = "button";
      head.className = "cal-cell-head week-day-head";
      head.innerHTML = `<span class="cal-day">${d.getMonth() + 1}/${d.getDate()}</span>${sum ? `<span class="cal-sum">${store.currency}${fmtMoney(sum)}</span>` : ""}`;
      head.addEventListener("click", () => {
        selectedDate = ds;
        render();
      });
      card.appendChild(head);
      card.appendChild(addButton(ds));
      renderMiniList(card, dayTxs, 0);
      board.appendChild(card);
    }
    host.appendChild(board);
    renderPeriodStats(host, txs, start, "week");
  }

  function renderMonthBoard(host: HTMLElement, start: Date, txs: Tx[]): void {
    const first = new Date(start);
    const gridStart = addDays(first, -((first.getDay() + 6) % 7));
    const today = todayStr();
    const board = document.createElement("div");
    board.className = "cal-grid month-board";
    board.innerHTML = ["一", "二", "三", "四", "五", "六", "日"].map((w) => `<div class="cal-dow">${w}</div>`).join("");
    const dayMax = maxDaySum(txs);
    for (let i = 0; i < 42; i++) {
      const d = addDays(gridStart, i);
      if (i === 35 && d.getMonth() !== start.getMonth()) break;
      const ds = dateStr(d);
      const dayTxs = txs.filter((t) => t.date === ds);
      const sum = dayTxs.reduce((s, t) => s + t.amount, 0);
      const cell = document.createElement("div");
      cell.className = `cal-cell${d.getMonth() !== start.getMonth() ? " dim" : ""}${ds === today ? " today" : ""}${ds === selectedDate ? " on" : ""}`;
      cell.style.setProperty("--heat", heatAlpha(sum, dayMax));
      const head = document.createElement("button");
      head.type = "button";
      head.className = "cal-cell-head";
      head.innerHTML = `<span class="cal-day">${d.getDate()}</span>${sum ? `<span class="cal-sum">${fmtMoney(sum)}</span>` : ""}`;
      head.addEventListener("click", () => {
        selectedDate = ds;
        render();
      });
      cell.appendChild(head);
      cell.appendChild(addButton(ds));
      renderMiniList(cell, dayTxs, 0);
      board.appendChild(cell);
    }
    host.appendChild(board);
    renderPeriodStats(host, txs, start, "month");
  }

  function addButton(day: string): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "date-add";
    btn.title = "记一笔";
    btn.textContent = "+";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      selectedDate = day;
      const isOpened = inlineDay === day;
      closePopovers();
      if (!isOpened) {
        openAddPopover(btn, day);
      }
    });
    return btn;
  }

  function openAddPopover(anchorBtn: HTMLElement, day: string): void {
    inlineDay = day;
    const pop = document.createElement("div");
    pop.className = "eb-popover inline-add";
    
    let closeFn: (() => void) | null = null;
    const form = txForm(store, { date: day }, {
      submitLabel: "保存",
      showDate: false,
      onSubmit: async (v) => {
        await store.addTx({ ...v, date: day });
        closeFn?.();
        selectedDate = day;
        render();
      },
      onCancel: () => {
        closeFn?.();
      }
    });
    
    pop.appendChild(form);
    
    closeFn = mountPopover(pop, anchorBtn, () => {
      inlineDay = null;
    });
    
    window.setTimeout(() => (form.querySelector(".q-project") as HTMLInputElement | null)?.focus(), 0);
  }

  function openEditPopover(anchorEl: HTMLElement, tx: Tx): void {
    editingId = tx.id;
    const pop = document.createElement("div");
    pop.className = "eb-popover inline-add";
    
    let closeFn: (() => void) | null = null;
    const form = txForm(store, tx, {
      submitLabel: "保存",
      showDate: false,
      onSubmit: async (v) => {
        await store.updateTx(tx.id, { ...v, date: tx.date });
        closeFn?.();
        selectedDate = tx.date;
        render();
      },
      onCancel: () => {
        closeFn?.();
      }
    });
    
    pop.appendChild(form);
    
    closeFn = mountPopover(pop, anchorEl, () => {
      editingId = null;
    });
    
    window.setTimeout(() => (form.querySelector(".q-project") as HTMLInputElement | null)?.focus(), 0);
  }

  function maxDaySum(txs: Tx[]): number {
    const sums = new Map<string, number>();
    for (const tx of txs) sums.set(tx.date, (sums.get(tx.date) || 0) + tx.amount);
    return Math.max(...sums.values(), 0);
  }

  function heatAlpha(sum: number, max: number): string {
    if (!sum || !max) return "0";
    const ratio = Math.min(1, sum / max);
    return (0.035 + ratio * 0.24).toFixed(3);
  }

  function renderPeriodStats(host: HTMLElement, txs: Tx[], start: Date, dim: "week" | "month"): void {
    // 周/月柱状图固定按用户设定的分类顺序（拖拽顺序）排列，不按金额
    const byCat = aggregateCats(store, txs).filter((c) => !store.hideEmptyCats || c.amount > 0);
    let trendRows: TrendRow[];
    if (dim === "week") {
      const wk = ["一", "二", "三", "四", "五", "六", "日"];
      trendRows = Array.from({ length: 7 }, (_, i) => {
        const d = addDays(start, i);
        const ds = dateStr(d);
        return {
          name: wk[i],
          tip: `${d.getMonth() + 1}/${d.getDate()}`,
          amount: txs.filter((t) => t.date === ds).reduce((s, t) => s + t.amount, 0)
        };
      });
    } else {
      const trendStart = periodStart(start, "month");
      const days = rangeEnd(trendStart, "month").getDate();
      const trendTxs = rangeTxs(store, dateStr(trendStart), dateStr(rangeEnd(trendStart, "month")));
      trendRows = Array.from({ length: days }, (_, i) => {
        const d = addDays(trendStart, i);
        const ds = dateStr(d);
        return {
          name: String(d.getDate()),
          tip: `${d.getMonth() + 1}/${d.getDate()}`,
          amount: trendTxs.filter((t) => t.date === ds).reduce((s, t) => s + t.amount, 0)
        };
      });
    }
    const wrap = document.createElement("div");
    wrap.className = "week-stat-grid";
    wrap.appendChild(vbarPanel("分类", byCat));
    wrap.appendChild(trendLinePanel("走势", trendRows, {
      showValues: dim === "week",
      labelEvery: dim === "week" ? 1 : 5
    }));
    host.appendChild(wrap);
  }

  function vbarPanel(title: string, rows: Array<{ name: string; amount: number; color: string }>): HTMLElement {
    const panel = document.createElement("section");
    panel.className = "vbar-panel";
    const max = Math.max(...rows.map((r) => r.amount), 1);
    panel.innerHTML = `<div class="vbar-title">${title}</div><div class="vbar-chart">${
      rows.map((r) => {
        // 留出顶部空间给数额标签，最高柱约占 88%
        const pct = r.amount > 0 ? Math.max(2, r.amount / max * 88) : 0;
        return `<div class="vbar">
          <div class="vbar-track">
            ${r.amount > 0 ? `<div class="vbar-value" style="bottom:${pct.toFixed(1)}%">${store.currency}${fmtMoney(r.amount)}</div>` : ""}
            <div class="vbar-bar" style="height:${pct.toFixed(1)}%;background:${r.color}"></div>
          </div>
          <div class="vbar-label">${esc(r.name)}</div>
        </div>`;
      }).join("")
    }</div>`;
    return panel;
  }

  function trendLinePanel(title: string, rows: TrendRow[], opts: { showValues: boolean; labelEvery: number }): HTMLElement {
    const panel = document.createElement("section");
    panel.className = "vbar-panel";
    const max = Math.max(...rows.map((r) => r.amount), 1);
    const W = 360, H = 158, padL = 24, padR = 12, padT = 24, padB = 22;
    const x = (i: number) => padL + (rows.length === 1 ? 0 : (i / (rows.length - 1)) * (W - padL - padR));
    const y = (v: number) => H - padB - (v / max) * (H - padT - padB);
    const d = rows.map((r, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(r.amount).toFixed(1)}`).join(" ");

    const showByDefault = (i: number) => {
      const val = rows[i].amount;
      if (val <= 0) return false;
      if (rows.length <= 12) return true;
      const prevVal = i > 0 ? rows[i - 1].amount : 0;
      const nextVal = i < rows.length - 1 ? rows[i + 1].amount : 0;
      if (val >= prevVal && val >= nextVal) return true;
      if (prevVal === 0 && nextVal === 0) return true;
      return false;
    };

    const pointsMarkup = rows.map((r, i) => {
      if (r.amount <= 0) return "";
      const isAlwaysShow = showByDefault(i);
      const cx = x(i).toFixed(1);
      const cy = y(r.amount).toFixed(1);
      const ty = (y(r.amount) - 6).toFixed(1);
      return `<g class="chart-point${isAlwaysShow ? " always-show" : ""}" style="color:var(--trend-line)">
        <title>${esc(r.tip)} ${store.currency}${fmtMoney(r.amount)}</title>
        <circle class="pt-hit" cx="${cx}" cy="${cy}" r="6"/>
        <circle class="pt-dot" cx="${cx}" cy="${cy}" r="2.0"/>
        <text class="vline-val val-normal" x="${cx}" y="${ty}" text-anchor="middle">${fmtMoney(r.amount)}</text>
        <text class="vline-val val-hover" x="${cx}" y="${ty}" text-anchor="middle">${esc(r.tip)}: ${fmtMoney(r.amount)}</text>
      </g>`;
    }).join("");

    // 月走势横轴：起止 + 5 的倍数；末位与倒数第二相邻时只留末位（避免 30、31 叠字）
    const showLabel = (i: number) => opts.labelEvery <= 1
      ? true
      : i === 0 || i === rows.length - 1 || ((i + 1) % opts.labelEvery === 0 && rows.length - 1 - i >= 2);
    const labels = rows.map((r, i) => showLabel(i)
      ? `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === rows.length - 1 ? "end" : "middle"}">${esc(r.name)}</text>`
      : "").join("");
    panel.innerHTML = `<div class="vbar-title">${title}</div><div class="period-line-chart">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="var(--line-strong)"/>
        <path d="${d}" fill="none" stroke="var(--trend-line)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
        <g>${pointsMarkup}</g>
        ${labels}
      </svg>
    </div>`;
    return panel;
  }

  function openTxPopover(day: string, tx?: Tx): void {
    const overlay = document.createElement("div");
    overlay.className = "overlay add-overlay";
    const d = parseDate(day);
    overlay.innerHTML = `<div class="panel add-panel">
      <div class="panel-head">
        <span class="panel-title">${tx ? "编辑" : "新增"} · ${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}</span>
        <button class="nav-btn" data-close title="关闭">×</button>
      </div>
      <div id="dateAddForm"></div>
    </div>`;
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) close();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const close = () => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      render();
    };
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    overlay.querySelector("[data-close]")?.addEventListener("click", close);
    const form = txForm(store, tx || { date: day }, {
      submitLabel: tx ? "保存" : "保存",
      showDate: false,
      onSubmit: async (v) => {
        if (tx) await store.updateTx(tx.id, { ...v, date: day });
        else await store.addTx({ ...v, date: day });
        close();
      },
      onCancel: close
    });
    overlay.querySelector("#dateAddForm")!.appendChild(form);
    (form.querySelector(".q-project") as HTMLInputElement).focus();
  }

  function renderStats(host: HTMLElement): void {
    const txs = rangeTxs(store, chartRange.start, chartRange.end);
    const rows = sortCats(aggregateCats(store, txs).filter((r) => !store.hideEmptyCats || r.amount > 0), barSort);
    const max = Math.max(...rows.map((r) => r.amount), 1);
    host.insertAdjacentHTML("beforeend", `<div class="stat-title">
      <span>分类</span>
      <select id="barSort">
        <option value="default"${barSort === "default" ? " selected" : ""}>默认</option>
        <option value="amount-desc"${barSort === "amount-desc" ? " selected" : ""}>降序</option>
        <option value="amount-asc"${barSort === "amount-asc" ? " selected" : ""}>升序</option>
      </select>
    </div><div class="bar-chart"></div>`);
    (host.querySelector("#barSort") as HTMLSelectElement).addEventListener("change", (e) => {
      barSort = (e.target as HTMLSelectElement).value as SortMode;
      render();
    });
    const chart = host.querySelector(".bar-chart") as HTMLElement;
    if (!rows.length) {
      chart.innerHTML = `<div class="empty">当前范围暂无支出记录</div>`;
      renderLine(host);
      return;
    }
    chart.innerHTML = rows.map((r) => `<div class="hbar">
      <span class="dot" style="background:${r.color}"></span>
      <span class="hbar-name">${esc(r.name)}</span>
      <span class="hbar-track"><span style="width:${(r.amount / max * 100).toFixed(1)}%;background:${r.color}"></span></span>
      <b>${store.currency}${fmtMoney(r.amount)} <span>${pctStr(r.pct)}</span></b>
    </div>`).join("");
    renderLine(host);
  }

  function renderLine(host: HTMLElement): void {
    const cats = aggregateCats(store, rangeTxs(store, chartRange.start, chartRange.end))
      .sort((a, b) => b.amount - a.amount);
    const allCatsOn = !selectedCats.size && !statTotalOnly;
    host.insertAdjacentHTML("beforeend", `<div class="stat-title">
      <span>走势</span>
      <select id="lineUnit">
        <option value="day"${lineUnit === "day" ? " selected" : ""}>按日</option>
        <option value="week"${lineUnit === "week" ? " selected" : ""}>按周</option>
        <option value="month"${lineUnit === "month" ? " selected" : ""}>按月</option>
        <option value="year"${lineUnit === "year" ? " selected" : ""}>按年</option>
      </select>
    </div>
    <div class="cat-chips"><button class="${!selectedCats.size ? "on" : ""}" data-cat="__all" title="${allCatsOn ? "再点一次只看总支出" : "显示总支出与各分类"}">全部</button>${cats.map((c) => `<button class="${allCatsOn || selectedCats.has(c.id) ? "on" : ""}" data-cat="${c.id}">
      <span class="dot" style="background:${c.color}"></span>${esc(c.name)}
    </button>`).join("")}</div>
    <div class="line-chart"></div>`);
    (host.querySelector("#lineUnit") as HTMLSelectElement).addEventListener("change", (e) => {
      lineUnit = (e.target as HTMLSelectElement).value as LineUnit;
      render();
    });
    host.querySelectorAll<HTMLButtonElement>(".cat-chips button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.cat!;
        if (id === "__all") {
          // 选着具体分类时先回到“全显”；已是全显则切到“仅总额”，再点回全显
          if (selectedCats.size) {
            selectedCats.clear();
            statTotalOnly = false;
          } else {
            statTotalOnly = !statTotalOnly;
          }
          render();
          return;
        }
        statTotalOnly = false;
        if (selectedCats.has(id)) selectedCats.delete(id);
        else selectedCats.add(id);
        render();
      });
    });
    drawLineChart(host.querySelector(".line-chart") as HTMLElement);
  }

  function renderPie(host: HTMLElement): void {
    renderRangeControls(host, "pie");
    const txs = rangeTxs(store, chartRange.start, chartRange.end);
    const total = txs.reduce((s, t) => s + t.amount, 0);
    const rows = sortCats(aggregateCats(store, txs), "amount-desc");
    host.insertAdjacentHTML("beforeend", `<div class="stat-title"><span>${rangeLabel(chartRange.start, chartRange.end)} · 分类占比</span><b>${store.currency}${fmtMoney(total)}</b></div>`);
    if (!rows.length) {
      host.insertAdjacentHTML("beforeend", `<div class="empty">当前范围暂无支出记录</div>`);
      return;
    }
    const R = 62, SW = 20, size = 2 * (R + SW / 2) + 4, c = size / 2;
    let angle = 0;
    const paths = rows.map((r) => {
      const sweep = r.pct * 360;
      const a0 = angle + (rows.length > 1 ? 1 : 0);
      const a1 = Math.max(a0 + 0.5, angle + sweep - (rows.length > 1 ? 1 : 0));
      angle += sweep;
      return `<path d="${arcPath(c, c, R, a0, a1)}" stroke="${r.color}" stroke-width="${SW}" fill="none" stroke-linecap="round"><title>${esc(r.name)} ${pctStr(r.pct)}</title></path>`;
    }).join("");
    host.insertAdjacentHTML("beforeend", `<div class="pie-layout">
      <div class="donut-wrap big">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${paths}</svg>
        <div class="donut-center"><div class="n">${rows.length}</div><div class="t">分类</div></div>
      </div>
      <div class="cat-list">${rows.map((r) => `<div class="cat-row static">
        <span class="dot" style="background:${r.color}"></span>
        <span class="name">${esc(r.name)}</span>
        <span class="cat-bar-track"><span class="cat-bar" style="width:${(r.pct * 100).toFixed(1)}%;background:${r.color};opacity:.55"></span></span>
        <span class="amt">${store.currency}${fmtMoney(r.amount)}</span>
        <span class="pct">${pctStr(r.pct)}</span>
      </div>`).join("")}</div>
    </div>`);
  }

  function renderRangeControls(host: HTMLElement, key: "bar" | "line" | "pie"): void {
    host.innerHTML = `<div class="range-row" data-range-for="${key}">
      <label>开始 <input id="rangeStart" type="date" value="${chartRange.start}"></label>
      <label>结束 <input id="rangeEnd" type="date" value="${chartRange.end}"></label>
      <button class="nav-btn" data-range="week">本周</button>
      <button class="nav-btn" data-range="month">本月</button>
      <button class="nav-btn" data-range="year">本年</button>
    </div>`;
    const update = () => {
      const start = (host.querySelector("#rangeStart") as HTMLInputElement).value || chartRange.start;
      const end = (host.querySelector("#rangeEnd") as HTMLInputElement).value || chartRange.end;
      chartRange = start <= end ? { start, end } : { start: end, end: start };
      render();
    };
    host.querySelector("#rangeStart")?.addEventListener("change", update);
    host.querySelector("#rangeEnd")?.addEventListener("change", update);
    host.querySelectorAll<HTMLButtonElement>("[data-range]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const dim = btn.dataset.range as Dim;
        const start = periodStart(new Date(), dim);
        chartRange = { start: dateStr(start), end: dateStr(rangeEnd(start, dim)) };
        render();
      });
    });
  }

  function drawLineChart(host: HTMLElement): void {
    const eff = effectiveRange(store, chartRange);
    if (!eff.start || !eff.end) {
      host.innerHTML = `<div class="empty">暂无支出记录</div>`;
      return;
    }
    const start = unitStart(eff.start, lineUnit);
    const end = unitStart(eff.end, lineUnit);
    const points: Date[] = [];
    for (let cur = start, guard = 0; cur.getTime() <= end.getTime() && guard < 370; cur = shiftUnit(cur, lineUnit, 1), guard++) {
      points.push(new Date(cur));
    }
    // 选了具体分类 → 只画这些；未选时：全显=总额+各分类，仅总额=只总额
    let active: string[];
    if (selectedCats.size) {
      active = [...selectedCats];
    } else if (statTotalOnly) {
      active = ["__all"];
    } else {
      const catIds = aggregateCats(store, rangeTxs(store, chartRange.start, chartRange.end))
        .filter((c) => c.amount > 0)
        .sort((a, b) => b.amount - a.amount)
        .map((c) => c.id);
      active = ["__all", ...catIds];
    }
    if (!points.length) {
      host.innerHTML = `<div class="empty">请选择时间范围</div>`;
      return;
    }
    const series = active.map((id, idx) => {
      if (id === "__all") {
        const sums = points.map((p) =>
          store.txs
            .filter((t) => inRange(t, chartRange.start, chartRange.end))
            .filter((t) => unitStart(t.date, lineUnit).getTime() === p.getTime())
            .reduce((s, t) => s + t.amount, 0));
        return { id, name: "全部", color: "var(--trend-line)", sums };
      }
      const cat = store.cat(id);
      const color = cat.id ? cat.color : PALETTE[idx % PALETTE.length];
      const sums = points.map((p) =>
        store.txs
          .filter((t) => inRange(t, chartRange.start, chartRange.end))
          .filter((t) => unitStart(t.date, lineUnit).getTime() === p.getTime())
          .filter((t) => catKey(store, t) === id)
          .reduce((s, t) => s + t.amount, 0));
      return { id, name: catName(store, id), color, sums };
    });
    const max = Math.max(...series.flatMap((s) => s.sums), 1);
    const W = 720, H = 300, padL = 38, padR = 14, padT = 20, padB = 34;
    const x = (i: number) => padL + (points.length === 1 ? 0 : (i / (points.length - 1)) * (W - padL - padR));
    const y = (v: number) => H - padB - (v / max) * (H - padT - padB);

    const pathsMarkup = series.map((s) => {
      const isTotal = s.id === "__all";
      const d = s.sums.map((v, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
      return `<path class="line-path" data-series="${s.id}" d="${d}" fill="none" stroke="${s.color}" stroke-width="${isTotal ? 1.4 : 1}" stroke-linecap="round" stroke-linejoin="round"${isTotal ? "" : ` opacity="0.85"`}/>`;
    }).join("");

    const pointsMarkup = series.map((s) => {
      const isTotal = s.id === "__all";
      const showByDefault = (i: number) => {
        if (!isTotal) return false;
        const val = s.sums[i];
        if (val <= 0) return false;
        if (points.length <= 12) return true;
        const prevVal = i > 0 ? s.sums[i - 1] : 0;
        const nextVal = i < s.sums.length - 1 ? s.sums[i + 1] : 0;
        if (val >= prevVal && val >= nextVal) return true;
        if (prevVal === 0 && nextVal === 0) return true;
        return false;
      };
      return s.sums.map((v, i) => {
        if (v <= 0) return "";
        const isAlwaysShow = showByDefault(i);
        const cx = x(i).toFixed(1);
        const cy = y(v).toFixed(1);
        const ty = (y(v) - (isTotal ? 6 : 5)).toFixed(1);
        return `<g class="chart-point${isAlwaysShow ? " always-show" : ""}" data-series="${s.id}" style="color:${s.color}">
          <title>${esc(s.name)} ${unitLabel(points[i], lineUnit)} ${store.currency}${fmtMoney(v)}</title>
          <circle class="pt-hit" cx="${cx}" cy="${cy}" r="7"/>
          <circle class="pt-dot" cx="${cx}" cy="${cy}" r="${isTotal ? 2.2 : 1.6}"/>
          <text class="vline-val val-normal" x="${cx}" y="${ty}" text-anchor="middle">${fmtMoney(v)}</text>
          <text class="vline-val val-hover" x="${cx}" y="${ty}" text-anchor="middle">${esc(unitLabel(points[i], lineUnit))}: ${fmtMoney(v)}</text>
        </g>`;
      }).join("");
    }).join("");

    let prevYear: number | null = null;
    const labelStep = Math.max(1, Math.ceil(points.length / 7));
    const labels = points
      .map((p, idx) => ({ p, idx }))
      .filter(({ idx }) => idx === 0 || idx === points.length - 1 || (idx % labelStep === 0 && points.length - 1 - idx >= Math.ceil(labelStep / 2)))
      .map(({ p, idx }, i, arr) => {
        let text = "";
        if (lineUnit === "week") {
          const { year, week } = isoWeek(p);
          if (prevYear === null || year !== prevYear) {
            prevYear = year;
            text = `${year}W${week}`;
          } else {
            text = `W${week}`;
          }
        } else {
          text = unitLabel(p, lineUnit);
        }
        return `<text x="${x(idx).toFixed(1)}" y="${H - 8}" text-anchor="${i === 0 ? "start" : i === arr.length - 1 ? "end" : "middle"}">${text}</text>`;
      }).join("");

    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="var(--line-strong)"/>
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}" stroke="var(--line)"/>
      <text x="4" y="${(y(max) + 4).toFixed(1)}">${fmtMoney(max)}</text>
      ${labels}
      ${pathsMarkup}
      ${pointsMarkup}
    </svg>`;

    // 多条折线时，鼠标悬停某点只突出该条折线，其余淡出，避免重叠看不清
    if (series.length > 1) {
      const svg = host.querySelector("svg") as SVGSVGElement | null;
      const focus = (id: string | null): void => {
        svg?.querySelectorAll<SVGElement>("[data-series]").forEach((el) => {
          el.style.opacity = id === null ? "" : el.getAttribute("data-series") === id ? "1" : "0.1";
        });
      };
      svg?.querySelectorAll<SVGGElement>(".chart-point").forEach((g) => {
        g.addEventListener("mouseenter", () => focus(g.getAttribute("data-series")));
        g.addEventListener("mouseleave", () => focus(null));
      });
    }
  }

  function renderGroupedList(host: HTMLElement, txs: Tx[], empty: string): void {
    host.innerHTML = "";
    if (!txs.length) {
      host.innerHTML = `<div class="empty">${empty}</div>`;
      return;
    }
    let curDate = "";
    let group: HTMLElement | null = null;
    for (const tx of txs) {
      if (tx.date !== curDate) {
        curDate = tx.date;
        const d = parseDate(tx.date);
        const dayTxs = txs.filter((t) => t.date === tx.date);
        const daySum = dayTxs.reduce((s, t) => s + t.amount, 0);
        group = document.createElement("div");
        group.className = "day-group";
        group.innerHTML = `<div class="day-head"><span>${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}</span><span class="sum">${store.currency}${fmtMoney(daySum)}</span></div>`;
        host.appendChild(group);
      }
      group!.appendChild(rowWithEdit(tx));
    }
  }

  function renderPlainList(host: HTMLElement, txs: Tx[], empty: string): void {
    host.innerHTML = "";
    if (!txs.length) {
      host.innerHTML = `<div class="empty small">${empty}</div>`;
      return;
    }
    txs.forEach((tx) => host.appendChild(rowWithEdit(tx)));
  }

  function renderMiniList(host: HTMLElement, txs: Tx[], limit: number): void {
    const list = document.createElement("div");
    list.className = "mini-tx-list";
    const rows = txsSorted(store, txs);
    const visible = limit > 0 ? rows.slice(0, limit) : rows;
    for (const tx of visible) {
      list.appendChild(miniRow(tx));
    }
    if (limit > 0 && rows.length > limit) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "mini-more";
      more.textContent = `+${rows.length - limit}`;
      more.addEventListener("click", () => {
        selectedDate = rows[0].date;
        render();
      });
      list.appendChild(more);
    }
    host.appendChild(list);
  }

  function miniRow(tx: Tx): HTMLElement {
    const cat = store.cat(tx.catId);
    const row = document.createElement("div");
    row.className = "mini-tx";
    // 默认显示项目名；备注不在此显示，仅鼠标悬停时通过 tooltip 提示（与日程块备注一致）
    if (tx.note) row.title = tx.note;
    row.innerHTML = `
      <span class="dot" style="background:${cat.color}"></span>
      <span class="mini-note">${esc(tx.project || store.catLabel(tx.catId))}</span>
      <span class="mini-amt">${store.currency}${fmtMoney(tx.amount)}</span>
      <span class="mini-ops">
        <button class="tx-op" title="编辑">${ICONS.edit}</button>
        <button class="tx-op del" title="删除">${ICONS.del}</button>
      </span>`;
    const [editBtn, delBtn] = row.querySelectorAll<HTMLButtonElement>(".tx-op");
    row.addEventListener("dblclick", (e) => {
      if ((e.target as HTMLElement).closest(".tx-op")) return;
      selectedDate = tx.date;
      const isOpened = editingId === tx.id;
      closePopovers();
      if (!isOpened) {
        openEditPopover(row, tx);
      }
    });
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      selectedDate = tx.date;
      const isOpened = editingId === tx.id;
      closePopovers();
      if (!isOpened) {
        openEditPopover(row, tx);
      }
    });
    delBtn.addEventListener("click", async () => {
      await store.removeTx(tx.id);
      render();
    });
    return row;
  }

  function rowWithEdit(tx: Tx): HTMLElement {
    return txRow(store, tx, {
      onEdit: startEdit,
      onDelete: async (t) => {
        await store.removeTx(t.id);
        render();
      }
    });
  }

  function startEdit(tx: Tx, rowEl: HTMLElement): void {
    editingId = tx.id;
    const onOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!form.contains(target) && !target.closest(".cat-menu")) {
        cleanup();
        editingId = null;
        render();
      }
    };
    const onFocusOut = () => {
      window.setTimeout(() => {
        const active = document.activeElement;
        if (active && !form.contains(active) && !active.closest(".cat-menu")) {
          cleanup();
          editingId = null;
          render();
        }
      }, 100);
    };
    const cleanup = () => {
      document.removeEventListener("mousedown", onOutsideClick, true);
      form.removeEventListener("focusout", onFocusOut);
    };

    const form = txForm(store, tx, {
      submitLabel: "保存",
      onSubmit: async (v) => {
        cleanup();
        editingId = null;
        await store.updateTx(tx.id, v);
        selectedDate = v.date;
        render();
      },
      onCancel: () => {
        cleanup();
        editingId = null;
        render();
      }
    });
    form.classList.add("tx-edit");
    rowEl.replaceWith(form);
    (form.querySelector(".q-project") as HTMLInputElement).focus();

    form.addEventListener("focusout", onFocusOut);
    window.setTimeout(() => {
      document.addEventListener("mousedown", onOutsideClick, true);
    }, 0);
  }

  /** 流水多条件筛选弹层：关键词 / 分类 / 金额区间 / 日期区间，即时生效 */
  function openSearch(anchorBtn: HTMLElement): void {
    closePopovers();
    const opts = [`<option value="__all__">全部分类</option>`]
      .concat(store.cats.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`))
      .concat([`<option value="">未分类</option>`])
      .join("");
    const pop = document.createElement("div");
    pop.className = "eb-popover search-pop";
    pop.innerHTML = `
      <div class="eb-pop-title">筛选流水</div>
      <input class="anchor-input search-kw" type="text" placeholder="关键词（项目 / 备注）">
      <select class="anchor-input search-cat">${opts}</select>
      <div class="search-row">
        <input class="anchor-input search-min" type="number" inputmode="decimal" placeholder="最低金额">
        <span class="search-dash">–</span>
        <input class="anchor-input search-max" type="number" inputmode="decimal" placeholder="最高金额">
      </div>
      <div class="search-row">
        <input class="anchor-input search-start" type="date" title="起始日期">
        <span class="search-dash">–</span>
        <input class="anchor-input search-end" type="date" title="结束日期">
      </div>
      <div class="eb-pop-actions">
        <button class="eb-btn ghost" data-reset type="button">重置</button>
        <span class="eb-pop-spacer"></span>
        <button class="eb-btn primary" data-done type="button">完成</button>
      </div>`;

    const kw = pop.querySelector(".search-kw") as HTMLInputElement;
    const cat = pop.querySelector(".search-cat") as HTMLSelectElement;
    const min = pop.querySelector(".search-min") as HTMLInputElement;
    const max = pop.querySelector(".search-max") as HTMLInputElement;
    const start = pop.querySelector(".search-start") as HTMLInputElement;
    const end = pop.querySelector(".search-end") as HTMLInputElement;
    // 回填当前筛选状态
    kw.value = flowFilter.kw; cat.value = flowFilter.catId;
    min.value = flowFilter.min; max.value = flowFilter.max;
    start.value = flowFilter.start; end.value = flowFilter.end;

    const sync = () => {
      flowFilter.kw = kw.value;
      flowFilter.catId = cat.value;
      flowFilter.min = min.value;
      flowFilter.max = max.value;
      flowFilter.start = start.value;
      flowFilter.end = end.value;
      refreshFlowResults();
    };
    kw.addEventListener("input", sync);
    cat.addEventListener("change", sync);
    [min, max, start, end].forEach((el) => el.addEventListener("input", sync));

    const close = mountPopover(pop, anchorBtn, () => { searchOpen = false; });
    searchOpen = true;
    pop.querySelector("[data-reset]")!.addEventListener("click", () => {
      kw.value = ""; cat.value = "__all__"; min.value = ""; max.value = ""; start.value = ""; end.value = "";
      sync();
      kw.focus();
    });
    pop.querySelector("[data-done]")!.addEventListener("click", () => close());
    kw.focus();
  }

  function closePopovers(): void {
    popoverClose?.();
  }

  /** 把当前视图整图保存为 PNG */
  async function captureView(btn: HTMLButtonElement): Promise<void> {
    closePopovers();
    const app = document.getElementById("app");
    if (!app) return;
    btn.disabled = true;
    document.body.classList.add("eb-capturing");
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      const canvas = await html2canvas(app, {
        backgroundColor: getComputedStyle(document.body).backgroundColor || null,
        scale: Math.min(window.devicePixelRatio || 1, 2),
        useCORS: true
      });
      const blob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error("截图生成失败"))), "image/png"));
      const labels: Record<MainView, string> = { flow: "流水", week: "周账", month: "月账", stats: "统计" };
      let scope = "";
      if (view === "week") scope = `-${dateStr(week)}`;
      else if (view === "month") scope = `-${dateStr(month).slice(0, 7)}`;
      await saveScreenshotBlob(blob, `记账块-${labels[view]}${scope}.png`);
    } catch (err) {
      console.error("bill-block 截图失败", err);
    } finally {
      document.body.classList.remove("eb-capturing");
      btn.disabled = false;
    }
  }

  /** 把弹层挂到锚点按钮下方，处理外部点击 / Esc 关闭 */
  function mountPopover(el: HTMLElement, anchorEl: HTMLElement, onClose?: () => void): () => void {
    document.body.appendChild(el);
    positionPopover(el, anchorEl);
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      if (popoverClose === close) popoverClose = null;
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown, true);
      window.clearTimeout(timer);
      el.remove();
      onClose?.();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (el.contains(t) || anchorEl.contains(t)) return;
      // 分类下拉菜单挂在 document.body 上，点击它不应关闭弹窗
      if ((t as HTMLElement).closest?.(".cat-menu")) return;
      close();
    };
    document.addEventListener("keydown", onKey, true);
    const timer = window.setTimeout(() => document.addEventListener("mousedown", onDown, true), 0);
    popoverClose = close;
    return close;
  }

  /** 10 色板 + 调色板取色 + 色码输入 */
  function buildSwatches(current: string, onPick: (color: string) => void): HTMLElement {
    const sw = document.createElement("div");
    sw.className = "swatches";
    const grid = document.createElement("div");
    grid.className = "swatch-grid";
    for (const color of PALETTE) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "swatch" + (color.toUpperCase() === current.toUpperCase() ? " on" : "");
      btn.style.background = color;
      btn.title = color;
      btn.addEventListener("click", () => onPick(color));
      grid.appendChild(btn);
    }
    sw.appendChild(grid);

    const custom = document.createElement("div");
    custom.className = "swatch-custom";
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.className = "color-input";
    colorInput.value = isHexColor(current) ? current : "#888888";
    colorInput.title = "调色板取色";
    colorInput.addEventListener("change", () => onPick(colorInput.value));

    const hexInput = document.createElement("input");
    hexInput.type = "text";
    hexInput.className = "hex-input";
    hexInput.placeholder = "#RRGGBB";
    hexInput.value = current;
    hexInput.maxLength = 7;

    const commitHex = () => {
      let val = hexInput.value.trim();
      if (val && val[0] !== "#") val = `#${val}`;
      if (isHexColor(val)) {
        onPick(val);
      } else {
        hexInput.value = current;
      }
    };
    hexInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitHex();
      }
    });
    hexInput.addEventListener("blur", commitHex);
    custom.append(colorInput, hexInput);
    sw.appendChild(custom);
    return sw;
  }

  function openAnchorPicker(anchorBtn: HTMLElement, dim: "week" | "month"): void {
    closePopovers();
    const unit = dim === "week" ? "周" : "月";
    const cur = dim === "week" ? week : month;
    const pop = document.createElement("div");
    pop.className = "eb-popover anchor-pop";
    if (dim === "week") {
      pop.innerHTML = `
        <div class="eb-pop-title">默认周</div>
        <div class="anchor-week-inputs" style="display:flex; align-items:center; gap:6px; margin-bottom:10px;">
          <input class="anchor-input-year anchor-input" type="number" min="2000" max="2099" style="width:58px; text-align:center; height:28px; border:1px solid var(--line); border-radius:5px; padding:0 4px;" title="年份">
          <span style="color:var(--fg-faint); font-size:12px;">年</span>
          <input class="anchor-input-week anchor-input" type="number" min="1" max="53" style="width:44px; text-align:center; height:28px; border:1px solid var(--line); border-radius:5px; padding:0 4px;" title="周次">
          <span style="color:var(--fg-faint); font-size:12px;">周</span>
          <span class="anchor-week-range" style="flex:1 1 auto; min-width:0; font-size:11px; color:var(--fg-faint); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"></span>
          <div style="position:relative; width:28px; height:28px; flex:0 0 auto; display:inline-flex; align-items:center; justify-content:center; border:1px solid var(--line); border-radius:5px; cursor:pointer;" title="选择具体日期">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;color:var(--fg-soft);"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
            <input class="anchor-input-date" type="date" style="position:absolute; inset:0; opacity:0; cursor:pointer;">
          </div>
        </div>
        <div class="eb-pop-actions">
          <button class="eb-btn ghost" data-use-current type="button">当前周</button>
          <span class="eb-pop-spacer"></span>
          <button class="eb-btn" data-cancel type="button">取消</button>
          <button class="eb-btn primary" data-save type="button">保存</button>
        </div>`;
    } else {
      pop.innerHTML = `
        <div class="eb-pop-title">默认${unit}</div>
        <input class="anchor-input" type="month" style="margin-bottom:8px;">
        <div class="eb-pop-actions">
          <button class="eb-btn ghost" data-use-current type="button">当前${unit}</button>
          <span class="eb-pop-spacer"></span>
          <button class="eb-btn" data-cancel type="button">取消</button>
          <button class="eb-btn primary" data-save type="button">保存</button>
        </div>`;
    }

    let selectedWeekStart = dateStr(cur);
    const yearInput = pop.querySelector(".anchor-input-year") as HTMLInputElement | null;
    const weekInput = pop.querySelector(".anchor-input-week") as HTMLInputElement | null;
    const rangeText = pop.querySelector(".anchor-week-range") as HTMLElement | null;
    const dateInput = pop.querySelector(".anchor-input-date") as HTMLInputElement | null;
    const monthInput = pop.querySelector("input[type=month]") as HTMLInputElement | null;

    const getWeekRangeStr = (d: Date) => {
      const start = periodStart(d, "week");
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
      const p = (n: number) => String(n).padStart(2, "0");
      return `(${p(start.getMonth() + 1)}/${p(start.getDate())}–${p(end.getMonth() + 1)}/${p(end.getDate())})`;
    };

    const updateWeekDisplay = (dateValue: string) => {
      const d = parseDate(dateValue);
      selectedWeekStart = dateStr(periodStart(d, "week"));
      const { year, week: wNum } = isoWeek(d);
      if (yearInput) yearInput.value = String(year);
      if (weekInput) weekInput.value = String(wNum);
      if (rangeText) rangeText.textContent = getWeekRangeStr(d);
      if (dateInput) dateInput.value = selectedWeekStart;
    };

    const onNumInput = () => {
      const y = parseInt(yearInput?.value || "");
      let w = parseInt(weekInput?.value || "");
      if (isNaN(y) || y < 2000 || y > 2099) return;
      if (isNaN(w)) w = 1;
      if (w < 1) w = 1;
      if (w > 53) w = 53;
      const d = dateFromIsoWeek(y, w);
      selectedWeekStart = dateStr(d);
      if (rangeText) rangeText.textContent = getWeekRangeStr(d);
      if (dateInput) dateInput.value = selectedWeekStart;
    };

    if (yearInput) yearInput.addEventListener("input", onNumInput);
    if (weekInput) weekInput.addEventListener("input", onNumInput);

    const fillCurrent = () => {
      if (dim === "week") {
        updateWeekDisplay(dateStr(cur));
      } else if (monthInput) {
        monthInput.value = dateStr(cur).slice(0, 7);
      }
    };
    fillCurrent();

    if (dateInput) {
      dateInput.addEventListener("change", () => {
        updateWeekDisplay(dateInput.value);
      });
    }

    const close = mountPopover(pop, anchorBtn, () => { anchorOpen = false; });
    anchorOpen = true;
    pop.querySelector("[data-use-current]")!.addEventListener("click", fillCurrent);
    pop.querySelector("[data-cancel]")!.addEventListener("click", () => close());

    const save = () => {
      if (dim === "week") {
        defaultWeek = periodStart(parseDate(selectedWeekStart), "week");
        week = new Date(defaultWeek);
        selectedDate = dateStr(week);
        persistAnchor("week");
      } else {
        const v = monthInput ? monthInput.value : "";
        if (!v) return;
        const [y, m] = v.split("-").map(Number);
        defaultMonth = new Date(y, (m || 1) - 1, 1);
        month = new Date(defaultMonth);
        selectedDate = dateStr(month);
        persistAnchor("month");
      }
      close();
      render();
    };
    pop.querySelector("[data-save]")!.addEventListener("click", save);
  }

  function openManager(anchorBtn: HTMLElement): void {
    managerOpen = true;
    const pop = document.createElement("div");
    pop.className = "eb-popover cm-pop";
    pop.innerHTML = `
      <div class="eb-pop-title">分类管理</div>
      <div class="cm-list"></div>
      <button class="cm-add" type="button">${ICONS.plus}<span>新增分类</span></button>
      <label class="cm-option" title="勾选后，分类图只显示本期有支出的分类" style="margin-bottom:8px;">
        <input type="checkbox" class="cm-hide-empty"${store.hideEmptyCats ? " checked" : ""}>
        <span>隐藏无支出的分类</span>
      </label>
      
      <div class="sort-section">
        <div class="eb-pop-title" style="margin-bottom:4px;">排序管理</div>
        
        <div class="sort-item" data-key="category">
          <div class="sort-item-header">
            <span class="sort-item-title">按类别</span>
            <span class="sort-item-radio"></span>
          </div>
        </div>
        
        <div class="sort-item" data-key="amount">
          <div class="sort-item-header">
            <span class="sort-item-title">按金额</span>
            <span class="sort-item-radio"></span>
          </div>
          <div class="sort-sub-options">
            <button class="sort-sub-btn" data-dir="desc" type="button">降序</button>
            <button class="sort-sub-btn" data-dir="asc" type="button">升序</button>
          </div>
        </div>
        
        <div class="sort-item" data-key="created">
          <div class="sort-item-header">
            <span class="sort-item-title">按创建时间</span>
            <span class="sort-item-radio"></span>
          </div>
          <div class="sort-sub-options">
            <button class="sort-sub-btn" data-dir="desc" type="button">降序</button>
            <button class="sort-sub-btn" data-dir="asc" type="button">升序</button>
          </div>
        </div>
      </div>
    `;
    const listEl = pop.querySelector(".cm-list") as HTMLElement;
    pop.querySelector<HTMLInputElement>(".cm-hide-empty")?.addEventListener("change", (e) => {
      store.setHideEmptyCats((e.target as HTMLInputElement).checked);
    });
    const reposition = () => positionPopover(pop, anchorBtn);
    mountPopover(pop, anchorBtn, () => {
      managerOpen = false;
      render();
    });
    pop.querySelector(".cm-add")!.addEventListener("click", () => addCat());

    // Sort Controls Setup
    const sortItems = pop.querySelectorAll(".sort-section .sort-item");
    const updateSortUI = () => {
      const currentBy = store.sortBy;
      const currentDir = store.sortOrder;
      
      sortItems.forEach((itemEl) => {
        const item = itemEl as HTMLElement;
        const key = item.dataset.key as SortKey;
        const isActive = key === currentBy;
        
        if (isActive) {
          item.classList.add("active");
        } else {
          item.classList.remove("active");
        }
        
        const subOpts = item.querySelector(".sort-sub-options") as HTMLElement;
        if (subOpts) {
          if (isActive) {
            subOpts.style.display = "flex";
          } else {
            subOpts.style.display = "none";
          }
          
          const btns = subOpts.querySelectorAll(".sort-sub-btn");
          btns.forEach((btnEl) => {
            const btn = btnEl as HTMLButtonElement;
            const dir = btn.dataset.dir as SortDir;
            if (dir === currentDir) {
              btn.classList.add("active");
            } else {
              btn.classList.remove("active");
            }
          });
        }
      });
      reposition();
    };
    
    updateSortUI();
    
    sortItems.forEach((itemEl) => {
      const item = itemEl as HTMLElement;
      const key = item.dataset.key as SortKey;
      
      const header = item.querySelector(".sort-item-header") as HTMLElement;
      header.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (store.sortBy !== key) {
          await store.setSortSettings(key, store.sortOrder);
          updateSortUI();
          render();
        }
      });
      
      const subBtns = item.querySelectorAll(".sort-sub-btn");
      subBtns.forEach((btnEl) => {
        const btn = btnEl as HTMLButtonElement;
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const dir = btn.dataset.dir as SortDir;
          await store.setSortSettings(key, dir);
          updateSortUI();
          render();
        });
      });
    });

    paint();

    function paint(): void {
      listEl.innerHTML = "";
      for (const { parent } of store.catTree()) listEl.appendChild(catRow(parent));
      reposition();
    }

    function toggleSwatch(row: HTMLElement, current: string, onPick: (c: string) => void): void {
      const next = row.nextElementSibling;
      if (next?.classList.contains("swatches")) {
        next.remove();
        reposition();
        return;
      }
      listEl.querySelectorAll(".swatches").forEach((s) => s.remove());
      row.after(buildSwatches(current, onPick));
      reposition();
    }

    function editRow(cat: { id: string; name: string; color: string }, row: HTMLElement): void {
      listEl.querySelectorAll(".swatches").forEach((s) => s.remove());
      row.classList.add("editing");
      const nameEl = row.querySelector(".cm-name") as HTMLElement;
      const input = document.createElement("input");
      input.className = "cm-name-input";
      input.value = cat.name;
      nameEl.innerHTML = "";
      nameEl.appendChild(input);
      const ops = row.querySelector(".cm-ops") as HTMLElement;
      ops.classList.add("show");
      ops.innerHTML = `<button class="tx-op save" title="保存">${ICONS.check}</button><button class="tx-op" title="取消">✕</button>`;
      const [saveBtn, cancelBtn] = ops.querySelectorAll<HTMLButtonElement>(".tx-op");
      const commit = async () => {
        const name = input.value.trim();
        if (name && name !== cat.name) await store.updateCategory(cat.id, { name });
        paint();
      };
      saveBtn.addEventListener("click", commit);
      cancelBtn.addEventListener("click", () => paint());
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") paint();
      });
      input.focus();
      input.select();
    }

    function catRow(cat: { id: string; name: string; color: string }): HTMLElement {
      const row = document.createElement("div");
      row.className = "cm-row";
      row.draggable = true;
      row.dataset.id = cat.id;
      row.innerHTML = `
        <span class="cm-grip" title="拖动排序">${ICONS.grip}</span>
        <button class="dot" type="button" style="background:${cat.color}" title="选择颜色"></button>
        <span class="cm-name">${esc(cat.name)}</span>
        <span class="cm-ops">
          <button class="tx-op" title="重命名">${ICONS.edit}</button>
          <button class="tx-op del" title="删除">${ICONS.del}</button>
        </span>`;
      const dot = row.querySelector(".dot") as HTMLElement;
      dot.addEventListener("click", () => toggleSwatch(row, cat.color, async (color) => {
        await store.updateCategory(cat.id, { color });
        paint();
      }));
      row.addEventListener("dblclick", (e) => {
        if ((e.target as HTMLElement).closest(".tx-op, .dot, .swatches")) return;
        editRow(cat, row);
      });
      row.addEventListener("dragstart", (e) => {
        e.dataTransfer?.setData("text/plain", cat.id);
        row.classList.add("dragging");
      });
      row.addEventListener("dragend", () => row.classList.remove("dragging"));
      row.addEventListener("dragover", (e) => {
        e.preventDefault();
        row.classList.add("drop-target");
      });
      row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
      row.addEventListener("drop", async (e) => {
        e.preventDefault();
        row.classList.remove("drop-target");
        const from = e.dataTransfer?.getData("text/plain") || "";
        if (!from || from === cat.id) return;
        const toIndex = store.cats.findIndex((c) => c.id === cat.id);
        await store.moveCategory(from, toIndex);
        paint();
      });
      const [renameBtn, delBtn] = row.querySelectorAll<HTMLButtonElement>(".tx-op");
      renameBtn.addEventListener("click", () => editRow(cat, row));
      delBtn.addEventListener("click", async () => {
        await store.removeCategory(cat.id);
        paint();
      });
      return row;
    }

    function addCat(): void {
      listEl.querySelectorAll(".swatches").forEach((s) => s.remove());
      const used = new Set(store.cats.map((c) => c.color.toUpperCase()));
      let color = PALETTE.find((c) => !used.has(c.toUpperCase())) || PALETTE[0];
      const row = document.createElement("div");
      row.className = "cm-row editing";
      row.innerHTML = `
        <span class="cm-grip">${ICONS.grip}</span>
        <button class="dot" type="button" style="background:${color}" title="选择颜色"></button>
        <span class="cm-name"><input class="cm-name-input" placeholder="分类名"></span>
        <span class="cm-ops show">
          <button class="tx-op save" title="保存">${ICONS.check}</button>
          <button class="tx-op" title="取消">✕</button>
        </span>`;
      listEl.appendChild(row);
      reposition();
      const dot = row.querySelector(".dot") as HTMLElement;
      const input = row.querySelector(".cm-name-input") as HTMLInputElement;
      const [saveBtn, cancelBtn] = row.querySelectorAll<HTMLButtonElement>(".tx-op");
      dot.addEventListener("click", () => toggleSwatch(row, color, (c) => {
        color = c;
        dot.style.background = c;
        const next = row.nextElementSibling;
        if (next?.classList.contains("swatches")) next.remove();
        reposition();
        input.focus();
      }));
      const commit = async () => {
        const name = input.value.trim();
        if (!name) {
          input.focus();
          return;
        }
        await store.addCategory(name, color, null);
        paint();
      };
      saveBtn.addEventListener("click", commit);
      cancelBtn.addEventListener("click", () => paint());
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") paint();
      });
      input.focus();
    }
  }

  render();
  // 宽度等外部变化导致内容回流时，按缓存的配对高度重新贴合
  try {
    const app = document.getElementById("app");
    if (app) new ResizeObserver(() => applyHeight()).observe(app);
  } catch {
    // 不支持 ResizeObserver 时退回到 render 内的显式调用
  }
  return { render };
}

/** 保存截图：优先弹出系统保存对话框，不支持时退回浏览器下载 */
async function saveScreenshotBlob(blob: Blob, fileName: string): Promise<void> {
  type PickerWindow = Window & {
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      startIn?: "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos";
      types?: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<{ createWritable: () => Promise<{ write: (d: Blob) => Promise<void>; close: () => Promise<void> }> }>;
  };
  const picker = (window as PickerWindow).showSaveFilePicker;
  if (picker) {
    const options = {
      suggestedName: fileName,
      startIn: "desktop" as const,
      types: [{ description: "PNG 图片", accept: { "image/png": [".png"] } }]
    };
    try {
      let handle;
      try {
        handle = await picker(options);
      } catch (err) {
        // 某些环境不认 startIn，去掉后重试
        if (!(err instanceof TypeError)) throw err;
        const { startIn, ...rest } = options;
        handle = await picker(rest);
      }
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      // 用户取消保存对话框时直接结束，不退回下载
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** position:fixed 弹层定位：贴锚点下方，超出则上翻，并夹在挂件可见区域内 */
function positionPopover(el: HTMLElement, anchor: HTMLElement): void {
  const margin = 8;
  const gap = 6;
  const r = anchor.getBoundingClientRect();
  const { width, height } = el.getBoundingClientRect();
  const b = popoverBounds(margin);
  let x = r.left;
  if (x + width > b.right) x = r.right - width;
  let y = r.bottom + gap;
  if (y + height > b.bottom && r.top - height - gap >= b.top) y = r.top - height - gap;
  x = Math.min(Math.max(x, b.left), Math.max(b.right - width, b.left));
  y = Math.min(Math.max(y, b.top), Math.max(b.bottom - height, b.top));
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

function popoverBounds(margin: number): { left: number; right: number; top: number; bottom: number } {
  let top = margin;
  let left = margin;
  let right = window.innerWidth - margin;
  let bottom = window.innerHeight - margin;
  try {
    const frame = window.frameElement as HTMLElement | null;
    if (frame && window.parent) {
      const rect = frame.getBoundingClientRect();
      const pw = window.parent.innerWidth;
      const ph = window.parent.innerHeight;
      left = Math.max(margin, -rect.left + margin);
      top = Math.max(margin, -rect.top + margin);
      right = Math.min(window.innerWidth - margin, pw - rect.left - margin);
      bottom = Math.min(window.innerHeight - margin, ph - rect.top - margin);
    }
  } catch {
    // 跨窗口访问失败时退回 iframe 自身视口
  }
  if (right <= left) {
    left = margin;
    right = window.innerWidth - margin;
  }
  if (bottom <= top) {
    top = margin;
    bottom = window.innerHeight - margin;
  }
  return { left, right, top, bottom };
}

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function dateFromIsoWeek(year: number, week: number): Date {
  const d = new Date(year, 0, 4);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day + (week - 1) * 7);
  return d;
}

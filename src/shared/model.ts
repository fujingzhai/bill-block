/** 数据模型与日期/格式化工具，挂件与插件共用 */

export interface Category {
  id: string;
  name: string;
  /** 十六进制颜色 */
  color: string;
  /** 一级分类为 null，二级分类指向父分类 id */
  parentId: string | null;
}

export interface Tx {
  id: string;
  amount: number;
  /** 账目项目，新增记录必填；旧数据可能为空 */
  project?: string;
  /** 空字符串表示未分类 */
  catId: string;
  /** YYYY-MM-DD */
  date: string;
  note: string;
  created: number;
}

export interface LedgerData {
  version: 1;
  updated: string;
  currency: string;
  categories: Category[];
  transactions: Tx[];
  /** 分类图是否隐藏本期无支出的分类，默认 false（全部显示） */
  hideEmptyCats?: boolean;
}

/** 默认 10 色板（Notion / 谷歌日历风格）；用户可在此之外用调色板或色码自定义 */
export const PALETTE = [
  "#E03E3E", // 红
  "#D9730D", // 橙
  "#DFAB01", // 黄
  "#16A34A", // 绿
  "#0F7B6C", // 青
  "#0B6E99", // 蓝
  "#2563EB", // 靛蓝
  "#6940A5", // 紫
  "#AD1A72", // 玫红
  "#9B9A97"  // 灰
];

export const UNCAT = { id: "", name: "未分类", color: "#9B9A97" };

/** 校验并统一为 #RRGGBB 大写；非法时回退到默认色板对应位置 */
export function normalizeCategoryColor(color: string, index = 0): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(color || "");
  if (!m) return PALETTE[index % PALETTE.length];
  return `#${m[1].toUpperCase()}`;
}

/** 判断是否为合法 #RRGGBB 颜色 */
export function isHexColor(color: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(color || "");
}

export function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function defaultData(): LedgerData {
  const cats: Category[] = [];
  const add = (name: string, color: string, parentId: string | null = null) => {
    const c = { id: genId() + cats.length, name, color, parentId };
    cats.push(c);
    return c;
  };
  add("餐饮", PALETTE[0]);
  add("交通", PALETTE[1]);
  add("购物", PALETTE[2]);
  add("娱乐", PALETTE[3]);
  add("居住", PALETTE[4]);
  add("医疗", PALETTE[5]);
  add("学习", PALETTE[6]);
  add("人情", PALETTE[7]);
  add("其他", PALETTE[9]);
  return { version: 1, updated: new Date().toISOString(), currency: "¥", categories: cats, transactions: [] };
}

// ── 日期 ──────────────────────────────────────────────
export type Dim = "week" | "month" | "year";

export function todayStr(): string {
  return dateStr(new Date());
}
export function dateStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function periodStart(d: Date, dim: Dim): Date {
  if (dim === "week") {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - (x.getDay() + 6) % 7);
    return x;
  }
  if (dim === "year") return new Date(d.getFullYear(), 0, 1);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
export function shiftPeriod(start: Date, dim: Dim, n: number): Date {
  const d = new Date(start);
  if (dim === "week") d.setDate(d.getDate() + 7 * n);
  else if (dim === "year") d.setFullYear(d.getFullYear() + n);
  else d.setMonth(d.getMonth() + n);
  return d;
}
export function periodLabel(start: Date, dim: Dim): string {
  if (dim === "week") return weekLabel(start);
  if (dim === "year") return `${start.getFullYear()} 年`;
  return `${start.getFullYear()} 年 ${start.getMonth() + 1} 月`;
}

/** ISO 周序号与所属年份（周一为一周之始，含每年第 4 天的那一周为第 1 周） */
export function isoWeek(d: Date): { year: number; week: number } {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNum = (date.getDay() + 6) % 7; // 周一=0
  date.setDate(date.getDate() - dayNum + 3); // 移到本周周四
  const firstThursday = new Date(date.getFullYear(), 0, 4);
  const firstDayNum = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDayNum + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return { year: date.getFullYear(), week };
}

/** “2026年第24周” */
export function weekLabel(start: Date): string {
  const { year, week } = isoWeek(start);
  return `${year}年第${week}周`;
}

// ── 格式化 ────────────────────────────────────────────
export function fmtMoney(n: number): string {
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}
export const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

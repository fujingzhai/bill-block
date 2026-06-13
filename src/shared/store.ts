import { readWorkspaceFile, writeWorkspaceFile } from "./api";
import { Category, LedgerData, Tx, UNCAT, defaultData, genId, normalizeCategoryColor, SortKey, SortDir } from "./model";

const FILE = "/data/storage/bill-block/data.json";
const BAK_FILE = "/data/storage/bill-block/data.json.bak";
const UNDO_LIMIT = 50;
const CHANNEL = "bill-block";

/** 全部记账块共享同一份账单数据；BroadcastChannel 让同时打开的多个块即时同步 */
export class LedgerStore {
  data: LedgerData = defaultData();
  onRemoteChange?: () => void;
  /** 数据未成功加载（文件损坏或读取失败）时禁止一切写入，防止覆盖原有数据 */
  loadFailed = false;
  private channel: BroadcastChannel | null = null;
  private undoStack: string[] = [];
  private lastGoodText: string | null = null;
  private persistLock: Promise<void> = Promise.resolve();
  private refreshTimer: number | null = null;
  private fileExisted = false;

  constructor() {
    try {
      this.channel = new BroadcastChannel(CHANNEL);
      this.channel.onmessage = async () => {
        try {
          await this.load();
        } catch {
          // 远端同步失败时保留 loadFailed 状态，下次写入会被拦截
        }
        this.undoStack = [];
        this.onRemoteChange?.();
      };
    } catch {
      this.channel = null;
    }
  }

  async load(): Promise<void> {
    let text: string | null;
    try {
      text = await readWorkspaceFile(FILE);
    } catch (err) {
      this.loadFailed = true;
      throw err;
    }
    if (!text) {
      if (this.fileExisted) {
        this.loadFailed = true;
        throw new Error("账单数据读取失败（返回空），已禁止保存以防覆盖");
      }
      this.data = defaultData();
      this.lastGoodText = null;
      this.loadFailed = false;
      return;
    }
    try {
      const parsed = JSON.parse(text) as LedgerData;
      if (!parsed || !Array.isArray(parsed.transactions) || !Array.isArray(parsed.categories)) {
        throw new Error("缺少必要字段");
      }
      this.data = parsed;
      if (!this.data.sortBy) this.data.sortBy = "created";
      if (!this.data.sortOrder) this.data.sortOrder = "desc";
      this.normalizeCategories();
      this.lastGoodText = text;
      this.fileExisted = true;
      this.loadFailed = false;
    } catch {
      this.loadFailed = true;
      throw new Error("账单数据解析失败，已禁止保存以防覆盖（可检查 data/storage/bill-block/data.json）");
    }
  }

  // ── 交易 ────────────────────────────────────────────
  get txs(): Tx[] {
    return this.data.transactions;
  }
  getTx(id: string): Tx | undefined {
    return this.txs.find((t) => t.id === id);
  }
  async addTx(tx: Omit<Tx, "id" | "created">): Promise<Tx> {
    this.ensureWritable();
    this.snapshot();
    const full: Tx = { ...tx, id: genId(), created: Date.now() };
    this.data.transactions.push(full);
    await this.persist();
    return full;
  }
  async updateTx(id: string, patch: Partial<Tx>): Promise<void> {
    this.ensureWritable();
    const tx = this.getTx(id);
    if (!tx) return;
    this.snapshot();
    Object.assign(tx, patch);
    await this.persist();
  }
  async removeTx(id: string): Promise<void> {
    this.ensureWritable();
    if (!this.getTx(id)) return;
    this.snapshot();
    this.data.transactions = this.txs.filter((t) => t.id !== id);
    await this.persist();
  }

  // ── 分类 ────────────────────────────────────────────
  get cats(): Category[] {
    return this.data.categories;
  }
  cat(id: string): Category {
    return this.cats.find((c) => c.id === id) || { ...UNCAT, parentId: null };
  }
  /** 交易的一级分类（二级分类向上归并） */
  topCat(catId: string): Category {
    return this.cat(catId);
  }
  /** [一级分类, 其子分类][]，供选择器与管理面板使用 */
  catTree(): Array<{ parent: Category; children: Category[] }> {
    return this.cats
      .filter((c) => !c.parentId)
      .map((parent) => ({ parent, children: [] }));
  }
  /** 分类显示名：二级分类带上父级前缀 */
  catLabel(catId: string): string {
    return this.cat(catId).name;
  }
  async addCategory(name: string, color: string, parentId: string | null): Promise<Category> {
    this.ensureWritable();
    this.snapshot();
    const cat: Category = { id: genId(), name, color: normalizeCategoryColor(color, this.cats.length), parentId: null };
    this.data.categories.push(cat);
    await this.persist();
    return cat;
  }
  async moveCategory(id: string, toIndex: number): Promise<void> {
    this.ensureWritable();
    const idx = this.cats.findIndex((c) => c.id === id);
    if (idx < 0) return;
    this.snapshot();
    const [cat] = this.data.categories.splice(idx, 1);
    this.data.categories.splice(Math.max(0, Math.min(toIndex, this.data.categories.length)), 0, cat);
    await this.persist();
  }
  async updateCategory(id: string, patch: Partial<Category>): Promise<void> {
    this.ensureWritable();
    const cat = this.cats.find((c) => c.id === id);
    if (!cat) return;
    this.snapshot();
    Object.assign(cat, patch);
    await this.persist();
  }
  /** 删除分类（及其子分类），相关交易归入未分类 */
  async removeCategory(id: string): Promise<void> {
    this.ensureWritable();
    this.snapshot();
    const dead = new Set([id, ...this.cats.filter((c) => c.parentId === id).map((c) => c.id)]);
    this.data.categories = this.cats.filter((c) => !dead.has(c.id));
    for (const tx of this.txs) {
      if (dead.has(tx.catId)) tx.catId = "";
    }
    await this.persist();
  }

  get currency(): string {
    return this.data.currency || "¥";
  }

  // ── 偏好 ────────────────────────────────────────────
  get hideEmptyCats(): boolean {
    return !!this.data.hideEmptyCats;
  }
  async setHideEmptyCats(value: boolean): Promise<void> {
    this.ensureWritable();
    if (this.hideEmptyCats === value) return;
    this.snapshot();
    this.data.hideEmptyCats = value;
    await this.persist();
  }
  get sortBy(): SortKey {
    return this.data.sortBy || "created";
  }
  get sortOrder(): SortDir {
    return this.data.sortOrder || "desc";
  }
  async setSortSettings(by: SortKey, order: SortDir): Promise<void> {
    this.ensureWritable();
    if (this.sortBy === by && this.sortOrder === order) return;
    this.snapshot();
    this.data.sortBy = by;
    this.data.sortOrder = order;
    await this.persist();
  }

  // ── 撤销 ────────────────────────────────────────────
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  async undo(): Promise<boolean> {
    this.ensureWritable();
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.data = JSON.parse(prev);
    await this.persist();
    return true;
  }

  /** 周期性重读数据，兜底跨设备云同步带来的文件变化 */
  startAutoRefresh(intervalMs = 60000): void {
    this.stopAutoRefresh();
    this.refreshTimer = window.setInterval(async () => {
      if (document.hidden) return;
      try {
        const before = this.lastGoodText;
        await this.load();
        if (this.lastGoodText !== before) {
          this.undoStack = [];
          this.onRemoteChange?.();
        }
      } catch {
        // 读取失败时保留 loadFailed 状态，写入会被拦截
      }
    }, intervalMs);
  }
  stopAutoRefresh(): void {
    if (this.refreshTimer !== null) {
      window.clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private ensureWritable(): void {
    if (this.loadFailed) {
      throw new Error("账单数据未正确加载，已禁止修改以防覆盖原有数据");
    }
  }
  private snapshot(): void {
    this.undoStack.push(JSON.stringify(this.data));
    if (this.undoStack.length > UNDO_LIMIT) {
      this.undoStack.shift();
    }
  }

  private normalizeCategories(): void {
    const byId = new Map(this.data.categories.map((cat) => [cat.id, cat]));
    for (const tx of this.data.transactions) {
      const cat = byId.get(tx.catId);
      if (cat?.parentId && byId.has(cat.parentId)) {
        tx.catId = cat.parentId;
      }
    }
    this.data.categories = this.data.categories
      .filter((cat) => !cat.parentId)
      .map((cat, idx) => ({
        ...cat,
        parentId: null,
        color: normalizeCategoryColor(cat.color, idx)
      }));
  }

  private async persist(): Promise<void> {
    this.ensureWritable();
    const run = async () => {
      this.data.updated = new Date().toISOString();
      const text = JSON.stringify(this.data, null, 2);
      if (this.lastGoodText && this.lastGoodText !== text) {
        try {
          await writeWorkspaceFile(BAK_FILE, this.lastGoodText);
        } catch {
          // 备份失败不阻塞正常保存
        }
      }
      await writeWorkspaceFile(FILE, text);
      this.lastGoodText = text;
      this.fileExisted = true;
    };
    // 串行化写入；前一次失败不阻塞本次，错误只抛给各自调用方
    const task = this.persistLock.then(run, run);
    this.persistLock = task.then(() => undefined, () => undefined);
    await task;
    this.channel?.postMessage("changed");
  }
}

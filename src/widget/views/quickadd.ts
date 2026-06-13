import { LedgerStore } from "../../shared/store";
import { fmtMoney } from "../../shared/model";
import { showError, txForm } from "../ui";
import type { ViewHandle } from "../main";

/** 快记视图：供插件全局快捷键/顶栏弹窗内嵌使用，保存后通知宿主关闭 */
export function mountQuickAdd(root: HTMLElement, store: LedgerStore): ViewHandle {
  function notifyHost(saved: { amount: number } | null): void {
    try {
      const channel = new BroadcastChannel("bill-block-ui");
      channel.postMessage(saved
        ? { type: "quickadd-saved", text: `已记一笔 ${store.currency}${fmtMoney(saved.amount)}` }
        : { type: "quickadd-cancel" });
      channel.close();
    } catch {
      // BroadcastChannel 不可用时忽略
    }
  }

  function render(): void {
    if (store.loadFailed) {
      showError(root, "账单数据未正确加载");
      return;
    }
    // 与流水视图的“记一笔”保持一致：同一套快记行卡片
    root.innerHTML = `<div class="qa-page"><div class="quick-card" id="qaForm"></div></div>`;
    const form = txForm(store, {}, {
      submitLabel: "记一笔",
      showCancel: false,
      onSubmit: async (v) => {
        await store.addTx({ ...v });
        notifyHost(v);
      },
      onCancel: () => notifyHost(null)
    });
    root.querySelector("#qaForm")!.appendChild(form);
    (form.querySelector(".q-project") as HTMLInputElement).focus();
  }

  render();
  return { render };
}

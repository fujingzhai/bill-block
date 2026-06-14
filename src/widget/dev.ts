// 独立调试入口：mock 思源内核 API，用演示数据挂载记账块。仅开发用，不进打包。
import demoText from "./_demo.json?raw";
import "./widget.css";
import { syncTheme } from "./theme";
import { mountBillApp } from "./views/app";
import { LedgerStore } from "../shared/store";

// 内存中的账单文件，putFile 写回这里，getFile 读这里
let fileStore = demoText;

const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, msg: "", data }), { headers: { "Content-Type": "application/json" } });

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("/api/file/getFile")) {
    return new Response(fileStore, { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.includes("/api/file/putFile")) {
    const form = init?.body as FormData | undefined;
    const blob = form?.get("file") as Blob | undefined;
    if (blob) fileStore = await blob.text();
    return ok(null);
  }
  if (url.includes("/api/attr/getBlockAttrs")) return ok({});
  if (url.includes("/api/attr/setBlockAttrs")) return ok(null);
  return realFetch(input as RequestInfo, init);
}) as typeof window.fetch;

(async function init() {
  syncTheme();
  const root = document.getElementById("app") as HTMLElement;
  const sp = new URLSearchParams(location.search);
  const view = (sp.get("view") as "flow" | "week" | "month" | "stats") || "flow";
  const dark = sp.get("dark") === "1";
  const panel = sp.get("mode") === "panel";
  if (dark) document.documentElement.classList.add("dark");
  const store = new LedgerStore();
  await store.load();
  const handle = mountBillApp(root, store, { initial: view, panel });
  store.onRemoteChange = () => handle.render();
})();

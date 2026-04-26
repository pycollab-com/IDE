import { copyText as copyTextViaBridge } from "./desktopBridge";

export async function copyText(value) {
  const text = String(value ?? "");
  if (!text) {
    return { ok: false };
  }

  return copyTextViaBridge(text);
}

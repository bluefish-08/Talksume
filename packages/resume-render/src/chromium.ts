import { type Browser, chromium } from "playwright";

let browserPromise: Promise<Browser> | undefined;

export function getBrowser(): Promise<Browser> {
  if (browserPromise) return browserPromise;
  const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;
  const launching = chromium.launch(executablePath ? { executablePath } : {});
  browserPromise = launching;
  const reset = () => {
    if (browserPromise === launching) browserPromise = undefined;
  };
  launching.then((browser) => browser.on("disconnected", reset), reset);
  return launching;
}

export async function close(): Promise<void> {
  const pending = browserPromise;
  browserPromise = undefined;
  if (pending) await (await pending).close();
}

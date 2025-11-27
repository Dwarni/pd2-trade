import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import {currentMonitor, cursorPosition, WindowOptions} from '@tauri-apps/api/window';
import {WebviewOptions} from "@tauri-apps/api/webview";
import {invoke} from "@tauri-apps/api/core";

export async function openCenteredWindow(
  label: string,
  url: string,
  options: Partial<WebviewOptions & WindowOptions> = {}
): Promise<WebviewWindow | null> {
  const monitor = await currentMonitor();
  if (!monitor) return null;

  const width = options.width ?? 600;
  const height = options.height ?? 600;

  const { position, size } = monitor;
  const x = position.x + Math.round((size.width - width) / 2);
  const y = position.y + Math.round((size.height - height) / 2);

  const w = new WebviewWindow(label, {
    url,
    x,
    y,
    width,
    height,
    focus: true,
    ...options,
  });

  return w;
}

export async function openOverDiabloWindow(
  label: string,
  url: string,
  options: Partial<WebviewOptions & WindowOptions> = {}
): Promise<WebviewWindow | null> {
  try {
    const { x: cursorX } = await cursorPosition();
    const rect = await invoke<{ x: number; y: number; width: number; height: number }>('get_diablo_rect');

    const width = options.width ?? 500;
    const x = cursorX - width;
    const y = rect.y;

    const w = new WebviewWindow(label, {
      url,
      x,
      y,
      width,
      height: rect.height,
      minHeight: 1080,
      focus: true,
      ...options,
    });

    return w;
  } catch (e) {
    console.warn('[openOverDiabloWindow] fallback to center:', e);
    return openCenteredWindow(label, url, options);
  }
}

export async function openWindowAtCursor(
  label: string,
  url: string,
  options: Partial<WebviewOptions & WindowOptions> = {}
): Promise<WebviewWindow | null> {
  try {
    const { x, y } = await cursorPosition();
    const width = options.width ?? 600;
    const height = options.height ?? 600;

    const w = new WebviewWindow(label, {
      url,
      x,
      y,
      width,
      height,
      focus: true,
      ...options,
    });

    return w;
  } catch (e) {
    console.warn('[openWindowAtCursor] fallback to center:', e);
    return openCenteredWindow(label, url, options);
  }
}

export function attachWindowLifecycle(
  w: WebviewWindow,
  onClose: () => void
) {
  w.onCloseRequested(() => {
    onClose();
  });

  w.onFocusChanged((event) => {
    if (!event.payload) {
      w.close();
      onClose();
    }
  });
}

export function attachWindowCloseHandler(
  w: WebviewWindow,
  onClose: () => void,
  onFocusLost?: () => void,
) {
  w.onCloseRequested(() => {
    onClose();
  });

  let focusLossTimeout: ReturnType<typeof setTimeout> | null = null;

  w.onFocusChanged((event) => {
    if (!event.payload) {
      // Add a small delay before hiding to prevent closing during drag operations
      // This allows the window to regain focus if it was just a brief loss during dragging
      focusLossTimeout = setTimeout(() => {
        w.hide();

        if (onFocusLost) {
          onFocusLost();
        }
        focusLossTimeout = null;
      }, 150);
    } else {
      // Window regained focus, cancel the hide timeout
      if (focusLossTimeout) {
        clearTimeout(focusLossTimeout);
        focusLossTimeout = null;
      }
    }
  });
}

export async function updateMainWindowBounds(): Promise<void> {
  try {
    await invoke('update_window_bounds');
  } catch (e) {
    console.warn('[updateMainWindowBounds] failed:', e);
  }
}
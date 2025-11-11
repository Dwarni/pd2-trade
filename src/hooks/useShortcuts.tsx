import { useEffect, useRef, useMemo } from 'react';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';
import { isTauri } from '@tauri-apps/api/core';
import { useOptions } from './useOptions';

type ShortcutHandler = () => void | Promise<void>;

interface ShortcutConfig {
  modifier: 'ctrl' | 'alt';
  key: string;
  handler: ShortcutHandler;
}

const formatShortcut = (modifier: 'ctrl' | 'alt', key: string): string => {
  return `${modifier === 'ctrl' ? 'Control' : 'Alt'}+${key.toUpperCase()}`;
};

export const useShortcuts = (shortcuts: ShortcutConfig[]) => {
  const registeredShortcuts = useRef<string[]>([]);

  useEffect(() => {
    if (!isTauri()) return;

    const registerShortcuts = async () => {
      // Unregister previous shortcuts
      for (const shortcut of registeredShortcuts.current) {
        try {
          await unregister(shortcut);
        } catch {
          // Ignore errors
        }
      }
      registeredShortcuts.current = [];

      // Register new shortcuts
      for (const { modifier, key, handler } of shortcuts) {
        const shortcut = formatShortcut(modifier, key);
        try {
          await register(shortcut, (e) => {
            if (e.state === 'Pressed') {
              handler();
            }
          });
          registeredShortcuts.current.push(shortcut);
        } catch (error) {
          console.error(`Failed to register shortcut ${shortcut}:`, error);
        }
      }
    };

    registerShortcuts();

    return () => {
      registeredShortcuts.current.forEach((shortcut) => {
        unregister(shortcut).catch(() => void 0);
      });
      registeredShortcuts.current = [];
    };
  }, [shortcuts]);
};

export const useAppShortcuts = (
  onItemSearch: ShortcutHandler,
  onQuickList: ShortcutHandler,
  onCurrencyValuation: ShortcutHandler
) => {
  const { settings, isLoading } = useOptions();

  const shortcuts = useMemo<ShortcutConfig[]>(() => {
    if (isLoading) return [];

    const configs: ShortcutConfig[] = [];

    if (settings.hotkeyKey) {
      configs.push({
        modifier: settings.hotkeyModifier,
        key: settings.hotkeyKey,
        handler: onItemSearch,
      });
    }

    if (settings.hotkeyKeyListItem) {
      configs.push({
        modifier: settings.hotkeyModifierListItem,
        key: settings.hotkeyKeyListItem,
        handler: onQuickList,
      });
    }

    if (settings.hotkeyKeyCurrencyValuation) {
      configs.push({
        modifier: settings.hotkeyModifierCurrencyValuation,
        key: settings.hotkeyKeyCurrencyValuation,
        handler: onCurrencyValuation,
      });
    }

    return configs;
  }, [
    isLoading,
    settings.hotkeyModifier,
    settings.hotkeyKey,
    settings.hotkeyModifierListItem,
    settings.hotkeyKeyListItem,
    settings.hotkeyModifierCurrencyValuation,
    settings.hotkeyKeyCurrencyValuation,
    onItemSearch,
    onQuickList,
    onCurrencyValuation,
  ]);

  useShortcuts(shortcuts);
};


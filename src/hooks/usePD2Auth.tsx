import { useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { jwtDecode } from 'jwt-decode';
import { useOptions } from './useOptions';
import { GenericToastPayload } from '@/common/types/Events';

const openAuthWebview = async () => {
  try {
    await invoke('open_project_diablo2_webview');
  } catch (error) {
    console.error('Failed to open Project Diablo 2 webview:', error);
  }
};

const isTokenExpiringSoon = (token: string): boolean => {
  try {
    const payload: { exp?: number } = jwtDecode(token);
    if (!payload.exp) return true;
    
    const now = Math.floor(Date.now() / 1000);
    const fiveHours = 5 * 60 * 60;
    return payload.exp < now + fiveHours;
  } catch {
    return true;
  }
};

export const usePD2Auth = () => {
  const { settings, isLoading, updateSettings } = useOptions();

  // Listen for token updates
  useEffect(() => {
    if (!isTauri()) return;
    
    let unlisten: (() => void) | undefined;
    
    listen<string>('pd2-token-found', (event) => {
      updateSettings({ pd2Token: event.payload });
      const successToastPayload: GenericToastPayload = {
        title: 'PD2 Trader',
        description: 'Authentication successful!',
      };
      emit('toast-event', successToastPayload);
    }).then((off) => {
      unlisten = off;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [updateSettings]);

  // Check token validity and prompt for auth if needed
  useEffect(() => {
    if (isLoading) return;

    if (!settings?.pd2Token) {
      const authRequiredToastPayload: GenericToastPayload = {
        title: 'PD2 Trader',
        description: 'PD2 website authentication required!',
      };
      emit('toast-event', authRequiredToastPayload);
      openAuthWebview();
      return;
    }

    if (isTokenExpiringSoon(settings.pd2Token)) {
      openAuthWebview();
    }
  }, [settings?.pd2Token, isLoading]);
};


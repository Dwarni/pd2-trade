import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import { GenericToastPayload } from '@/common/types/Events';
import { useOptions } from '@/hooks/useOptions';
import poeWhisperSound from '@/assets/poe_whisper.mp3';

interface WhisperEvent {
  isTrade: boolean;
  from: string;
  message: string;
  itemName?: string;
}

// Play the notification sound from assets
function playNotificationSound() {
  try {
    const audio = new Audio(poeWhisperSound);
    audio.volume = 0.7; // Set volume to 70%
    audio.play().catch((error) => {
      console.error('Failed to play notification sound:', error);
    });
  } catch (error) {
    console.error('Failed to create audio element:', error);
  }
}

export const useWhisperNotifications = (enabled: boolean) => {
  const unlistenRef = useRef<(() => void) | null>(null);
  const { settings } = useOptions();

  useEffect(() => {
    if (!isTauri() || !enabled) {
      return;
    }

    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      try {
        unlisten = await listen<WhisperEvent>('whisper-received', async (event) => {
          const whisper = event.payload;
          
          // Normalize name (case-insensitive, ignore "*" prefix)
          const normalizeName = (name: string) => name.toLowerCase().replace(/^\*/, '');
          const whisperFromNormalized = normalizeName(whisper.from);
          
          // Check if it's an announcement (default: ignore unless enabled)
          const isAnnouncement = whisperFromNormalized === 'announcements';
          if (isAnnouncement && !(settings?.whisperAnnouncementsEnabled ?? false)) {
            return; // Skip announcements by default
          }
          
          // Check if player is in ignore list
          const ignoreList = settings?.whisperIgnoreList || [];
          const isIgnored = ignoreList.some(
            (ignoredPlayer) => normalizeName(ignoredPlayer) === whisperFromNormalized
          );
          
          if (isIgnored) {
            return; // Skip ignored players
          }
          
          // Check if Diablo is focused
          const isDiabloFocused = await invoke<boolean>('is_diablo_focused');
          
          // For trade whispers, always notify
          // For normal whispers, only notify if Diablo is not focused
          if (whisper.isTrade || !isDiabloFocused) {
            // Play notification sound
            playNotificationSound();

            // For trade whispers, show toast with item name
            if (whisper.isTrade && whisper.itemName) {
              const toastPayload: GenericToastPayload = {
                title: 'Trade Whisper',
                description: `${whisper.from}: ${whisper.itemName}`,
                duration: 5000,
                variant: 'success',
              };
              emit('toast-event', toastPayload);
            }
          }
        });

        unlistenRef.current = unlisten;
      } catch (error) {
        console.error('Failed to set up whisper listener:', error);
      }
    };

    setupListener();

    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, [enabled, settings?.whisperIgnoreList, settings?.whisperAnnouncementsEnabled]);
};


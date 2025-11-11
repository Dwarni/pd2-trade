import { ItemLocation } from '@/common/types/Location';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const escapeUnicode = (str: string): string => {
  return unescape(encodeURIComponent(str));
};

export const encodeItem = (raw: string): string => {
  return encodeURIComponent(btoa(escapeUnicode(raw)));
};

export const encodeItemForQuickList = (raw: string): string => {
  return btoa(escapeUnicode(raw));
};

export const clipboardContainsValidItem = (jsonString: string): boolean => {
  try {
    const item = JSON.parse(jsonString);
    if (typeof item !== 'object' || item === null) return false;
    
    return (
      typeof item.quality === 'string' &&
      typeof item.type === 'string' &&
      typeof item.iLevel === 'number' &&
      Array.isArray(item.stats)
    );
  } catch {
    return false;
  }
};

export const isStashItem = (jsonString: string): boolean => {
  try {
    const item = JSON.parse(jsonString);
    return item.location === ItemLocation.STASH;
  } catch {
    return false;
  }
};

export { sleep };


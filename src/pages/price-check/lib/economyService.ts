import { RUNE_HIERARCHY } from '@/common/constants';
import { ECONOMY_API_MAP, FIXED_RUNE_PRICES, ALL_RUNE_HR_VALUES } from './constants';
import { EconomyData, EconomyValue, ItemData, ItemValue, RuneCombination } from './types';

export async function fetchEconomyData(): Promise<{
  Runes: Record<string, ItemData>;
  Currency: Record<string, ItemData>;
  Ubers: Record<string, ItemData>;
}> {
  // pd2.tools is inactive - return empty data structures
  // Runes will be calculated using fixed prices only
  return {
    Runes: {},
    Currency: {},
    Ubers: {},
  };
}

export function getLatestRuneData(runeData: Record<string, ItemData>, runeName: string) {
  const data = runeData[runeName];
  if (!data || !data.dataByIngestionDate.length) return null;
  return data.dataByIngestionDate[data.dataByIngestionDate.length - 1];
}

export function sortItemsByPrice(runeData: Record<string, ItemData>) {
  // Use fixed prices only - sort by hierarchy and fixed prices
  return Object.keys(ECONOMY_API_MAP.Runes)
    .map((runeName) => ({
      name: runeName,
      data: null, // No API data available
    }))
    .sort((a, b) => {
      const aIndex = RUNE_HIERARCHY.indexOf(a.name);
      const bIndex = RUNE_HIERARCHY.indexOf(b.name);

      if (aIndex !== -1 && bIndex !== -1) {
        return aIndex - bIndex;
      }

      const aPrice = FIXED_RUNE_PRICES[a.name] || ALL_RUNE_HR_VALUES[a.name] || 0;
      const bPrice = FIXED_RUNE_PRICES[b.name] || ALL_RUNE_HR_VALUES[b.name] || 0;
      return bPrice - aPrice;
    });
}

export function calculateRuneValues(sortedRunes: Array<{ name: string; data: any }>): ItemValue[] {
  const runeValues: ItemValue[] = [];

  // Add all fixed runes from FIXED_RUNE_PRICES
  Object.entries(FIXED_RUNE_PRICES).forEach(([runeName, fixedPrice]) => {
    runeValues.push({
      name: runeName,
      price: fixedPrice,
      numListings: -1,
      isCalculated: false,
      isFixed: true,
    });
  });

  // Add all runes from ALL_RUNE_HR_VALUES that aren't in FIXED_RUNE_PRICES
  sortedRunes.forEach((rune) => {
    if (FIXED_RUNE_PRICES[rune.name]) return;

    const hrValue = ALL_RUNE_HR_VALUES[rune.name];
    if (hrValue) {
      runeValues.push({
        name: rune.name,
        price: hrValue,
        numListings: -1,
        isCalculated: false,
        isFixed: true,
      });
    }
  });

  return runeValues.sort((a, b) => b.price - a.price);
}

export function calculateEconomyValues(input: EconomyData): EconomyValue {
  const economyValues: EconomyValue = {
    Runes: [],
    Currency: [],
    Ubers: [],
  };

  // --- Handle Runes using fixed prices only ---
  const runeValues: ItemValue[] = [];

  // Add all fixed runes from FIXED_RUNE_PRICES
  Object.entries(FIXED_RUNE_PRICES).forEach(([name, fixedPrice]) => {
    runeValues.push({
      name,
      price: fixedPrice,
      numListings: -1,
      isCalculated: false,
      isFixed: true,
    });
  });

  // Add all runes from ALL_RUNE_HR_VALUES that aren't in FIXED_RUNE_PRICES
  Object.entries(ALL_RUNE_HR_VALUES).forEach(([name, hrValue]) => {
    if (!FIXED_RUNE_PRICES[name]) {
      runeValues.push({
        name,
        price: hrValue,
        numListings: -1,
        isCalculated: false,
        isFixed: true,
      });
    }
  });

  economyValues.Runes = runeValues.sort((a, b) => b.price - a.price);

  // Currency and Ubers are disabled - return empty arrays
  economyValues.Currency = [];
  economyValues.Ubers = [];

  return economyValues;
}

export function getRuneBreakdown(targetRuneName: string, calculatedRuneValues: ItemValue[]): RuneCombination[] {
  const targetRune = calculatedRuneValues.find((r) => r.name === targetRuneName);
  if (!targetRune || targetRuneName === 'Lem Rune') return [];

  const targetValue = targetRune.price;
  const combinations: RuneCombination[] = [];

  const availableRunes = calculatedRuneValues
    .filter((r) => r.price <= targetValue && r.name !== targetRuneName)
    .sort((a, b) => b.price - a.price);

  const findCombinations = (
    currentRunes: Array<{ name: string; price: number; count: number }>,
    remainingValue: number,
    startIndex: number,
  ) => {
    const tolerance = Math.max(0.01, targetValue * 0.05);

    if (remainingValue <= tolerance) {
      const totalValue = currentRunes.reduce((sum, r) => sum + r.price * r.count, 0);
      combinations.push({
        runes: [...currentRunes],
        totalValue,
        difference: Math.abs(targetValue - totalValue),
      });
      return;
    }

    for (let i = startIndex; i < availableRunes.length; i++) {
      const rune = availableRunes[i];
      const maxCount = Math.floor(remainingValue / rune.price);
      const maxSameRune = targetValue < 0.1 ? 5 : 3;

      for (let count = 1; count <= maxCount && count <= maxSameRune; count++) {
        const newRemaining = remainingValue - rune.price * count;
        const existingRuneIndex = currentRunes.findIndex((r) => r.name === rune.name);

        if (existingRuneIndex >= 0) {
          currentRunes[existingRuneIndex].count += count;
        } else {
          currentRunes.push({ name: rune.name, price: rune.price, count });
        }

        findCombinations(currentRunes, newRemaining, i + 1);

        if (existingRuneIndex >= 0) {
          currentRunes[existingRuneIndex].count -= count;
          if (currentRunes[existingRuneIndex].count <= 0) {
            currentRunes.splice(existingRuneIndex, 1);
          }
        } else {
          currentRunes.pop();
        }
      }
    }
  };

  findCombinations([], targetValue, 0);

  return combinations.sort((a, b) => a.difference - b.difference).slice(0, 5);
}

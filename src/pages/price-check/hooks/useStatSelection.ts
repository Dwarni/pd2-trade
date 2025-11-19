import { useState, useMemo } from "react";
import { Stat } from "../lib/interfaces";
import { StatId, statRemap, statRemapByName, PRIORITY_STATS, STRIP_STATS } from "../lib/stat-mappings";
import { getStatKey } from "../lib/utils";
import { useOptions } from "@/hooks/useOptions";

/**
 * Combines enhanced minimum damage (stat_id 18) and enhanced maximum damage (stat_id 17)
 * into a single "Enhanced Damage" stat (stat_id 998)
 */
function combineEnhancedDamageStats(stats: Stat[], itemType?: string, rangeMargin: number = 0.05): Stat[] {
  const minDamageStat = stats.find(s => s.stat_id === 18); // item_mindamage_percent
  const maxDamageStat = stats.find(s => s.stat_id === 17); // item_maxdamage_percent
  const existingEnhancedDamageStat = stats.find(s => s.stat_id === 998);

  // Filter out stats 17, 18, and any existing 998 to avoid duplicates
  const filteredStats = stats.filter(s => s.stat_id !== 17 && s.stat_id !== 18 && s.stat_id !== 998);

  // Helper function to apply range margin
  const applyRangeMargin = (value: number | undefined, range: { min?: number; max?: number } | undefined) => {
    if (!value) return range;
    const margin = Math.ceil(value * rangeMargin);
    return {
      min: range?.min !== undefined ? Math.max(value - margin, range.min) : value - margin,
      max: range?.max !== undefined ? Math.min(value + margin, range.max) : value + margin,
    };
  };

  // For jewels, enhanced damage is always 5-40%
  const isJewel = itemType === "Jewel";
  const jewelRange = isJewel ? { min: 5, max: 40 } : undefined;

  // If both min and max damage stats exist, combine them
  if (minDamageStat && maxDamageStat) {
    const combinedValue = maxDamageStat.value ?? minDamageStat.value ?? 0;
    const combinedRange = jewelRange ?? {
      min: minDamageStat.range?.min ?? minDamageStat.value ?? 0,
      max: maxDamageStat.range?.max ?? maxDamageStat.value ?? 0,
    };
    const combinedStat: Stat = {
      stat_id: 998,
      name: "% Enhanced Damage",
      value: combinedValue,
      range: isJewel ? combinedRange : applyRangeMargin(combinedValue, combinedRange),
    };
    return [...filteredStats, combinedStat];
  }

  // If only min damage exists, convert it to the combined stat
  if (minDamageStat) {
    const range = jewelRange ?? minDamageStat.range;
    const combinedStat: Stat = {
      stat_id: 998,
      name: "% Enhanced Damage",
      value: minDamageStat.value,
      range: isJewel ? range : applyRangeMargin(minDamageStat.value, range),
    };
    return [...filteredStats, combinedStat];
  }

  // If only max damage exists, convert it to the combined stat
  if (maxDamageStat) {
    const range = jewelRange ?? maxDamageStat.range;
    const combinedStat: Stat = {
      stat_id: 998,
      name: "% Enhanced Damage",
      value: maxDamageStat.value,
      range: isJewel ? range : applyRangeMargin(maxDamageStat.value, range),
    };
    return [...filteredStats, combinedStat];
  }

  // If no 17/18 stats but existing 998 exists, keep it (but update range if jewel)
  if (existingEnhancedDamageStat) {
    if (isJewel && existingEnhancedDamageStat.stat_id === 998) {
      const updatedStat: Stat = {
        ...existingEnhancedDamageStat,
        range: jewelRange,
      };
      return [...filteredStats, updatedStat];
    }
    return [...filteredStats, existingEnhancedDamageStat];
  }

  return filteredStats;
}

export function useStatSelection(item: any) {
  const { settings } = useOptions();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<Record<string, { value?: string; min?: string; max?: string }>>({});

  // Get range margin from settings (convert percentage 0-100 to decimal 0-1)
  // Default to 5% (0.05) if not set
  const rangeMargin = useMemo(() => {
    const fillStatValue = settings?.fillStatValue ?? 5;
    return fillStatValue / 100;
  }, [settings?.fillStatValue]);

  // Sort stats once with useMemo so it's cheap
  const sortedStats = useMemo(() => {
    const baseStats = [];

    // Inject sockets as a pseudo-stat row
    if (item.sockets != null) {
      baseStats.push({
        stat_id: StatId.Socket, // use a unique negative ID to avoid conflicts
        name: "Sockets",
        value: item.sockets,
        range: { min: item.sockets, max: item.sockets },
      });
    }

    if (item.isEthereal) {
      baseStats.push({
        stat_id: StatId.Ethereal, // use a unique negative ID to avoid conflicts
        name: "Ethereal"
      });
    }

    // Combine enhanced damage stats before processing
    const combinedStats = combineEnhancedDamageStats(item.stats, item.type, rangeMargin);

    return [...combinedStats, ...baseStats].sort((a: Stat, b: Stat) => {
      const pa = PRIORITY_STATS.includes(a.stat_id) ? 0 : 1;
      const pb = PRIORITY_STATS.includes(b.stat_id) ? 0 : 1;
      return pa - pb;             // priority first, others after
    }).map((stat: Stat) => {
      if (stat.stat_id in statRemap) {
        return statRemap[stat.stat_id];
      }
      if (stat.name in statRemapByName) {
        return {...stat, ...statRemapByName[stat.name]}
      }
      if ("skill" in stat && stat.skill) {
        return {...stat, name: stat.skill} // use skill name as display name
      }
      return stat;
    }).filter((stat) => !STRIP_STATS.includes(stat.stat_id));
  }, [item.stats, item.sockets, rangeMargin]);

  const updateFilter = (
    key: string,
    field: "value" | "min" | "max",
    val: string
  ) =>
    setFilters((f) => ({
      ...f,
      [key]: { ...f[key], [field]: val },
    }));

  /** Toggle selection and initialise filter defaults */
  const toggle = (stat: Stat) => {
    const key = getStatKey(stat);
    setSelected((prev) => {
      const next = new Set([...prev]);
      if (next.has(key)) {
        next.delete(key);
        setFilters((f) => {
          const { [key]: _removed, ...rest } = f;
          return rest;
        });
      } else {
        next.add(key);
        setFilters((f) => {
          const v = stat.value ?? 0;

          if (stat.range) {
            const margin = Math.ceil(v * rangeMargin);
            const min = Math.max(v - margin, stat.range.min);
            const max = Math.min(v + margin, stat.range.max);

            return {
              ...f,
              [key]: {
                min: String(min),
                max: String(max),
              },
            };
          }

          return {
            ...f,
            [key]: {
              min: String(v),
              max: String(v),
            },
          };
        });
      }
      return next;
    });
  };

  return {
    selected,
    setSelected,
    filters,
    setFilters,
    sortedStats,
    updateFilter,
    toggle
  };
} 
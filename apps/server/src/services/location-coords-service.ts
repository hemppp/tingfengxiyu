// ============================================================
// 虚拟地图坐标分配服务
// ============================================================

import type { Location } from '@novel/shared';

const MAP_BOUNDS = { minLat: -60, maxLat: 60, minLng: -170, maxLng: 170 };

interface CoordCluster {
  centerLat: number;
  centerLng: number;
  radius: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function deterministicFraction(seed: string): number {
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) + hash + seed.charCodeAt(i)) | 0;
  }
  return ((hash >>> 0) % 10000) / 10000;
}

function clampLat(v: number): number {
  return Math.max(MAP_BOUNDS.minLat, Math.min(MAP_BOUNDS.maxLat, v));
}

function clampLng(v: number): number {
  return Math.max(MAP_BOUNDS.minLng, Math.min(MAP_BOUNDS.maxLng, v));
}

export interface AutoCoordsResult {
  updatedLocations: Location[];
  assignedCount: number;
}

export function assignAutoCoords(locations: Location[]): AutoCoordsResult {
  const withoutCoords = locations.filter(l =>
    (l.latitude == null || l.longitude == null) &&
    l.chapters.length > 0
  );
  if (withoutCoords.length === 0) {
    return { updatedLocations: locations, assignedCount: 0 };
  }

  const regions: CoordCluster[] = [
    { centerLat: -30, centerLng: -120, radius: 40 },
    { centerLat: -30, centerLng: 120, radius: 40 },
    { centerLat: 30, centerLng: -120, radius: 40 },
    { centerLat: 30, centerLng: 120, radius: 40 },
    { centerLat: 0, centerLng: 0, radius: 50 },
    { centerLat: -50, centerLng: 0, radius: 30 },
    { centerLat: 0, centerLng: -60, radius: 30 },
    { centerLat: 0, centerLng: 60, radius: 30 },
  ];

  const worldGroups = new Map<string, Location[]>();
  const chapterGroups = new Map<number, Location[]>();

  for (const loc of withoutCoords) {
    if (loc.world) {
      const list = worldGroups.get(loc.world) || [];
      list.push(loc);
      worldGroups.set(loc.world, list);
    } else {
      const order = loc.chapters[0] ?? 1;
      const list = chapterGroups.get(order) || [];
      list.push(loc);
      chapterGroups.set(order, list);
    }
  }

  const usedRegions = new Set<number>();
  let groupIdx = 0;
  const assigned = new Map<string, Partial<Location>>();

  for (const [world, group] of worldGroups) {
    const regionIdx = groupIdx % regions.length;
    usedRegions.add(regionIdx);
    const region = regions[regionIdx % regions.length] ?? regions[0]!;
    if (!region) continue;
    const angleStep = (2 * Math.PI) / Math.max(group.length, 1);

    group.forEach((loc, i) => {
      const angle = angleStep * i + (deterministicFraction(`world:${world}`) * 0.5);
      const d = deterministicFraction(`loc:${loc.id}`);
      const dist = region.radius * (0.3 + d * 0.7);
      const lat = region.centerLat + dist * Math.cos(angle);
      const lng = region.centerLng + dist * Math.sin(angle);
      assigned.set(loc.id, {
        latitude: clampLat(lat),
        longitude: clampLng(lng),
        mapZoom: 8,
        updatedAt: Date.now(),
      });
    });
    groupIdx++;
  }

  for (const [order, group] of chapterGroups) {
    let regionIdx = (order - 1 + groupIdx) % regions.length;
    for (let offset = 0; offset < regions.length; offset++) {
      const idx = (regionIdx + offset) % regions.length;
      if (!usedRegions.has(idx)) {
        regionIdx = idx;
        break;
      }
    }
    usedRegions.add(regionIdx);

    const region = regions[regionIdx % regions.length] ?? regions[0]!;
    if (!region) continue;
    const angleStep = (2 * Math.PI) / Math.max(group.length, 1);

    group.forEach((loc, i) => {
      const angle = angleStep * i + (order * 0.5);
      const d = deterministicFraction(`loc:${loc.id}`);
      const dist = region.radius * (0.3 + d * 0.7);
      const lat = region.centerLat + dist * Math.cos(angle);
      const lng = region.centerLng + dist * Math.sin(angle);
      assigned.set(loc.id, {
        latitude: clamp(lat, MAP_BOUNDS.minLat, MAP_BOUNDS.maxLat),
        longitude: clamp(lng, MAP_BOUNDS.minLng, MAP_BOUNDS.maxLng),
        mapZoom: 8,
        updatedAt: Date.now(),
      });
    });
  }

  const updatedLocations = locations.map(loc => {
    const updates = assigned.get(loc.id);
    return updates ? { ...loc, ...updates } : loc;
  });

  return {
    updatedLocations,
    assignedCount: assigned.size,
  };
}

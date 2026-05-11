export interface VendorProfile {
  name: string
  match: (model: string) => boolean
  normalizeRaw: (id: number, raw: number) => number
}

export const VENDOR_PROFILES: VendorProfile[] = [
  {
    name: 'Seagate',
    match: (m) => m.toLowerCase().includes('seagate') || m.toLowerCase().includes('st'),
    normalizeRaw: (id, raw) => {
      // Seagate uses high bits for something else in 1, 7, 195
      if ([1, 7, 195].includes(id)) {
        return raw & 0xffffffff; // Mask to lower 32 bits which usually contains the actual error count
      }
      return raw;
    }
  },
  {
    name: 'Samsung',
    match: (m) => m.toLowerCase().includes('samsung'),
    normalizeRaw: (id, raw) => raw
  },
  {
    name: 'Western Digital',
    match: (m) => m.toLowerCase().includes('wd') || m.toLowerCase().includes('western digital'),
    normalizeRaw: (id, raw) => raw
  }
];

export function getVendorProfile(model: string): VendorProfile | undefined {
  return VENDOR_PROFILES.find(p => p.match(model));
}

export function normalizeSmartValue(model: string, id: number, raw: number): number {
  const profile = getVendorProfile(model);
  if (profile) {
    return profile.normalizeRaw(id, raw);
  }
  return raw;
}

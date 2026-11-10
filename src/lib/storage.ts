import type { PaletteColor } from "./grid.ts";
import { paletteFromColors, validatePaletteDraft, type Palette } from "./palette.ts";
import type { PricingFields } from "./quoteForm.ts";

const DB_NAME = "pindou-workshop";
const DB_VERSION = 1;
const PREF_ID = "preferences";

export interface StoredProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  origin: "upload" | "sample";
  sampleId: string | null;
  imageBlob: Blob;
  scaledDown: boolean;
  longestSide: number;
  maxColors: number;
  alphaThreshold: number;
  paletteColors: Array<Pick<PaletteColor, "code" | "name" | "hex">>;
  paletteKind: "sample" | "custom";
  pricing: PricingFields;
  unitPriceOverrides: Record<string, string>;
  finalPriceYuan: string | null;
  totalBeads: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  origin: "upload" | "sample";
  sampleId: string | null;
  totalBeads: number;
}

interface StoredPreferences {
  id: typeof PREF_ID;
  paletteColors: Array<Pick<PaletteColor, "code" | "name" | "hex">> | null;
  pricing: PricingFields | null;
}

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("此浏览器没有 IndexedDB，不能把方案留在本地。"));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开本地数据库"));
  });
}

async function withStore<T>(
  storeName: "projects" | "settings",
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (handler: () => void) => {
        if (settled) return;
        settled = true;
        handler();
      };
      const tx = db.transaction(storeName, mode);
      const request = run(tx.objectStore(storeName));
      tx.oncomplete = () => finish(() => resolve(request.result));
      tx.onerror = () => finish(() => reject(tx.error ?? new Error("本地存储读写失败")));
      tx.onabort = () => finish(() => reject(tx.error ?? new Error("本地存储已中断")));
    });
  } finally {
    db.close();
  }
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const records = await withStore("projects", "readonly", (store) => store.getAll() as IDBRequest<StoredProject[]>);
  return records
    .map((record) => ({
      id: record.id,
      name: record.name,
      updatedAt: record.updatedAt,
      origin: record.origin,
      sampleId: record.sampleId,
      totalBeads: record.totalBeads,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<StoredProject | null> {
  const record = await withStore("projects", "readonly", (store) => store.get(id) as IDBRequest<StoredProject | undefined>);
  return record ?? null;
}

export async function saveStoredProject(record: StoredProject): Promise<void> {
  await withStore("projects", "readwrite", (store) => store.put(record));
}

export async function deleteStoredProject(id: string): Promise<void> {
  await withStore("projects", "readwrite", (store) => store.delete(id));
}

async function readPreferences(): Promise<StoredPreferences | null> {
  const record = await withStore(
    "settings",
    "readonly",
    (store) => store.get(PREF_ID) as IDBRequest<StoredPreferences | undefined>,
  );
  return record ?? null;
}

async function writePreferences(patch: Partial<Omit<StoredPreferences, "id">>): Promise<void> {
  const current = (await readPreferences()) ?? { id: PREF_ID, paletteColors: null, pricing: null };
  const next: StoredPreferences = {
    id: PREF_ID,
    paletteColors: patch.paletteColors === undefined ? current.paletteColors : patch.paletteColors,
    pricing: patch.pricing === undefined ? current.pricing : patch.pricing,
  };
  await withStore("settings", "readwrite", (store) => store.put(next));
}

export async function loadPreferences(): Promise<{ palette: Palette | null; pricing: PricingFields | null }> {
  const record = await readPreferences();
  if (!record) return { palette: null, pricing: null };
  let palette: Palette | null = null;
  if (record.paletteColors && record.paletteColors.length > 0) {
    const validated = validatePaletteDraft(record.paletteColors);
    if (validated.ok) palette = paletteFromColors(validated.colors, "custom");
  }
  return { palette, pricing: record.pricing };
}

export async function savePalettePreference(palette: Palette): Promise<void> {
  await writePreferences({
    paletteColors: palette.kind === "custom" ? palette.colors.map(({ code, name, hex }) => ({ code, name, hex })) : null,
  });
}

export async function savePricingPreference(pricing: PricingFields): Promise<void> {
  await writePreferences({ pricing });
}

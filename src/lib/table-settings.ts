export const TABLE_SETTINGS_KEY = "tagMaestro.table.v1";
const PAGE_SIZES = [50, 100, 250, 500, 1000];
export type TableSettings<Key extends string> = {
  columnOrder: Key[];
  visibleColumns: Key[];
  columnWidths: Partial<Record<Key, number>>;
  sortKey: Key | null;
  sortOrder: "asc" | "desc";
  pageSize: number;
};
type SettingsStorage = Pick<Storage, "getItem" | "setItem">;

export function defaultTableSettings<Key extends string>(
  keys: Key[],
  visible: Key[],
): TableSettings<Key> {
  return {
    columnOrder: [
      ...keys.filter((key) => key === "album"),
      ...keys.filter((key) => key !== "album"),
    ],
    visibleColumns: [...visible],
    columnWidths: {},
    sortKey: keys.find((key) => key === "album") || null,
    sortOrder: "asc",
    pageSize: 1000,
  };
}

export function sanitizeTableSettings<Key extends string>(
  value: unknown,
  defaults: TableSettings<Key>,
): TableSettings<Key> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
  const saved = value as Record<string, unknown>;
  const allowed = new Set<string>(defaults.columnOrder);
  const validKeys = (items: unknown): Key[] =>
    Array.isArray(items)
      ? [...new Set(items.filter((key): key is Key => typeof key === "string" && allowed.has(key)))]
      : [];
  const order = validKeys(saved.columnOrder);
  const visible = validKeys(saved.visibleColumns);
  const widths: Partial<Record<Key, number>> = {};
  if (
    saved.columnWidths &&
    typeof saved.columnWidths === "object" &&
    !Array.isArray(saved.columnWidths)
  ) {
    for (const key of defaults.columnOrder) {
      const width = (saved.columnWidths as Record<string, unknown>)[key];
      if (typeof width === "number" && Number.isFinite(width))
        widths[key] = Math.min(2000, Math.max(40, width));
    }
  }
  return {
    columnOrder: [...order, ...defaults.columnOrder.filter((key) => !order.includes(key))],
    visibleColumns: visible.length ? visible : defaults.visibleColumns,
    columnWidths: widths,
    sortKey:
      saved.sortKey === null
        ? null
        : typeof saved.sortKey === "string" &&
            allowed.has(saved.sortKey) &&
            saved.sortKey !== "cover"
          ? (saved.sortKey as Key)
          : defaults.sortKey,
    sortOrder: saved.sortOrder === "desc" ? "desc" : "asc",
    pageSize:
      typeof saved.pageSize === "number" && PAGE_SIZES.includes(saved.pageSize)
        ? saved.pageSize
        : defaults.pageSize,
  };
}

export function loadTableSettings<Key extends string>(
  defaults: TableSettings<Key>,
  storage?: SettingsStorage,
) {
  try {
    const source = storage || (typeof window !== "undefined" ? window.localStorage : undefined);
    const saved = source?.getItem(TABLE_SETTINGS_KEY);
    return saved ? sanitizeTableSettings(JSON.parse(saved), defaults) : defaults;
  } catch {
    return defaults;
  }
}

export function saveTableSettings<Key extends string>(
  settings: TableSettings<Key>,
  storage?: SettingsStorage,
) {
  try {
    const source = storage || (typeof window !== "undefined" ? window.localStorage : undefined);
    if (!source) return false;
    source.setItem(TABLE_SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

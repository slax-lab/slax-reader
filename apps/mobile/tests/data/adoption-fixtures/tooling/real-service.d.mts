export function validateSeed(value: unknown): Record<string, Record<string, string | number | null>[]>;
export function changesSql(changes: unknown): string;
export function stopOwned(directory: string): void;

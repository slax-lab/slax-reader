/** PostgreSQL jsonb preserves metadata values while normalizing key order and whitespace. */
export function materializedFixtureValuesMatch(expected: Record<string, string | number | null>, actual: Record<string, unknown>): boolean {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([name, entry]) => [name, canonical(entry)])) : value;
  return Object.entries(expected).every(([name, value]) => {
    if (value === null) return actual[name] === null;
    if (name === 'metadata') {
      if (typeof value !== 'string' || typeof actual[name] !== 'string') return false;
      try {return JSON.stringify(canonical(JSON.parse(value))) === JSON.stringify(canonical(JSON.parse(actual[name] as string)));} catch {return false;}
    }
    return String(actual[name]) === String(value);
  });
}

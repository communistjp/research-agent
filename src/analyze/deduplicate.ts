function keyFor(record) {
  return (record.url || `${record.source_name}:${record.title}`).trim().toLowerCase();
}

export function deduplicate(records) {
  const seen = new Set();
  const result = [];

  for (const record of records) {
    const key = keyFor(record);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(record);
  }

  return result;
}

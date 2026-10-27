export function getProviderTypeOptions({ value } = {}) {
  const options = [
    { label: 'M3U', value: 'm3u' },
    { label: 'HDHomeRun', value: 'hdhomerun' },
  ];
  // The table's select initializes from its first option before its value is reflected.
  return value === 'hdhomerun' ? options.reverse() : options;
}

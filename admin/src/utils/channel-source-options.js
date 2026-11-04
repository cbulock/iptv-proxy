/** List every discovered choice, with this channel's bindings first. */
export function buildChannelSourceOptions(canonicalId, streamBindings, guideBindings) {
  const prioritize = bindings =>
    bindings
      .slice()
      .sort(
        (a, b) => Number(b.canonical?.id === canonicalId) - Number(a.canonical?.id === canonicalId)
      );
  const streams = new Map();
  for (const binding of prioritize(streamBindings)) {
    const channel = binding.sourceChannel;
    if (!channel?.id || streams.has(channel.id)) continue;
    const number = channel.sourceGuideNumber || channel.guideNumber;
    streams.set(channel.id, {
      value: channel.id,
      label: `${channel.source || 'Unknown'} - ${channel.name || 'Unnamed channel'}${number ? ` (${number})` : ''}`,
    });
  }
  const guides = new Map();
  for (const binding of prioritize(guideBindings)) {
    if (!binding.source?.id || !binding.epgChannelId) continue;
    const value = JSON.stringify({
      sourceId: binding.source.id,
      epgChannelId: binding.epgChannelId,
    });
    if (!guides.has(value))
      guides.set(value, {
        value,
        label: `${binding.source.name || 'Unknown source'} - ${binding.epgChannelId}`,
      });
  }
  return { streams: [...streams.values()], guides: [...guides.values()] };
}

/** Search presentation only: never remove the selected value or mutate draft choices. */
export function groupChannelSourceOptions(
  options,
  matchedValues = [],
  query = '',
  selectedValue = ''
) {
  const matches = new Set(matchedValues);
  const search = String(query).trim().toLowerCase();
  const visible = options.filter(
    option => option.value === selectedValue || option.label.toLowerCase().includes(search)
  );
  return [
    {
      label: 'Current channel matches',
      options: visible.filter(option => matches.has(option.value)),
    },
    {
      label: 'Other discovered choices',
      options: visible.filter(option => !matches.has(option.value)),
    },
  ].filter(group => group.options.length);
}

/** List every discovered choice, with this channel's bindings first. */
export function buildChannelSourceOptions(canonicalId, streamBindings, guideBindings) {
  const prioritize = bindings => bindings.slice().sort((a, b) =>
    Number(b.canonical?.id === canonicalId) - Number(a.canonical?.id === canonicalId));
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
    const value = JSON.stringify({ sourceId: binding.source.id, epgChannelId: binding.epgChannelId });
    if (!guides.has(value)) guides.set(value, {
      value,
      label: `${binding.source.name || 'Unknown source'} - ${binding.epgChannelId}`,
    });
  }
  return { streams: [...streams.values()], guides: [...guides.values()] };
}

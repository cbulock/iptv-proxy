const text = value => String(value ?? '').trim();

export function matchesChannelSearch(row, query) {
  const search = text(query).toLowerCase();
  return (
    !search ||
    [
      row.name,
      row.baseName,
      row.customNameDraft,
      row.effectiveGuideNumber,
      row.tvg_id,
      row.sourceBindingsSummary,
      row.sourceGuideReferencesSummary,
    ].some(value => text(value).toLowerCase().includes(search))
  );
}

/** Setup advice describes configuration, not stream health or programme coverage. */
export function getChannelSetupIssues(row) {
  const issues = [];
  if (!text(row.effectiveGuideNumber))
    issues.push({ key: 'number', label: 'Assign a channel number' });
  if (!row.preferredStreamOptions?.length) {
    issues.push({ key: 'stream-unavailable', label: 'No stream available' });
  } else if (!row.preferredSourceChannelId) {
    issues.push({ key: 'stream-selection', label: 'Choose a stream source' });
  }
  if (!row.guideBindingOptions?.length) {
    issues.push({ key: 'guide-unavailable', label: 'No TV guide available' });
  } else if (!row.selectedGuideBindingValue) {
    issues.push({ key: 'guide-selection', label: 'No TV guide selected' });
  }
  return issues;
}

export function buildChannelChangeReview(rows, profile = {}, savedProfile = {}) {
  const result = { shared: [], lineup: [], profile: [] };
  const change = (field, before, after) => ({ field, before, after });
  if (text(profile.name) !== text(savedProfile.name))
    result.profile.push(change('Lineup name', savedProfile.name, text(profile.name)));
  if (Boolean(profile.enabled) !== Boolean(savedProfile.enabled))
    result.profile.push(
      change(
        'Lineup availability',
        savedProfile.enabled ? 'Enabled' : 'Disabled',
        profile.enabled ? 'Enabled' : 'Disabled'
      )
    );
  for (const row of rows) {
    const shared = [];
    const lineup = [];
    const optionLabel = (options, value) =>
      options?.find(option => option.value === value)?.label || 'Not selected';
    if (row.customNameDirty)
      shared.push(
        change(
          'Display name',
          row.customName || row.baseName,
          text(row.customNameDraft) || row.baseName
        )
      );
    if (row.preferredStreamDirty)
      shared.push(
        change(
          'Stream source',
          optionLabel(row.preferredStreamOptions, row.committedPreferredSourceChannelId),
          optionLabel(row.preferredStreamOptions, row.preferredSourceChannelId)
        )
      );
    if (row.guideBindingDirty)
      shared.push(
        change(
          'TV guide source',
          optionLabel(row.guideBindingOptions, row.committedGuideBindingValue),
          optionLabel(row.guideBindingOptions, row.selectedGuideBindingValue)
        )
      );
    if (Boolean(row.outputEnabled) !== Boolean(row.savedOutputEnabled))
      lineup.push(
        change(
          'Include in lineup',
          row.savedOutputEnabled ? 'Included' : 'Not included',
          row.outputEnabled ? 'Included' : 'Not included'
        )
      );
    if (text(row.guideNumberOverrideInput) !== text(row.savedGuideNumberOverride))
      lineup.push(
        change(
          'Channel number',
          text(row.savedGuideNumberOverride) || 'Use default',
          text(row.guideNumberOverrideInput) || 'Use default'
        )
      );
    if (shared.length) result.shared.push({ id: row.id, name: row.name, changes: shared });
    if (lineup.length) result.lineup.push({ id: row.id, name: row.name, changes: lineup });
  }
  return result;
}

/** Restore only authoring state; callers persist the new snapshot after the reset. */
export function restoreChannelDrafts(state, savedProfile, savedEntries) {
  state.outputProfileDraft = { ...savedProfile };
  state.outputProfileEntries = savedEntries.map(entry => ({
    ...entry,
    canonical: { ...entry.canonical },
    guideNumberOverrideDraft: entry.guideNumberOverride ?? '',
  }));
  for (const channel of state.canonicalChannels) channel.customNameDraft = channel.customName || '';
  state.preferredStreamDrafts = Object.fromEntries(
    state.canonicalChannels.map(channel => [
      channel.id,
      state.channelBindings.find(
        binding => binding.canonical?.id === channel.id && binding.isPreferredStream
      )?.sourceChannel?.id || '',
    ])
  );
  state.guideBindingDrafts = Object.fromEntries(
    state.canonicalChannels.map(channel => {
      const binding = state.guideBindings.find(
        item => item.canonical?.id === channel.id && item.selected
      );
      return [
        channel.id,
        binding
          ? JSON.stringify({
            sourceId: binding.source?.id || '',
            epgChannelId: binding.epgChannelId || '',
          })
          : '',
      ];
    })
  );
  state.channelRowFeedback = {};
}

export async function resolveChannelDraftGuard({ isDirty, prompt, save, discard }) {
  if (!isDirty()) return true;
  const choice = await prompt();
  if (choice === 'save') return Boolean(await save());
  if (choice === 'discard') {
    discard();
    return true;
  }
  return false;
}

/** A failed refresh must never turn a successful write into a failed save. */
export async function saveChannelDrafts({ write, acknowledge, reload }) {
  const response = await write();
  acknowledge(response);
  try {
    return { saved: true, refreshed: Boolean(await reload()) };
  } catch {
    return { saved: true, refreshed: false };
  }
}

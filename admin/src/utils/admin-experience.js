// Shared behavior for navigation, operation feedback, and native media recovery.

/** Run independent refreshes without letting a later success hide another failure. */
export async function runRefreshStages(operations, onUpdate = () => {}) {
  const outcomes = Object.fromEntries(
    Object.keys(operations).map(key => [key, { status: 'running', message: '' }])
  );
  const publish = () =>
    onUpdate(
      Object.fromEntries(Object.entries(outcomes).map(([key, value]) => [key, { ...value }]))
    );
  publish();
  await Promise.all(
    Object.entries(operations).map(async ([key, run]) => {
      try {
        await run();
        outcomes[key] = { status: 'success', message: '' };
      } catch (error) {
        outcomes[key] = {
          status: 'error',
          message: error?.message || 'Refresh failed. Try again.',
        };
      }
      publish();
    })
  );
  return outcomes;
}

/** Returns cleanup so an old media element cannot report into its replacement. */
export function observeNativePlayback(video, onFailure) {
  const handleError = () => {
    const code = video.error?.code;
    if (!code || code === 1) return;
    onFailure(
      code === 3
        ? {
            kind: 'codec',
            message:
              'This browser could not decode the stream. Try server transcoding or open it in another player.',
          }
        : code === 4
          ? {
              kind: 'unsupported',
              message:
                'This browser could not open the stream. Retry, or open the stream URL in VLC or another player.',
            }
          : {
              kind: 'network',
              message: 'The stream could not be loaded. Check the source connection, then retry.',
            }
    );
  };
  video.addEventListener('error', handleError);
  return () => video.removeEventListener('error', handleError);
}

export function readAdminSection(hash = '') {
  const section = hash.replace(/^#\/?/, '').split('?')[0];
  if (section === 'settings') return 'app';
  return [
    'app',
    'providers',
    'channels',
    'preview',
    'health',
    'usage',
    'tasks',
    'backups',
  ].includes(section)
    ? section
    : 'channels';
}

export function parseBackupDate(name) {
  const match = String(name || '').match(
    /^backup-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:[-.]\d+)?Z?$/
  );
  if (!match) return null;
  const date = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  return !value || Number.isNaN(date.getTime())
    ? 'Never'
    : date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short',
      });
}

export function describeSchedule(schedule) {
  const minutes = String(schedule || '').match(/^\*\/(\d+) \* \* \* \*$/);
  if (minutes && Number(minutes[1]) > 0 && Number(minutes[1]) < 60)
    return `Every ${minutes[1]} minutes`;
  const hours = String(schedule || '').match(/^0 \*\/(\d+) \* \* \*$/);
  if (hours && Number(hours[1]) > 0 && Number(hours[1]) < 24) return `Every ${hours[1]} hours`;
  return (
    {
      '*/30 * * * *': 'Every 30 minutes',
      '0 */6 * * *': 'Every 6 hours',
      '0 2 * * 0': 'Sundays at 2:00 AM (server time)',
    }[schedule] || schedule
  );
}

export function guideRefreshProblem(outcome) {
  if (outcome?.status !== 'degraded') return '';
  const problems = (outcome.sources || []).filter(source =>
    ['stale', 'error'].includes(source.status)
  );
  const details = problems.map(
    source =>
      `${source.source || 'Guide source'}: ${source.status === 'stale' ? 'using cached guide' : 'unavailable'}${source.error ? ` (${source.error})` : ''}`
  );
  return `Guide partially refreshed. ${details.join('; ') || 'Check source guide URLs and retry.'}`;
}

/** Health reports use legacy display identifiers. Only offer editing for an unambiguous match. */
export function resolveHealthChannel(id, channels) {
  const key = String(id || '');
  if (!key) return null;
  const matches = channels.filter(channel =>
    [
      channel.id,
      channel.tvg_id,
      channel.guideNumber,
      channel.name,
      channel.baseName,
      ...(channel.sourceBindings || []).flatMap(binding => {
        const source = binding.sourceChannel || {};
        return [source.tvg_id, source.guideNumber, source.sourceGuideNumber, source.name];
      }),
    ].some(value => value != null && String(value) === key)
  );
  return matches.length === 1 ? matches[0] : null;
}

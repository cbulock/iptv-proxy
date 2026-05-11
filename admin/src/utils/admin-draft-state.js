function normalizeString(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

export function normalizeGuideNumberValue(value) {
  const normalized = normalizeString(value).trim();
  return normalized ? normalized : null;
}

export function normalizeAppDraftForComparison(appConfig = {}) {
  const oauth = appConfig?.oauth || {};

  return {
    base_url: normalizeString(appConfig?.base_url),
    oauth: {
      issuer: normalizeString(oauth?.issuer),
      authorization_code_ttl_seconds: normalizeString(oauth?.authorization_code_ttl_seconds),
      access_token_ttl_seconds: normalizeString(oauth?.access_token_ttl_seconds),
      clients: Array.isArray(oauth?.clients)
        ? oauth.clients.map(client => ({
          client_id: normalizeString(client?.client_id),
          client_name: normalizeString(client?.client_name),
          redirectUrisText: normalizeString(client?.redirectUrisText),
          scope: normalizeString(client?.scope ?? 'mcp'),
        }))
        : [],
    },
  };
}

export function normalizeProvidersForComparison(providers = []) {
  return Array.isArray(providers)
    ? providers.map(provider => ({
      name: normalizeString(provider?.name),
      type: normalizeString(provider?.type || 'm3u'),
      url: normalizeString(provider?.url),
      epg: normalizeString(provider?.epg),
    }))
    : [];
}

export function normalizeOutputProfileDraftForComparison(outputProfileDraft = {}) {
  return {
    name: normalizeString(outputProfileDraft?.name).trim(),
    enabled: Boolean(outputProfileDraft?.enabled),
  };
}

export function normalizeOutputProfileEntriesForComparison(entries = []) {
  return Array.isArray(entries)
    ? entries
      .map(entry => ({
        canonicalId: normalizeString(entry?.canonical?.id),
        enabled: Boolean(entry?.enabled),
        position: Number.isFinite(entry?.position) ? entry.position : 0,
        guideNumberOverride: normalizeGuideNumberValue(entry?.guideNumberOverride),
      }))
      .sort((left, right) => left.canonicalId.localeCompare(right.canonicalId))
    : [];
}

export function hasGuideNumberDraftChanges(entries = []) {
  return Array.isArray(entries)
    ? entries.some(
      entry =>
        normalizeGuideNumberValue(entry?.guideNumberOverrideDraft) !==
          normalizeGuideNumberValue(entry?.guideNumberOverride)
    )
    : false;
}

export function cloneAppDraft(appConfig = {}) {
  return {
    base_url: normalizeString(appConfig?.base_url),
    oauth: {
      issuer: normalizeString(appConfig?.oauth?.issuer),
      authorization_code_ttl_seconds: normalizeString(appConfig?.oauth?.authorization_code_ttl_seconds),
      access_token_ttl_seconds: normalizeString(appConfig?.oauth?.access_token_ttl_seconds),
      clients: Array.isArray(appConfig?.oauth?.clients)
        ? appConfig.oauth.clients.map(client => ({
          client_id: normalizeString(client?.client_id),
          client_name: normalizeString(client?.client_name),
          redirectUrisText: normalizeString(client?.redirectUrisText),
          scope: normalizeString(client?.scope ?? 'mcp'),
        }))
        : [],
    },
  };
}

export function cloneProvidersDraft(providers = []) {
  return Array.isArray(providers)
    ? providers.map(provider => ({
      name: normalizeString(provider?.name),
      type: normalizeString(provider?.type || 'm3u'),
      url: normalizeString(provider?.url),
      epg: normalizeString(provider?.epg),
    }))
    : [];
}

export function cloneOutputProfileDraftState({
  selectedOutputProfileSlug = '',
  outputProfileDraft = {},
  outputProfileEntries = [],
} = {}) {
  return {
    selectedOutputProfileSlug: normalizeString(selectedOutputProfileSlug),
    outputProfileDraft: {
      name: normalizeString(outputProfileDraft?.name),
      enabled: Boolean(outputProfileDraft?.enabled),
    },
    outputProfileEntries: Array.isArray(outputProfileEntries)
      ? outputProfileEntries.map(entry => ({
        canonicalId: normalizeString(entry?.canonical?.id),
        enabled: Boolean(entry?.enabled),
        position: Number.isFinite(entry?.position) ? entry.position : 0,
        guideNumberOverride: normalizeGuideNumberValue(entry?.guideNumberOverride),
        guideNumberOverrideDraft: normalizeString(
          entry?.guideNumberOverrideDraft ?? entry?.guideNumberOverride ?? ''
        ),
      }))
      : [],
  };
}

# Usage viewer identity

## Intent

Show an authenticated viewer's friendly account name in IPTV Proxy usage while keeping the proxy usable without any gateway.

## Approach

The gateway asks its existing portal check for a stable user ID and account name. On media requests it forwards those values as percent-encoded UTF-8 `X-IPTV-User-Id` and `X-IPTV-User-Name` headers, with `X-IPTV-Identity-Secret`. The gateway constructs all three headers itself; it never passes client-supplied copies through. Both services use the same optional `IPTV_USAGE_IDENTITY_SECRET` environment variable. When unset or mismatched, the proxy ignores identity headers and retains its IP-based usage behavior.

The proxy validates header lengths and encoding, records `userId` and `userName`, and keys active usage by stable user ID, IP, and channel when identity is trusted. Otherwise it keys by IP plus channel. Overlapping requests for one key remain active until all close. Both direct streams and transcoded streams contribute to usage. The Usage tab shows the friendly name and ID when available. This metadata is for usage display only and never authorizes playback. Existing admin authentication continues to protect the usage API.

## Constraints

- No additional dependency or account lookup from IPTV Proxy.
- No raw IPTV credential, email address, or gateway secret in usage results.
- Direct clients and gateways without the optional secret retain existing behavior.
- The portal's internal check response may add identity fields without changing its `allowed` decision.
- No admin build; tracked stable admin assets must remain unchanged.

## Alternatives considered

- Trust headers by gateway IP: avoids a shared secret but is brittle with changing container IPs and easy to misconfigure behind other proxies.
- Signed identity token: suitable for untrusted hops, but adds token issuance, verification, and key rotation for display-only metadata.

The shared-secret header contract is the chosen small integration for this private gateway-to-proxy hop.

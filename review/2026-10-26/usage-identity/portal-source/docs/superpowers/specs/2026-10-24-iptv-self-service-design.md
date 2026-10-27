# Live TV self-service activation

Approved by the user on October 24, 2026: enable Live TV immediately, activate existing pending requests, and require an admin to restore revoked access.

Active portal users can enable Live TV with one click. A one-time migration approves pending grants for enabled accounts. Disabled accounts remain blocked. Revoked access cannot be self-enabled and requires the existing admin grant action. Repeated activation preserves existing credentials and browser sessions.

## Approaches

Keeping manual approval would require a request queue and notifications. The selected approach removes that wait through self-service activation while retaining admin revocation and restoration. Automatically enabling every account was not selected: activation remains an explicit user choice.

Update the home card, account controls, setup guide, and admin wording. Keep existing API paths and stored grant states for compatibility. Credentials continue to be minted only when needed. Do not deploy or modify live data as part of this local implementation.

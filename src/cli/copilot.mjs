import { CopilotClient } from '@github/copilot-sdk';

// One short-lived SDK client, for setup and doctor: is this PC signed in to Copilot, as whom,
// and how much of the monthly allowance is left.
export async function copilotStatus() {
  const client = new CopilotClient({ logLevel: 'none' });
  try {
    await client.start();
    const auth = await client.getAuthStatus();
    let quota = null;
    let models = 0;
    if (auth?.isAuthenticated) {
      models = (await client.listModels().catch(() => [])).length;
      quota = await client.rpc.account.getQuota({}).then((q) => q.quotaSnapshots?.premium_interactions ?? null).catch(() => null);
    }
    return { authenticated: Boolean(auth?.isAuthenticated), login: auth?.login ?? null, message: auth?.statusMessage ?? null, models, quota };
  } catch (err) {
    return { authenticated: false, login: null, message: err.message, models: 0, quota: null, error: true };
  } finally {
    await client.stop().catch(() => {});
  }
}

// The snapshot Copilot keeps for the monthly allowance. It can lag behind recent use by a while.
export function quotaLine(q) {
  if (!q) return null;
  if (q.isUnlimitedEntitlement) return 'Allowance: unlimited';
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const parts = [];
  if (q.entitlementRequests) parts.push(`used ${fmt(q.usedRequests ?? 0)} of ${fmt(q.entitlementRequests)} this month`);
  if (q.remainingPercentage != null) parts.push(`${Math.round(q.remainingPercentage)}% left`);
  if (q.overage) parts.push(`${fmt(q.overage)} over`);
  return parts.length ? `Allowance: ${parts.join(', ')}` : null;
}

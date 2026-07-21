/**
 * Ahead-of-time check for whether a registered provider's required peer
 * SDK is actually installed, without constructing the provider (which
 * would throw a `ProviderSDKNotInstalledError` on first real use instead).
 */
import { ProviderId } from "../providerType";
import { getRegistry } from "./registry";

export async function isProviderSDKAvailable(
  type: ProviderId
): Promise<boolean> {
  const metadata = getRegistry().getMetadata(type);
  if (!metadata?.requiredPeerDependency) return true;

  try {
    await import(metadata.requiredPeerDependency);
    return true;
  } catch {
    return false;
  }
}

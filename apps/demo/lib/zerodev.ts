import { ARBITRUM_SEPOLIA } from "@reineira-os/x402-rss-shared";

// Single source of truth for the ZeroDev project id. It is a public client id (safe to
// ship to the browser), but it must live in one place so the server-side (ZERODEV_PROJECT_ID)
// and browser-bundled (NEXT_PUBLIC_ZERODEV_PROJECT_ID) copies can't drift. Next.js inlines
// the NEXT_PUBLIC_ reference statically, so both must be read as literal member accesses.
const DEMO_DEFAULT_ZERODEV_PROJECT_ID = "866d15a6-e621-4e6a-b796-634611f34211";

export const ZERODEV_PROJECT_ID =
  process.env.ZERODEV_PROJECT_ID ??
  process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID ??
  DEMO_DEFAULT_ZERODEV_PROJECT_ID;

export function zerodevBundlerRpc(projectId: string = ZERODEV_PROJECT_ID): string {
  return `https://rpc.zerodev.app/api/v3/${projectId}/chain/${ARBITRUM_SEPOLIA.chainId}`;
}

export function zerodevPasskeyServerUrl(projectId: string = ZERODEV_PROJECT_ID): string {
  return `https://passkeys.zerodev.app/api/v3/${projectId}`;
}

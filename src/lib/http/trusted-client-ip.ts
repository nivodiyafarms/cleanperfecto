import "server-only";

import { headers } from "next/headers";
import { clientIpFromHeaderList } from "./client-ip-from-headers";

export { clientIpFromHeaderList };

export async function getTrustedClientIp(): Promise<string | null> {
  const headerList = await headers();
  return clientIpFromHeaderList(headerList);
}

import { createHash } from "node:crypto";

export async function hashRemoteFile(
  url: string,
  expectedMaximumBytes: number,
): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": "The-Federalist-Project-FEC/0.1" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Discord returned HTTP ${response.status} for the attachment.`);
  }

  const hash = createHash("sha256");
  let received = 0;
  for await (const chunk of response.body) {
    const bytes =
      chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBuffer);
    received += bytes.byteLength;
    if (received > expectedMaximumBytes) {
      throw new Error("The attachment exceeded its maximum permitted size.");
    }
    hash.update(bytes);
  }
  if (received === 0) {
    throw new Error("The attachment was empty.");
  }
  return hash.digest("hex");
}

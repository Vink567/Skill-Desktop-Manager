export function messageFromError(reason: unknown): string {
  const message = rawMessageFromError(reason);
  return message
    .replace(/^Error invoking remote method '[^']+':(?: Error:)?\s*/i, "")
    .trim();
}

function rawMessageFromError(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.message;
  }
  if (typeof reason === "string") {
    return reason;
  }
  return JSON.stringify(reason);
}

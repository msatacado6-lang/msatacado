/** Browser helper. The Supabase SDK owns sign-in, refresh and sign-out. */
export class StorefrontHttpError extends Error {
  constructor(
    public code: string,
    public status: number,
    /** A write may have reached the server. Reconcile using the SAME order key. */
    public outcomeUnknown = false,
  ) {
    super(code);
    this.name = "StorefrontHttpError";
  }
}

export function createStorefrontClient(options: {
  supabaseUrl: string;
  publishableKey: string;
  getAccessToken: () => Promise<string | null>;
  transport?: typeof fetch;
  timeoutMs?: number;
}) {
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(options.supabaseUrl)) {
    throw new Error("INVALID_SUPABASE_URL");
  }
  if (!/^sb_publishable_[A-Za-z0-9_-]{8,480}$/.test(options.publishableKey)) {
    throw new Error("INVALID_PUBLISHABLE_KEY");
  }
  const timeoutMs = options.timeoutMs ?? 35000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
    throw new Error("INVALID_TIMEOUT");
  }
  const transport = options.transport ?? fetch;
  const base = `${options.supabaseUrl}/functions/v1/storefront/`;
  return async function storeRequest<T>(
    path: string,
    input?: unknown,
    requestKey?: string,
  ): Promise<T> {
    // Do not send the buyer's bearer to a path outside the storefront contract.
    const url = new URL(`${base}${path}`);
    const suffix = url.pathname.slice(new URL(base).pathname.length);
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const allowed =
      input === undefined
        ? [
            "store",
            "products",
            "categories",
            "me",
            "me/profile",
            "me/orders",
            "admin/status",
          ].includes(suffix) ||
          (suffix.startsWith("products/") && uuid.test(suffix.slice(9))) ||
          (suffix.startsWith("me/orders/") && uuid.test(suffix.slice(10)))
        : ["cart/quote", "orders", "me/sync", "me/profile"].includes(suffix);
    if (
      !allowed ||
      !path ||
      path.startsWith("/") ||
      path.includes("#") ||
      url.origin !== new URL(base).origin ||
      !url.pathname.startsWith(new URL(base).pathname) ||
      path.split("?")[0] !== suffix
    ) {
      throw new StorefrontHttpError("INVALID_ROUTE", 400);
    }
    if (suffix === "orders" && (!requestKey || !uuid.test(requestKey))) {
      throw new StorefrontHttpError("INVALID_ORDER_KEY", 400);
    }
    const token = await options.getAccessToken();
    // Serialize before dispatch: serialization failure is not an uncertain write.
    const body = input === undefined ? undefined : JSON.stringify(input);
    let response: Response;
    try {
      response = await transport(url, {
        method: input === undefined ? "GET" : "POST",
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          apikey: options.publishableKey,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(input === undefined
            ? {}
            : { "Content-Type": "application/json" }),
          ...(requestKey ? { "Idempotency-Key": requestKey } : {}),
        },
        ...(body === undefined ? {} : { body }),
      });
    } catch {
      throw new StorefrontHttpError(
        "CONNECTION_UNAVAILABLE",
        0,
        input !== undefined,
      );
    }
    let value: unknown;
    try {
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("Not JSON");
      }
      value = await response.json();
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Invalid response");
      }
    } catch {
      throw new StorefrontHttpError(
        "INVALID_RESPONSE",
        response.status,
        input !== undefined,
      );
    }
    if (!response.ok) {
      const code =
        "error" in value &&
        typeof value.error === "string" &&
        /^[A-Z][A-Z0-9_]{0,79}$/.test(value.error)
          ? value.error
          : "SERVER_ERROR";
      throw new StorefrontHttpError(
        code,
        response.status,
        input !== undefined && response.status >= 500,
      );
    }
    return value as T;
  };
}

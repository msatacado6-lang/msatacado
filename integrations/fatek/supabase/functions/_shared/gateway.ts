/** Portable Web API handler. The browser never receives the Fatek bridge credential. */
export type GatewayConfig = {
  supabaseUrl: string;
  publishableKey: string;
  storeOrigin: string;
  fatekOrigin: string;
  storeSlug: string;
  bridgeSecret: string;
};
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function gatewayRouteAllowed(method: string, path: string[]) {
  const route = path.join("/");
  return (
    (method === "GET" &&
      ([
        "store",
        "products",
        "categories",
        "me",
        "me/profile",
        "me/orders",
      ].includes(route) ||
        (path.length === 2 && path[0] === "products" && uuid.test(path[1])) ||
        (path.length === 3 &&
          path[0] === "me" &&
          path[1] === "orders" &&
          uuid.test(path[2])))) ||
    (method === "POST" &&
      ["cart/quote", "orders", "me/sync", "me/profile"].includes(route))
  );
}
export function createStorefrontGateway(
  config: GatewayConfig,
  transport: typeof fetch = fetch,
) {
  if (
    !/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(config.supabaseUrl) ||
    !/^sb_publishable_[A-Za-z0-9_-]{8,480}$/.test(config.publishableKey) ||
    !/^https:\/\/[a-z0-9.-]+$/.test(config.storeOrigin) ||
    !/^https:\/\/[a-z0-9.-]+$/.test(config.fatekOrigin) ||
    !/^[-A-Za-z0-9_]{43}$/.test(config.bridgeSecret) ||
    !/^[a-z0-9][a-z0-9.-]{0,252}$/.test(config.storeSlug)
  )
    throw Error("Invalid storefront gateway configuration");
  return async function handler(req: Request) {
    const origin = req.headers.get("origin");
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      Vary: "Origin, Authorization",
      "X-Content-Type-Options": "nosniff",
      ...(origin === config.storeOrigin
        ? {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Headers":
              "authorization, apikey, content-type, idempotency-key, x-client-info",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          }
        : {}),
    };
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), { status, headers });
    if (origin && origin !== config.storeOrigin)
      return json({ error: "ORIGIN_DENIED" }, 403);
    if (req.method === "OPTIONS")
      return origin === config.storeOrigin
        ? new Response(null, { status: 204, headers })
        : json({ error: "ORIGIN_DENIED" }, 403);
    if (req.method === "POST" && origin !== config.storeOrigin)
      return json({ error: "ORIGIN_DENIED" }, 403);
    const url = new URL(req.url),
      prefix = "/functions/v1/storefront/";
    if (!url.pathname.startsWith(prefix))
      return json({ error: "NOT_FOUND" }, 404);
    const suffix = url.pathname.slice(prefix.length),
      path = suffix.split("/");
    if (path.some((s) => !s || !/^[-a-zA-Z0-9]+$/.test(s)))
      return json({ error: "NOT_FOUND" }, 404);
    const suppliedAuthorization = req.headers.get("authorization");
    const authorization =
      suppliedAuthorization === `Bearer ${config.publishableKey}`
        ? null
        : suppliedAuthorization;
    if (
      authorization &&
      (!/^Bearer [-A-Za-z0-9_]+\.[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+$/.test(
        authorization,
      ) ||
        authorization.length > 16400)
    )
      return json({ error: "INVALID_CREDENTIALS" }, 401);
    const adminStatus = req.method === "GET" && suffix === "admin/status";
    if (!adminStatus && !gatewayRouteAllowed(req.method, path))
      return json({ error: "NOT_FOUND" }, 404);
    if (
      (req.method === "POST" || path[0] === "me" || adminStatus) &&
      !authorization
    )
      return json({ error: "LOGIN_REQUIRED" }, 401);
    try {
      if (adminStatus) {
        const result = await transport(
          `${config.supabaseUrl}/rest/v1/rpc/storefront_context`,
          {
            method: "POST",
            redirect: "error",
            cache: "no-store",
            signal: AbortSignal.timeout(6000),
            headers: {
              apikey: config.publishableKey,
              Authorization: authorization!,
              "Content-Type": "application/json",
            },
            body: "{}",
          },
        );
        if (!result.ok && result.status !== 401 && result.status !== 403)
          return json({ error: "CONNECTION_UNAVAILABLE" }, 503);
        if (!result.ok)
          return json(
            {
              error:
                result.status === 401 ? "INVALID_CREDENTIALS" : "FORBIDDEN",
            },
            result.status === 401 ? 401 : 403,
          );
        const context = await result.json();
        if (
          context?.active !== true ||
          context.admin !== true ||
          context.issuer !== `${config.supabaseUrl}/auth/v1`
        )
          return json({ error: "FORBIDDEN" }, 403);
      }
      let body: string | undefined;
      if (req.method === "POST") {
        if (!req.headers.get("content-type")?.startsWith("application/json"))
          return json({ error: "JSON_REQUIRED" }, 415);
        const reader = req.body?.getReader();
        if (!reader) return json({ error: "INVALID_BODY" }, 400);
        let size = 0;
        const chunks: Uint8Array[] = [];
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.length;
            if (size > 32768) {
              await reader.cancel();
              return json({ error: "BODY_TOO_LARGE" }, 413);
            }
            chunks.push(part.value);
          }
        } finally {
          reader.releaseLock();
        }
        const merged = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        const input = JSON.parse(new TextDecoder().decode(merged));
        if (!input || typeof input !== "object" || Array.isArray(input))
          return json({ error: "INVALID_BODY" }, 400);
        // Forward only the commerce contract, never arbitrary form fields or passwords.
        body = JSON.stringify(
          suffix === "cart/quote"
            ? {
                items: Array.isArray(input.items)
                  ? input.items.map((i: Record<string, unknown>) => ({
                      productId: i?.productId,
                      variantId: i?.variantId,
                      quantity: i?.quantity,
                    }))
                  : input.items,
                delivery: {
                  kind: input.delivery?.kind,
                  postalCode: input.delivery?.postalCode,
                },
              }
            : suffix === "me/sync"
              ? {}
              : suffix === "me/profile"
                ? Object.fromEntries(
                    [
                      "revision",
                      "name",
                      "phone",
                      "company",
                      "zipCode",
                      "address",
                      "addressNumber",
                      "addressComplement",
                      "neighborhood",
                      "city",
                      "state",
                    ]
                      .filter((key) => Object.hasOwn(input, key))
                      .map((key) => [key, input[key]]),
                  )
                : {
                    quoteId: input.quoteId,
                    shippingOption: input.shippingOption,
                    phone: input.phone,
                    address: {
                      street: input.address?.street,
                      number: input.address?.number,
                      district: input.address?.district,
                      complement: input.address?.complement,
                    },
                  },
        );
      }
      const key = req.headers.get("idempotency-key");
      if (suffix === "orders" && (!key || !uuid.test(key)))
        return json({ error: "INVALID_ORDER" }, 400);
      const target = new URL(
        `${config.fatekOrigin}/api/store/bridge/v1/${encodeURIComponent(config.storeSlug)}/${adminStatus ? "store" : suffix}`,
      );
      for (const key of ["search", "category", "cursor"]) {
        const value = url.searchParams.get(key);
        if (value) target.searchParams.set(key, value);
      }
      const response = await transport(target, {
        method: req.method,
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
        headers: {
          Accept: "application/json",
          "x-storefront-bridge": config.bridgeSecret,
          ...(authorization && !adminStatus
            ? { Authorization: authorization }
            : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        ...(body ? { body } : {}),
      });
      if (!response.headers.get("content-type")?.includes("application/json"))
        return json({ error: "CONNECTION_UNAVAILABLE" }, 503);
      const result = await response.json();
      if (adminStatus) {
        if (!response.ok) return json({ error: "CONNECTION_UNAVAILABLE" }, 503);
        return json({
          connected: true,
          checkedAt: new Date().toISOString(),
          storeName: result.store?.name,
          version: result.version,
        });
      }
      return json(result, response.status);
    } catch (error) {
      return json(
        {
          error:
            error instanceof SyntaxError
              ? "INVALID_BODY"
              : "CONNECTION_UNAVAILABLE",
        },
        error instanceof SyntaxError ? 400 : 503,
      );
    }
  };
}

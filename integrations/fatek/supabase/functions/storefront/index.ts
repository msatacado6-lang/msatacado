import { createStorefrontGateway } from "../_shared/gateway.ts";
const required = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw Error(`Missing ${name}`);
  return value;
};
const handler = createStorefrontGateway({
  supabaseUrl: required("SUPABASE_URL"),
  publishableKey: required("STORE_PUBLISHABLE_KEY"),
  storeOrigin: required("STORE_ORIGIN"),
  fatekOrigin: required("FATEK_API_ORIGIN"),
  storeSlug: required("FATEK_STORE_ID"),
  bridgeSecret: required("FATEK_BRIDGE_SECRET"),
});
Deno.serve(handler);

/** Public wire contract only: no CRM types, database imports or private fields. */
import { createStorefrontClient } from "./storefront-client";

export type Buyer = {
  id: string;
  name: string;
  email: string;
  approved: boolean;
  clientSyncState?: "PENDING" | "REVIEW_REQUIRED" | "LIMIT_REACHED" | "LINKED";
};
export type CustomerProfile = {
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  zipCode: string | null;
  address: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  revision: string;
};
export type ProfileResult = {
  syncState: "PENDING" | "REVIEW_REQUIRED" | "LIMIT_REACHED" | "LINKED";
  profile: CustomerProfile | null;
};
export type ProfileUpdate = { revision: string } & {
  [K in keyof Omit<CustomerProfile, "revision" | "email" | "country">]?: string;
};
export type Policy = {
  enabled: boolean;
  frontend: "NATIVE" | "EXTERNAL";
  authProvider: "NATIVE" | "SUPABASE";
  checkout: "WHATSAPP" | "ONLINE_PAYMENT" | "INQUIRY";
  registration: "OPEN" | "APPROVAL_REQUIRED" | "INVITE_ONLY";
  catalogVisibility: "PUBLIC" | "AUTHENTICATED" | "APPROVED";
  priceVisibility: "PUBLIC" | "AUTHENTICATED" | "APPROVED";
  minPieces: number;
  minSubtotal: number;
  quantityMultiple: number;
  shippingEnabled: boolean;
  pickupEnabled: boolean;
  shippingOnRequest: boolean;
};
export type StoreInfo = {
  version: 1;
  store: {
    name: string;
    logoUrl: string | null;
    accent: string;
    theme: string;
    locale: string;
    currency: string;
    policy: Policy;
    shippingSupported: boolean;
    handlingDays: number | null;
    contactUrl: string;
  };
  buyer: Buyer | null;
  access: { catalog: boolean; prices: boolean; order: boolean };
};
export type Variant = {
  id: string;
  productId: string;
  sku: string | null;
  values: [string | null, string | null, string | null];
  imageUrl: string | null;
  available: boolean;
  /** Omitted when unauthorized. Missing is never a price/quantity of zero. */
  price?: number;
  availableQuantity?: number;
};
export type Product = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  imageUrl: string | null;
  images: string[];
  axes: string[];
  variants: Variant[];
};
export type ProductPage = {
  items: Product[];
  nextCursor: string | null;
  pricesVisible: boolean;
};
export type CartItem = {
  productId: string;
  variantId: string;
  quantity: number;
};
export type Delivery =
  | { kind: "DELIVERY"; postalCode: string }
  | {
      kind: "PICKUP" | "ARRANGE";
    };
export type QuoteInput = { items: CartItem[]; delivery: Delivery };
export type QuotedItem = CartItem & {
  sku: string | null;
  name: string;
  label: string;
  unitPrice: number;
};
export type ShippingOption = {
  id: string;
  name: string;
  price: number | null;
  carrierPrice?: number;
  days: number | null;
};
export type Quote = {
  id: string;
  items: QuotedItem[];
  subtotal: number;
  pieces: number;
  delivery: Delivery & { city?: string; state?: string };
  options: ShippingOption[];
  expiresAt: string;
};
export type OrderInput = {
  quoteId: string;
  shippingOption: string;
  phone: string;
  address?: {
    street: string;
    number: string;
    district: string;
    complement?: string;
  };
};
export type OrderReceipt = {
  id: string;
  reference: string;
  status: string;
  items: QuotedItem[];
  pieces: number;
  subtotal: number;
  shippingCost: number | null;
  total: number | null;
  createdAt: string;
  whatsappUrl: string;
};
export type ConnectionStatus = {
  connected: true;
  checkedAt: string;
  storeName: string;
  version: 1;
};

/** Convenience API. Auth/refresh/logout remain exclusively with the Supabase SDK. */
export function createStorefrontApi(
  options: Parameters<typeof createStorefrontClient>[0],
) {
  const request = createStorefrontClient(options);
  const id = (value: string) => encodeURIComponent(value);
  return {
    store: () => request<StoreInfo>("store"),
    products: (
      filters: { search?: string; category?: string; cursor?: string } = {},
    ) => {
      const query = new URLSearchParams();
      for (const key of ["search", "category", "cursor"] as const) {
        if (filters[key]) query.set(key, filters[key]);
      }
      return request<ProductPage>(`products${query.size ? `?${query}` : ""}`);
    },
    product: (productId: string) =>
      request<ProductPage>(`products/${id(productId)}`),
    categories: () => request<{ categories: string[] }>("categories"),
    me: () => request<{ buyer: Buyer }>("me"),
    syncCustomer: () => request<ProfileResult>("me/sync", {}),
    profile: () => request<ProfileResult>("me/profile"),
    updateProfile: (input: ProfileUpdate) =>
      request<ProfileResult>("me/profile", input),
    orders: () => request<{ orders: OrderReceipt[] }>("me/orders"),
    order: (orderId: string) =>
      request<{ orders: OrderReceipt[] }>(`me/orders/${id(orderId)}`),
    quote: (input: QuoteInput) => request<Quote>("cart/quote", input),
    /** Generate/persist key once per purchase intention; never generate one per retry. */
    placeOrder: (input: OrderInput, key: string) =>
      request<OrderReceipt>("orders", input, key),
    connectionStatus: () => request<ConnectionStatus>("admin/status"),
  };
}

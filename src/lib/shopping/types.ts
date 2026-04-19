import type { cartItems } from "./schemas/cart-items.ts";

export type CartItem = typeof cartItems.$inferSelect;

export interface PublicCartItem {
  asin: string;
  title: string;
  price: number;
  quantity: number;
  added_at: string;
}

export interface ProductResult {
  asin: string;
  title: string;
  price: number | null;
  rating: number | null;
  image: string | null;
  url: string;
}

export interface CartSnapshot {
  items: CartItem[];
  updatedAt: string | null;
}

export interface CartMutation {
  item: CartItem;
  snapshot: CartSnapshot;
}

export interface NewCartItemInput {
  asin: string;
  title: string;
  price: number;
  quantity: number;
}

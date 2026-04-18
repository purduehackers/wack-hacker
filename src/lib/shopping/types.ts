export interface CartItem {
  asin: string;
  title: string;
  price: number;
  quantity: number;
}

export interface Cart {
  items: CartItem[];
  updatedAt: string;
}

export interface ProductResult {
  asin: string;
  title: string;
  price: number | null;
  rating: number | null;
  image: string | null;
  url: string;
}

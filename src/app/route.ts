import { art } from "@/lib/ascii";

export function GET() {
  return new Response(art, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

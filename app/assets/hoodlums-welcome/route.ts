import { HOODLUMS_WELCOME_COMPLETE_PARTS } from "@/lib/hoodlums-welcome-sharp-complete-image";

export const runtime = "nodejs";

const WELCOME_ARTWORK_BYTES = Buffer.from(HOODLUMS_WELCOME_COMPLETE_PARTS.join(""), "base64");

export async function GET() {
  return new Response(new Uint8Array(WELCOME_ARTWORK_BYTES), {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(WELCOME_ARTWORK_BYTES.byteLength),
      "Cache-Control": "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=604800",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

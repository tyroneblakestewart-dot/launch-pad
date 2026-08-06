import { NextResponse } from "next/server";
import { accountOverlayContentFromRecord } from "@/components/account-overlay-shell";
import {
  CMS_PREVIEW_QUERY_PARAM,
  resolvePageContent,
} from "@/lib/server/page-content";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const { content, isPreview } = await resolvePageContent(
    "account",
    url.searchParams.get(CMS_PREVIEW_QUERY_PARAM) || undefined,
  );

  return NextResponse.json(
    {
      content: accountOverlayContentFromRecord(content),
      isPreview,
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}

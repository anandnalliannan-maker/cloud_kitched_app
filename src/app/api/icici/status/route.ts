import { NextResponse } from "next/server";

import { syncIciciOrderStatus } from "@/lib/icici-order";

export async function POST(request: Request) {
  try {
    const { appOrderId } = await request.json();

    if (!appOrderId || typeof appOrderId !== "string") {
      return NextResponse.json(
        { error: "Missing appOrderId." },
        { status: 400 }
      );
    }

    const result = await syncIciciOrderStatus(appOrderId);

    return NextResponse.json({
      ok: true,
      state: result.state,
      orderId: result.displayOrderId,
      payload: result.payload,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to verify ICICI payment." },
      { status: 500 }
    );
  }
}

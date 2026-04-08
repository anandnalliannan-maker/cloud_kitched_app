import { NextResponse } from "next/server";

function buildCustomerRedirectUrl(
  request: Request,
  state: string,
  orderId: string,
  appOrderId: string
) {
  const base = new URL("/customer", request.url);
  base.searchParams.set("payment", state);
  if (orderId) {
    base.searchParams.set("orderId", orderId);
  }
  if (appOrderId) {
    base.searchParams.set("appOrderId", appOrderId);
  }
  return base.toString();
}

async function readIncomingPayload(request: Request) {
  const contentType = request.headers.get("content-type") || "";

  if (request.method === "GET") {
    const url = new URL(request.url);
    return Object.fromEntries(url.searchParams.entries());
  }

  if (contentType.includes("application/json")) {
    return await request.json();
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const formData = await request.formData();
    return Object.fromEntries(formData.entries());
  }

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    return Object.fromEntries(formData.entries());
  }

  const rawText = await request.text();
  if (!rawText) {
    return {};
  }

  try {
    return JSON.parse(rawText);
  } catch {
    const params = new URLSearchParams(rawText);
    return Object.fromEntries(params.entries());
  }
}

async function handleReturn(request: Request) {
  try {
    const payload = await readIncomingPayload(request);
    const appOrderId = String(
      payload.merchantTxnNo || payload.addlParam1 || payload.orderId || ""
    );
    const displayOrderId = String(payload.addlParam2 || payload.orderId || "");

    if (!appOrderId) {
      return NextResponse.redirect(
        buildCustomerRedirectUrl(request, "failed", "", ""),
        { status: 303 }
      );
    }

    return NextResponse.redirect(
      buildCustomerRedirectUrl(request, "verifying", displayOrderId, appOrderId),
      { status: 303 }
    );
  } catch {
    return NextResponse.redirect(buildCustomerRedirectUrl(request, "failed", "", ""), {
      status: 303,
    });
  }
}

export async function GET(request: Request) {
  return handleReturn(request);
}

export async function POST(request: Request) {
  return handleReturn(request);
}

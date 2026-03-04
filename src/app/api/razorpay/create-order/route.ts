import { NextResponse } from "next/server";
import { doc, getDoc, updateDoc } from "firebase/firestore";

import { serverDb } from "@/lib/firebase-server";
import { createBasicAuthHeader, getRazorpayConfig } from "@/lib/razorpay";

export async function POST(request: Request) {
  try {
    const { appOrderId } = await request.json();

    if (!appOrderId || typeof appOrderId !== "string") {
      return NextResponse.json(
        { error: "Missing appOrderId." },
        { status: 400 }
      );
    }

    const orderRef = doc(serverDb, "orders", appOrderId);
    const orderSnap = await getDoc(orderRef);

    if (!orderSnap.exists()) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }

    const orderData = orderSnap.data() as any;
    if (orderData.paymentStatus === "paid") {
      return NextResponse.json(
        { error: "Order is already paid." },
        { status: 409 }
      );
    }

    const amount = Math.round(Number(orderData.total || 0) * 100);
    if (!amount) {
      return NextResponse.json(
        { error: "Invalid order amount." },
        { status: 400 }
      );
    }

    const { keyId, keySecret } = getRazorpayConfig();
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: createBasicAuthHeader(keyId, keySecret),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount,
        currency: "INR",
        receipt: appOrderId,
        notes: {
          internalOrderId: appOrderId,
          customerPhone: orderData.phone || "",
        },
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      return NextResponse.json(
        { error: payload?.error?.description || "Failed to create Razorpay order." },
        { status: response.status }
      );
    }

    await updateDoc(orderRef, {
      razorpayOrderId: payload.id,
      paymentGateway: "razorpay",
    });

    return NextResponse.json({
      keyId,
      amount: payload.amount,
      currency: payload.currency,
      razorpayOrderId: payload.id,
      appOrderId,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to create order." },
      { status: 500 }
    );
  }
}

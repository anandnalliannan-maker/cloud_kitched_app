import { NextResponse } from "next/server";
import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";

import { serverDb } from "@/lib/firebase-server";
import { getRazorpayConfig, verifyRazorpaySignature } from "@/lib/razorpay";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const appOrderId = body?.appOrderId;

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

    if (body?.offline === true) {
      await updateDoc(orderRef, {
        status: "active",
        paymentStatus: "pay_at_outlet",
        paymentMethod: "pay_at_outlet",
        updatedAt: serverTimestamp(),
      });
      return NextResponse.json({ ok: true });
    }

    const razorpayOrderId = body?.razorpay_order_id;
    const razorpayPaymentId = body?.razorpay_payment_id;
    const razorpaySignature = body?.razorpay_signature;

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return NextResponse.json(
        { error: "Missing Razorpay verification fields." },
        { status: 400 }
      );
    }

    const orderData = orderSnap.data() as any;
    if (orderData.razorpayOrderId && orderData.razorpayOrderId !== razorpayOrderId) {
      return NextResponse.json(
        { error: "Razorpay order mismatch." },
        { status: 400 }
      );
    }

    const { keySecret } = getRazorpayConfig();
    const isValid = verifyRazorpaySignature({
      orderId: razorpayOrderId,
      paymentId: razorpayPaymentId,
      signature: razorpaySignature,
      keySecret,
    });

    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid payment signature." },
        { status: 400 }
      );
    }

    await updateDoc(orderRef, {
      status: "active",
      paymentStatus: "paid",
      paymentMethod: "online",
      razorpayOrderId,
      razorpayPaymentId,
      paidAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to verify payment." },
      { status: 500 }
    );
  }
}

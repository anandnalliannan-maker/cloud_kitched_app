import { NextResponse } from "next/server";
import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import { serverDb } from "@/lib/firebase-server";
import { getRazorpayConfig, verifyWebhookSignature } from "@/lib/razorpay";

async function findOrderIdFromPayload(payload: any) {
  const paymentEntity = payload?.payload?.payment?.entity;
  const orderEntity = payload?.payload?.order?.entity;

  const notesOrderId =
    paymentEntity?.notes?.internalOrderId ||
    orderEntity?.notes?.internalOrderId ||
    orderEntity?.receipt;

  if (notesOrderId) {
    return notesOrderId as string;
  }

  const razorpayOrderId = paymentEntity?.order_id || orderEntity?.id;
  if (!razorpayOrderId) {
    return null;
  }

  const snap = await getDocs(
    query(
      collection(serverDb, "orders"),
      where("razorpayOrderId", "==", razorpayOrderId),
      limit(1)
    )
  );

  return snap.empty ? null : snap.docs[0].id;
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-razorpay-signature") || "";
    const { webhookSecret } = getRazorpayConfig();

    if (!webhookSecret) {
      return NextResponse.json(
        { error: "Missing webhook secret." },
        { status: 500 }
      );
    }

    if (!verifyWebhookSignature({ body: rawBody, signature, webhookSecret })) {
      return NextResponse.json(
        { error: "Invalid webhook signature." },
        { status: 400 }
      );
    }

    const payload = JSON.parse(rawBody);
    const event = payload?.event;
    const orderId = await findOrderIdFromPayload(payload);

    if (!orderId) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const paymentEntity = payload?.payload?.payment?.entity;
    const orderEntity = payload?.payload?.order?.entity;
    const orderRef = doc(serverDb, "orders", orderId);

    if (event === "payment.captured" || event === "order.paid") {
      await updateDoc(orderRef, {
        status: "active",
        paymentStatus: "paid",
        paymentMethod: "online",
        razorpayOrderId: paymentEntity?.order_id || orderEntity?.id || "",
        razorpayPaymentId: paymentEntity?.id || "",
        paidAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Webhook handling failed." },
      { status: 500 }
    );
  }
}

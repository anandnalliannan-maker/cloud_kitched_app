import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";

import { serverDb } from "@/lib/firebase-server";
import {
  buildIciciSecureHash,
  getIciciConfig,
  isIciciPaymentPending,
  isIciciPaymentSuccess,
  verifyIciciSecureHash,
} from "@/lib/icici";

type IciciPayload = Record<string, unknown>;

function normalizeIciciPayload(payload: any): IciciPayload {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  if (payload.request || payload.response) {
    return normalizeIciciPayload(payload.request || payload.response);
  }

  return payload as IciciPayload;
}

export async function requestIciciStatus(appOrderId: string) {
  const {
    merchantId,
    aggregatorId,
    secretKey,
    commandUrl,
  } = getIciciConfig();

  const payload = {
    aggregatorID: aggregatorId,
    merchantId,
    merchantTxnNo: appOrderId,
    originalTxnNo: appOrderId,
    transactionType: "STATUS",
  };

  const secureHash = buildIciciSecureHash(payload, secretKey);

  const response = await fetch(commandUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      request: {
        ...payload,
        secureHash,
      },
    }),
    cache: "no-store",
  });

  const rawText = await response.text();
  let rawPayload: any = {};

  try {
    rawPayload = rawText ? JSON.parse(rawText) : {};
  } catch {
    rawPayload = { rawText };
  }

  const statusPayload = normalizeIciciPayload(rawPayload);
  const secureHashValid = statusPayload.secureHash
    ? verifyIciciSecureHash(
        statusPayload as Record<string, string>,
        secretKey,
        String(statusPayload.secureHash || "")
      )
    : false;

  return {
    ok: response.ok,
    status: response.status,
    rawPayload,
    payload: statusPayload,
    secureHashValid,
  };
}

export async function syncIciciOrderStatus(appOrderId: string) {
  const orderRef = doc(serverDb, "orders", appOrderId);
  const orderSnap = await getDoc(orderRef);

  if (!orderSnap.exists()) {
    throw new Error("Order not found.");
  }

  const orderData = orderSnap.data() as any;
  const statusResponse = await requestIciciStatus(appOrderId);
  const payload = statusResponse.payload;

  const sharedUpdate = {
    iciciAggregatorId: getIciciConfig().aggregatorId,
    iciciMerchantId: getIciciConfig().merchantId,
    iciciResponseCode: String(payload.responseCode || ""),
    iciciTxnResponseCode: String(payload.txnResponseCode || ""),
    iciciTxnStatus: String(payload.txnStatus || ""),
    iciciTxnId: String(payload.txnID || ""),
    iciciAuthCode: String(payload.authCode || ""),
    iciciTxnAuthId: String(payload.txnAuthID || ""),
    iciciPaymentId: String(payload.paymentID || ""),
    iciciPaymentMode: String(payload.paymentMode || ""),
    iciciPaymentSubInstType: String(payload.paymentSubInstType || ""),
    iciciRespDescription: String(
      payload.txnRespDescription || payload.respDescription || ""
    ),
    iciciTransmissionDateTime: String(payload.TransmissionDateTime || ""),
    iciciPaymentDateTime: String(payload.paymentDateTime || ""),
    paymentGateway: "icici",
    updatedAt: serverTimestamp(),
  };

  if (isIciciPaymentSuccess(payload)) {
    await updateDoc(orderRef, {
      ...sharedUpdate,
      status: "active",
      paymentStatus: "paid",
      paymentMethod: String(payload.paymentMode || "online").toLowerCase(),
      paidAt: serverTimestamp(),
    });

    return {
      state: "success" as const,
      displayOrderId: String(orderData.orderId || appOrderId),
      payload,
    };
  }

  if (isIciciPaymentPending(payload)) {
    await updateDoc(orderRef, {
      ...sharedUpdate,
      status: "payment_pending",
      paymentStatus: "pending",
    });

    return {
      state: "pending" as const,
      displayOrderId: String(orderData.orderId || appOrderId),
      payload,
    };
  }

  await updateDoc(orderRef, {
    ...sharedUpdate,
    status: "payment_failed",
    paymentStatus: "failed",
  });

  return {
    state: "failed" as const,
    displayOrderId: String(orderData.orderId || appOrderId),
    payload,
  };
}

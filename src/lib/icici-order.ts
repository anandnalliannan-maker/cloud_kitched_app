import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";

import { serverDb } from "@/lib/firebase-server";
import {
  buildIciciSecureHash,
  getIciciAggregatorCandidates,
  getIciciConfig,
  getIciciSecretCandidates,
  isIciciPaymentPending,
  isIciciPaymentSuccess,
  postIciciJson,
  verifyIciciSecureHash,
} from "@/lib/icici";

type IciciPayload = Record<string, unknown>;

function buildStatusPayloadVariants(
  payload: Record<string, string>,
  secretKey: string
) {
  const variants: Record<string, string>[] = [];

  const aggregatorCandidates = getIciciAggregatorCandidates(
    payload.aggregatorID || payload.aggregatorId || ""
  );

  for (const aggregatorCandidate of aggregatorCandidates.length
    ? aggregatorCandidates
    : [payload.aggregatorID || ""]) {
    for (const candidate of getIciciSecretCandidates(secretKey)) {
      const basePayload = {
        ...payload,
        aggregatorID: aggregatorCandidate,
      };
      variants.push({
        ...basePayload,
        secureHash: buildIciciSecureHash(basePayload, candidate),
      });

      const altPayload: Record<string, string> = {
        ...basePayload,
        aggregatorId: aggregatorCandidate,
      };
      delete altPayload.aggregatorID;
      variants.push({
        ...altPayload,
        secureHash: buildIciciSecureHash(altPayload, candidate),
      });
    }
  }

  return Array.from(
    new Map(variants.map((variant) => [JSON.stringify(variant), variant])).values()
  );
}

export async function requestIciciStatus(appOrderId: string, amount?: number) {
  const {
    merchantId,
    aggregatorId,
    secretKey,
    commandUrl,
  } = getIciciConfig();

  const payload = {
    aggregatorID: aggregatorId,
    amount:
      typeof amount === "number" && Number.isFinite(amount)
        ? amount.toFixed(2)
        : "",
    merchantId,
    merchantTxnNo: appOrderId,
    originalTxnNo: appOrderId,
    transactionType: "STATUS",
  };

  const payloadVariants = buildStatusPayloadVariants(payload, secretKey);
  let iciciResponse = null as Awaited<ReturnType<typeof postIciciJson>> | null;

  for (const payloadVariant of payloadVariants) {
    const candidateResponse = await postIciciJson(
      commandUrl,
      payloadVariant,
      ["txnStatus", "responseCode", "txnResponseCode", "txnID"]
    );

    iciciResponse = candidateResponse;
    if (candidateResponse.ok) {
      break;
    }
  }

  const fallbackResponse = iciciResponse || {
    ok: false,
    status: 502,
    rawPayload: {},
    payload: {},
  };
  const statusPayload = fallbackResponse.payload as IciciPayload;
  const secureHashValid = statusPayload.secureHash
    ? verifyIciciSecureHash(
        statusPayload as Record<string, string>,
        secretKey,
        String(statusPayload.secureHash || "")
      )
    : false;

  return {
    ok: fallbackResponse.ok,
    status: fallbackResponse.status,
    rawPayload: fallbackResponse.rawPayload,
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
  const statusResponse = await requestIciciStatus(
    appOrderId,
    Number(orderData.total || 0)
  );
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

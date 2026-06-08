import { doc, getDoc, runTransaction, serverTimestamp, updateDoc } from "firebase/firestore";

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

const PRE_GATEWAY_PENDING_EXPIRY_MS = 5 * 60 * 1000;
const GATEWAY_PENDING_EXPIRY_MS = 20 * 60 * 1000;

function getOrderCreatedAtMs(value: any) {
  if (!value) return 0;
  if (value?.toDate) return value.toDate().getTime();
  if (typeof value === "object" && "seconds" in value) {
    return value.seconds * 1000;
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

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
        secureHash: buildIciciSecureHash(basePayload, candidate.key),
      });

      const altPayload: Record<string, string> = {
        ...basePayload,
        aggregatorId: aggregatorCandidate,
      };
      delete altPayload.aggregatorID;
      variants.push({
        ...altPayload,
        secureHash: buildIciciSecureHash(altPayload, candidate.key),
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
  const createdAtMs = getOrderCreatedAtMs(orderData.createdAt);
  const now = Date.now();
  const hasStartedGatewayFlow =
    Boolean(orderData.iciciTranCtx) ||
    Boolean(orderData.iciciMerchantTxnNo) ||
    orderData.paymentGateway === "icici";

  const restoreFailedOrderInventoryIfNeeded = async () => {
    if (!orderData.publishedMenuId || orderData.inventoryReleaseState === "released") {
      return false;
    }

    await runTransaction(serverDb, async (tx) => {
      const freshOrderSnap = await tx.get(orderRef);
      if (!freshOrderSnap.exists()) return;
      const freshOrder = freshOrderSnap.data() as any;
      if (!freshOrder.publishedMenuId || freshOrder.inventoryReleaseState === "released") {
        return;
      }

      const menuRef = doc(serverDb, "published_menus", freshOrder.publishedMenuId);
      const menuSnap = await tx.get(menuRef);
      if (!menuSnap.exists()) {
        tx.update(orderRef, {
          inventoryReleaseState: "released",
          inventoryReleasedAt: serverTimestamp(),
        });
        return;
      }

      const menuData = menuSnap.data() as any;
      const remaining = (menuData.remaining || menuData.items || []).map((item: any) => ({ ...item }));

      (freshOrder.items || []).forEach((orderedItem: any) => {
        const remainingItem = remaining.find((item: any) => item.itemId === orderedItem.itemId);
        if (remainingItem) {
          remainingItem.qty = (remainingItem.qty || 0) + (orderedItem.qty || 0);
        }
      });

      tx.update(menuRef, {
        remaining,
        updatedAt: serverTimestamp(),
      });
      tx.update(orderRef, {
        inventoryReleaseState: "released",
        inventoryReleasedAt: serverTimestamp(),
      });
    });

    return true;
  };

  const finalizeAsFailedAndRelease = async (reason: string) => {
    await restoreFailedOrderInventoryIfNeeded();
    await updateDoc(orderRef, {
      status: "payment_failed",
      paymentStatus: "failed",
      iciciRespDescription: reason,
      updatedAt: serverTimestamp(),
    });

    return {
      state: "failed" as const,
      displayOrderId: String(orderData.orderId || appOrderId),
      payload: { txnRespDescription: reason },
    };
  };

  if (
    !hasStartedGatewayFlow &&
    createdAtMs > 0 &&
    now - createdAtMs >= PRE_GATEWAY_PENDING_EXPIRY_MS &&
    (orderData.status === "payment_pending" || orderData.paymentStatus === "pending")
  ) {
    return finalizeAsFailedAndRelease("Payment expired before gateway initiation");
  }

  if (!hasStartedGatewayFlow) {
    return {
      state: "pending" as const,
      displayOrderId: String(orderData.orderId || appOrderId),
      payload: {},
    };
  }

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

  const reserveInventoryAgainIfPreviouslyReleased = async () => {
    if (!orderData.publishedMenuId || orderData.inventoryReleaseState !== "released") {
      return false;
    }

    await runTransaction(serverDb, async (tx) => {
      const freshOrderSnap = await tx.get(orderRef);
      if (!freshOrderSnap.exists()) return;
      const freshOrder = freshOrderSnap.data() as any;
      if (!freshOrder.publishedMenuId || freshOrder.inventoryReleaseState !== "released") {
        return;
      }

      const menuRef = doc(serverDb, "published_menus", freshOrder.publishedMenuId);
      const menuSnap = await tx.get(menuRef);
      if (!menuSnap.exists()) {
        tx.update(orderRef, {
          inventoryReleaseState: "reserved",
          inventoryReservedAt: serverTimestamp(),
        });
        return;
      }

      const menuData = menuSnap.data() as any;
      const remaining = (menuData.remaining || menuData.items || []).map((item: any) => ({ ...item }));

      (freshOrder.items || []).forEach((orderedItem: any) => {
        const remainingItem = remaining.find((item: any) => item.itemId === orderedItem.itemId);
        if (remainingItem) {
          remainingItem.qty = Math.max(0, (remainingItem.qty || 0) - (orderedItem.qty || 0));
        }
      });

      tx.update(menuRef, {
        remaining,
        updatedAt: serverTimestamp(),
      });
      tx.update(orderRef, {
        inventoryReleaseState: "reserved",
        inventoryReservedAt: serverTimestamp(),
      });
    });

    return true;
  };

  if (isIciciPaymentSuccess(payload)) {
    await reserveInventoryAgainIfPreviouslyReleased();
    const pickupPaymentUpdate =
      orderData.deliveryType === "pickup"
        ? {
            pickupAmountPaid: Number(orderData.total || 0),
            pickupBalance: 0,
            pickupPaymentUpdatedAt: serverTimestamp(),
          }
        : {};
    await updateDoc(orderRef, {
      ...sharedUpdate,
      status: "active",
      paymentStatus: "paid",
      paymentMethod: String(payload.paymentMode || "online").toLowerCase(),
      paidAt: serverTimestamp(),
      inventoryReleaseState: "reserved",
      ...pickupPaymentUpdate,
    });

    return {
      state: "success" as const,
      displayOrderId: String(orderData.orderId || appOrderId),
      payload,
    };
  }

  if (isIciciPaymentPending(payload)) {
    if (createdAtMs > 0 && now - createdAtMs >= GATEWAY_PENDING_EXPIRY_MS) {
      return finalizeAsFailedAndRelease("Pending payment expired");
    }

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

  await restoreFailedOrderInventoryIfNeeded();
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

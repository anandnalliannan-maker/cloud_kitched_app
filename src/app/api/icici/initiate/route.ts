import { NextResponse } from "next/server";
import { doc, getDoc, updateDoc } from "firebase/firestore";

import { serverDb } from "@/lib/firebase-server";
import {
  buildIciciSecureHash,
  formatIciciTxnDate,
  getIciciConfig,
  getIciciSecretCandidates,
  normalizeMobile,
  postIciciJson,
  verifyIciciSecureHash,
} from "@/lib/icici";

function buildInitiatePayloadVariants(
  payload: Record<string, string>,
  secretKey: string
) {
  const variants: Record<string, string>[] = [];

  for (const candidate of getIciciSecretCandidates(secretKey)) {
    variants.push({
      ...payload,
      secureHash: buildIciciSecureHash(payload, candidate),
    });

    if (payload.aggregatorID) {
      const altPayload: Record<string, string> = {
        ...payload,
        aggregatorId: payload.aggregatorID,
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

    const amount = Number(orderData.total || 0);
    if (!amount) {
      return NextResponse.json(
        { error: "Invalid order amount." },
        { status: 400 }
      );
    }

    const {
      merchantId,
      aggregatorId,
      secretKey,
      initiateSaleUrl,
      returnUrl,
      paymentMode,
      requestType,
    } = getIciciConfig();

    const requestPayload: Record<string, string> = {
      aggregatorID: aggregatorId,
      amount: amount.toFixed(2),
      currencyCode: "356",
      customerEmailID: String(
        orderData.customerEmailID || "guest@mskitchen.app"
      ),
      customerMobileNo: normalizeMobile(String(orderData.phone || "")),
      customerName: String(orderData.customerName || "Customer").slice(0, 45),
      merchantId,
      merchantTxnNo: appOrderId,
      payType: "0",
      returnURL: returnUrl,
      transactionType: "SALE",
      txnDate: formatIciciTxnDate(),
      addlParam1: appOrderId,
      addlParam2: String(orderData.orderId || appOrderId),
    };

    if (paymentMode) {
      requestPayload.paymentMode = paymentMode;
    }
    if (requestType) {
      requestPayload.requestType = requestType;
    }

    const payloadVariants = buildInitiatePayloadVariants(
      requestPayload,
      secretKey
    );

    let iciciResponse = null as Awaited<ReturnType<typeof postIciciJson>> | null;

    for (const payloadVariant of payloadVariants) {
      const candidateResponse = await postIciciJson(
        initiateSaleUrl,
        payloadVariant,
        ["redirectURI", "redirectUrl", "tranCtx", "responseCode", "respDescription"]
      );
      const candidatePayload = candidateResponse.payload;
      const hasRedirect =
        String(candidatePayload.redirectURI || candidatePayload.redirectUrl || "") &&
        String(candidatePayload.tranCtx || "");

      iciciResponse = candidateResponse;
      if (hasRedirect) {
        break;
      }
    }

    const payload = iciciResponse?.payload || {};
    const redirectUri = String(payload.redirectURI || payload.redirectUrl || "");
    const tranCtx = String(payload.tranCtx || "");

    if (!iciciResponse?.ok) {
      return NextResponse.json(
        {
          error:
            String(payload.respDescription || payload.txnRespDescription || "") ||
            "Failed to initiate ICICI payment.",
          payload,
        },
        { status: iciciResponse?.status || 502 }
      );
    }

    if (!redirectUri || !tranCtx) {
      return NextResponse.json(
        {
          error: "ICICI gateway did not return redirect details.",
          payload,
        },
        { status: 502 }
      );
    }

    await updateDoc(orderRef, {
      iciciAggregatorId: aggregatorId,
      iciciMerchantId: merchantId,
      iciciMerchantTxnNo: appOrderId,
      iciciInitResponseCode: String(payload.responseCode || ""),
      iciciInitTxnResponseCode: String(payload.txnResponseCode || ""),
      iciciInitRespDescription: String(
        payload.txnRespDescription || payload.respDescription || ""
      ),
      iciciTranCtx: tranCtx,
      paymentGateway: "icici",
      updatedAt: new Date(),
    });

    const paymentUrl = `${redirectUri}${redirectUri.includes("?") ? "&" : "?"}tranCtx=${encodeURIComponent(
      tranCtx
    )}`;

    return NextResponse.json({
      appOrderId,
      paymentUrl,
      secureHashValid: payload.secureHash
        ? verifyIciciSecureHash(
            payload as Record<string, string>,
            secretKey,
            String(payload.secureHash)
          )
        : false,
    });
  } catch (error: any) {
    console.error("ICICI initiate failed", error);
    return NextResponse.json(
      { error: error?.message || "Failed to initiate ICICI payment." },
      { status: 500 }
    );
  }
}

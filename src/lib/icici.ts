import crypto from "crypto";

type Primitive = string | number | boolean | null | undefined;
type Payload = Record<string, Primitive>;
type IciciJsonResult = {
  ok: boolean;
  status: number;
  rawPayload: any;
  payload: Record<string, unknown>;
};

export function getIciciConfig() {
  const merchantId = process.env.ICICI_MERCHANT_ID || "";
  const aggregatorId = process.env.ICICI_AGGREGATOR_ID || "";
  const secretKey = process.env.ICICI_SECRET_KEY || "";
  const initiateSaleUrl =
    process.env.ICICI_INITIATE_SALE_URL ||
    "https://pgpay.icicibank.com/pg/api/v2/initiateSale";
  const commandUrl =
    process.env.ICICI_COMMAND_URL ||
    "https://pgpay.icicibank.com/pg/api/command";
  const returnUrl = process.env.ICICI_RETURN_URL || "";
  const paymentMode = process.env.ICICI_PAYMENT_MODE || "";
  const requestType = process.env.ICICI_REQUEST_TYPE || "";

  if (!merchantId || !aggregatorId || !secretKey || !returnUrl) {
    throw new Error("Missing ICICI payment environment variables.");
  }

  return {
    merchantId,
    aggregatorId,
    secretKey,
    initiateSaleUrl,
    commandUrl,
    returnUrl,
    paymentMode,
    requestType,
  };
}

export function formatIciciTxnDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Calcutta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const pick = (type: string) =>
    parts.find((part) => part.type === type)?.value || "";

  return `${pick("year")}${pick("month")}${pick("day")}${pick("hour")}${pick(
    "minute"
  )}${pick("second")}`;
}

export function normalizeMobile(value: string) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) {
    return `91${digits}`;
  }
  if (digits.startsWith("91") && digits.length === 12) {
    return digits;
  }
  return digits;
}

export function buildIciciSecureHash(payload: Payload, secretKey: string) {
  const resolvedSecretKey = getIciciSecretCandidates(secretKey)[0] || secretKey;
  const hashText = Object.keys(payload)
    .filter(
      (key) =>
        key !== "secureHash" &&
        payload[key] !== undefined &&
        payload[key] !== null &&
        payload[key] !== ""
    )
    .sort((a, b) => a.localeCompare(b))
    .map((key) => String(payload[key]))
    .join("");

  return crypto
    .createHmac("sha256", resolvedSecretKey)
    .update(hashText)
    .digest("hex");
}

export function getIciciSecretCandidates(secretKey: string) {
  const normalized = String(secretKey || "").trim();
  const candidates = [normalized];

  if (normalized.includes(":")) {
    const suffix = normalized.split(":").slice(1).join(":").trim();
    if (suffix) {
      candidates.unshift(suffix);
    }
  }

  return Array.from(new Set(candidates.filter(Boolean)));
}

export function verifyIciciSecureHash(
  payload: Payload,
  secretKey: string,
  receivedHash?: string
) {
  const actual = String(receivedHash || payload.secureHash || "");
  if (!actual) {
    return false;
  }

  return getIciciSecretCandidates(secretKey).some((candidate) => {
    const expected = buildIciciSecureHash(payload, candidate);
    return expected.toLowerCase() === actual.toLowerCase();
  });
}

export function isIciciPaymentSuccess(payload: Record<string, any>) {
  const responseCode = String(payload.responseCode || "");
  const txnResponseCode = String(payload.txnResponseCode || "");
  const txnStatus = String(payload.txnStatus || "").toUpperCase();
  return (
    txnStatus === "SUC" ||
    (responseCode === "000" && txnResponseCode === "0000") ||
    responseCode === "0000"
  );
}

export function isIciciPaymentPending(payload: Record<string, any>) {
  const responseCode = String(payload.responseCode || "").toUpperCase();
  const txnStatus = String(payload.txnStatus || "").toUpperCase();
  return responseCode === "R1000" || txnStatus === "PEN" || txnStatus === "PENDING";
}

function normalizeIciciJson(payload: any): Record<string, unknown> {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  if (payload.request || payload.response) {
    return normalizeIciciJson(payload.request || payload.response);
  }

  return payload as Record<string, unknown>;
}

async function postJson(url: string, body: unknown): Promise<IciciJsonResult> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const rawText = await response.text();
  let rawPayload: any = {};

  try {
    rawPayload = rawText ? JSON.parse(rawText) : {};
  } catch {
    rawPayload = { rawText };
  }

  return {
    ok: response.ok,
    status: response.status,
    rawPayload,
    payload: normalizeIciciJson(rawPayload),
  };
}

export async function postIciciJson(
  url: string,
  payload: Payload,
  expectedKeys: string[]
) {
  const rawResult = await postJson(url, payload);
  const rawHasExpected = expectedKeys.some((key) => {
    const value = rawResult.payload[key];
    return value !== undefined && value !== null && value !== "";
  });

  if (rawHasExpected) {
    return rawResult;
  }

  const wrappedResult = await postJson(url, { request: payload });
  const wrappedHasExpected = expectedKeys.some((key) => {
    const value = wrappedResult.payload[key];
    return value !== undefined && value !== null && value !== "";
  });

  if (wrappedHasExpected || wrappedResult.ok) {
    return wrappedResult;
  }

  return rawResult;
}

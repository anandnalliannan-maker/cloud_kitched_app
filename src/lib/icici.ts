import crypto from "crypto";

type Primitive = string | number | boolean | null | undefined;
type Payload = Record<string, Primitive>;
type SecretCandidate = {
  label: string;
  key: crypto.BinaryLike;
};
type IciciJsonResult = {
  ok: boolean;
  status: number;
  rawPayload: any;
  payload: Record<string, unknown>;
  requestMeta?: {
    contentType: string;
    shape: "raw" | "wrapped";
  };
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

export function getIciciAggregatorCandidates(aggregatorId: string) {
  const normalized = String(aggregatorId || "").trim();
  if (!normalized) {
    return [];
  }

  if (/^A\d+$/.test(normalized)) {
    return [normalized.slice(1)];
  }

  return [normalized];
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

export function buildIciciSecureHash(
  payload: Payload,
  secretKey: crypto.BinaryLike
) {
  const hashText = Object.keys(payload)
    .filter(
      (key) =>
        key !== "secureHash" &&
        payload[key] !== undefined &&
        payload[key] !== null &&
        payload[key] !== ""
    )
    .sort()
    .map((key) => String(payload[key]))
    .join("");

  return crypto
    .createHmac("sha256", secretKey)
    .update(hashText)
    .digest("hex");
}

function tryDecodeBase64(value: string) {
  if (!/^[A-Za-z0-9+/=]+$/.test(value) || value.length % 4 !== 0) {
    return null;
  }

  try {
    const decoded = Buffer.from(value, "base64");
    if (!decoded.length) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function getIciciSecretCandidates(secretKey: string): SecretCandidate[] {
  const normalized = String(secretKey || "").trim();
  const candidates: SecretCandidate[] = [];

  if (normalized) {
    candidates.push({ label: "full", key: normalized });
  }

  if (normalized.includes(":")) {
    const suffix = normalized.split(":").slice(1).join(":").trim();
    if (suffix) {
      candidates.push({ label: "suffix", key: suffix });
      const decodedSuffix = tryDecodeBase64(suffix);
      if (decodedSuffix) {
        candidates.push({ label: "suffix_base64", key: decodedSuffix });
      }
    }
  }

  return Array.from(
    new Map(
      candidates
        .filter((candidate) => Boolean(candidate.key))
        .map((candidate) => [
          `${candidate.label}:${Buffer.isBuffer(candidate.key) ? candidate.key.toString("base64") : candidate.key}`,
          candidate,
        ])
    ).values()
  );
}

export function describeIciciSecretVariant(secretLabel: string) {
  return secretLabel || "unknown";
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
    const expected = buildIciciSecureHash(payload, candidate.key);
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

async function postJson(
  url: string,
  body: unknown,
  contentType = "application/json",
  shape: "raw" | "wrapped" = "raw"
): Promise<IciciJsonResult> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": contentType,
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
    requestMeta: {
      contentType,
      shape,
    },
  };
}

export async function postIciciJson(
  url: string,
  payload: Payload,
  expectedKeys: string[]
) {
  const attempts: Array<{ body: unknown; contentType: string }> = [
    { body: payload, contentType: "application/json" },
    { body: payload, contentType: "text/plain" },
    { body: { request: payload }, contentType: "application/json" },
    { body: { request: payload }, contentType: "text/plain" },
  ];

  let lastResult: IciciJsonResult | null = null;
  let bestResult: IciciJsonResult | null = null;

  for (const attempt of attempts) {
    const result = await postJson(
      url,
      attempt.body,
      attempt.contentType,
      attempt.body === payload ? "raw" : "wrapped"
    );
    lastResult = result;

    const hasExpected = expectedKeys.some((key) => {
      const value = result.payload[key];
      return value !== undefined && value !== null && value !== "";
    });

    if (hasExpected) {
      return result;
    }

    const responseCode = String(result.payload.responseCode || "").toUpperCase();
    const txnResponseCode = String(
      result.payload.txnResponseCode || ""
    ).toUpperCase();
    if (
      responseCode === "R1000" ||
      responseCode === "000" ||
      txnResponseCode === "0000"
    ) {
      return result;
    }

    if (!bestResult || responseCode === "R1000" || responseCode === "000") {
      bestResult = result;
    }
  }

  return (
    bestResult ||
    lastResult || {
      ok: false,
      status: 502,
      rawPayload: {},
      payload: {},
    }
  );
}

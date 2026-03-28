import crypto from "crypto";

type Primitive = string | number | boolean | null | undefined;
type Payload = Record<string, Primitive>;

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

  return crypto.createHmac("sha256", secretKey).update(hashText).digest("hex");
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
  const expected = buildIciciSecureHash(payload, secretKey);
  return expected.toLowerCase() === actual.toLowerCase();
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

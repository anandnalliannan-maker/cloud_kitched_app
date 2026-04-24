"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ConfirmationResult,
  inMemoryPersistence,
  RecaptchaVerifier,
  setPersistence,
  signInWithPhoneNumber,
  signOut,
} from "firebase/auth";
import {
  Autocomplete,
  GoogleMap,
  LoadScript,
  Marker,
} from "@react-google-maps/api";
import {
  arrayUnion,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import { getSubAreasForArea, isMappedSubArea } from "@/lib/subareas";

type CartItem = {
  id: string;
  name: string;
  price: number;
  qty: number;
  imageUrl?: string;
  active?: boolean;
};

type PaymentSummary = {
  appOrderId: string;
  displayOrderId: string;
  items: {
    id: string;
    name: string;
    price: number;
    qty: number;
    imageUrl?: string;
  }[];
  itemsTotal: number;
  deliveryFee: number;
  total: number;
  deliveryType: "delivery" | "pickup" | "";
  paymentMethod: "upi" | "cash_on_delivery" | "pay_at_outlet";
  location: { lat: number; lng: number } | null;
  addressText?: string;
};

type ServiceAreaOption = {
  id: string;
  name: string;
  deliveryFee?: number;
  subAreas?: string[];
};

type CustomerOrder = {
  id: string;
  orderId: string;
  customerName: string;
  phone: string;
  status: string;
  deliveryType: string;
  address: string;
  area: string;
  subArea?: string;
  total: number;
  paymentStatus?: string;
  paymentMethod?: string;
  publishedDate: string;
  mealType: string;
  createdAt: any;
  publishedMenuId?: string;
  items: { name: string; qty: number; price?: number }[];
};

const mapContainerStyle = { width: "100%", height: "320px" };
const defaultCenter = { lat: 12.9716, lng: 80.2214 };
const pendingPaymentStorageKey = "msk_pending_payment";
const customerProfileStorageKeyPrefix = "msk_customer_profile";
const MIN_HOME_DELIVERY_ORDER = 60;

function normalizePhoneForOtp(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (raw.trim().startsWith("+")) return raw.trim();
  return digits;
}

function getPhoneVariants(rawPhone: string) {
  const digits = rawPhone.replace(/\D/g, "");
  return Array.from(
    new Set(
      [
        rawPhone.trim(),
        digits,
        digits ? `+${digits}` : "",
        digits.length === 10 ? `+91${digits}` : "",
        digits.length === 10 ? `91${digits}` : "",
      ].filter(Boolean)
    )
  );
}

type LocalCustomerProfile = {
  name: string;
  deliveryType: "delivery" | "pickup" | "";
  addressLine1: string;
  street: string;
  area: string;
  subArea: string;
  location: { lat: number; lng: number } | null;
};

function getLocalCustomerProfileKey(rawPhone: string) {
  const digits = rawPhone.replace(/\D/g, "");
  return digits ? `${customerProfileStorageKeyPrefix}:${digits}` : "";
}

function readLocalCustomerProfile(rawPhone: string): LocalCustomerProfile | null {
  if (typeof window === "undefined") return null;
  const key = getLocalCustomerProfileKey(rawPhone);
  if (!key) return null;
  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) return null;
    return JSON.parse(stored) as LocalCustomerProfile;
  } catch {
    return null;
  }
}

function saveLocalCustomerProfile(rawPhone: string, profile: LocalCustomerProfile) {
  if (typeof window === "undefined") return;
  const key = getLocalCustomerProfileKey(rawPhone);
  if (!key) return;
  window.localStorage.setItem(key, JSON.stringify(profile));
}

function getAssignmentMealKey(mealType?: string) {
  const normalized = String(mealType || "").trim().toLowerCase();
  if (normalized === "lunch") return "Lunch";
  if (normalized === "dinner") return "Dinner";
  return "";
}

async function generateUniqueSixDigitOrderId() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const timestampPart = Date.now() % 100000;
    const randomPart = Math.floor(Math.random() * 10);
    const candidate = String(timestampPart * 10 + randomPart).padStart(6, "0");
    const existing = await getDocs(
      query(collection(db, "orders"), where("orderId", "==", candidate), limit(1))
    );
    if (existing.empty) {
      return candidate;
    }
  }

  return String(Math.floor(100000 + Math.random() * 900000));
}

async function fetchOrdersByPhone(rawPhone: string) {
  const latestFirst = await Promise.all(
    getPhoneVariants(rawPhone).map(async (phoneVariant) => {
      const snap = await getDocs(
        query(collection(db, "orders"), where("phone", "==", phoneVariant))
      );
      return snap.docs.map((docSnap) => {
        const data = docSnap.data() as any;
        return {
          id: docSnap.id,
          orderId: data.orderId || docSnap.id,
          customerName: data.customerName || "",
          phone: data.phone || "",
          status: data.status || "",
          deliveryType: data.deliveryType || "",
          address: data.address || "",
          area: data.area || "",
          subArea: data.subArea || "",
          total: Number(data.total || 0),
          paymentStatus: data.paymentStatus || "",
          paymentMethod: data.paymentMethod || "",
          publishedDate: data.publishedDate || "",
          publishedMenuId: data.publishedMenuId || "",
          mealType: data.mealType || "",
          createdAt: data.createdAt || null,
          items: Array.isArray(data.items) ? data.items : [],
        } as CustomerOrder;
      });
    })
  );

  const merged = new Map<string, CustomerOrder>();
  latestFirst.flat().forEach((order) => merged.set(order.id, order));
  return Array.from(merged.values()).sort((a, b) => {
    const aSec = a.createdAt?.seconds || 0;
    const bSec = b.createdAt?.seconds || 0;
    return bSec - aSec;
  });
}

export default function CustomerPage() {
  const [items, setItems] = useState<
    (CartItem & { description: string; remaining: number })[]
  >([]);
  const [serviceAreas, setServiceAreas] = useState<ServiceAreaOption[]>([]);
  const [menuDateLabel, setMenuDateLabel] = useState("");
  const [menuMealLabel, setMenuMealLabel] = useState("");
  const [publishedMenuId, setPublishedMenuId] = useState<string | null>(null);
  const [menuAvailability, setMenuAvailability] = useState<
    "available" | "archived" | "sold_out" | "empty"
  >("empty");
  const [step, setStep] = useState<"menu" | "details" | "payment">("menu");
  const [deliveryType, setDeliveryType] = useState<
    "delivery" | "pickup" | ""
  >("");
  const [form, setForm] = useState({
    name: "",
    phone: "",
    addressLine1: "",
    street: "",
    area: "",
    subArea: "",
  });
  const [customSubAreaDraft, setCustomSubAreaDraft] = useState("");
  const [showCustomSubAreaInput, setShowCustomSubAreaInput] = useState(false);
  const [customSubAreaError, setCustomSubAreaError] = useState("");
  const [isSavingCustomSubArea, setIsSavingCustomSubArea] = useState(false);
  const [localSubAreasByArea, setLocalSubAreasByArea] = useState<Record<string, string[]>>({});
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [locLabel, setLocLabel] = useState("");
  const [locError, setLocError] = useState("");
  const [payError, setPayError] = useState("");
  const [paymentNotice, setPaymentNotice] = useState("");
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [isConfirmingOutletOrder, setIsConfirmingOutletOrder] = useState(false);
  const [paymentSummary, setPaymentSummary] = useState<PaymentSummary | null>(
    null
  );
  const [customerDrawerOpen, setCustomerDrawerOpen] = useState(false);
  const [customerView, setCustomerView] = useState<"menu" | "history" | "cancel">("menu");
  const [historyPhone, setHistoryPhone] = useState("");
  const [historyOrders, setHistoryOrders] = useState<CustomerOrder[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historySearched, setHistorySearched] = useState(false);
  const [cancelPhone, setCancelPhone] = useState("");
  const [cancelOtp, setCancelOtp] = useState("");
  const [cancelOrders, setCancelOrders] = useState<CustomerOrder[]>([]);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [cancelStatus, setCancelStatus] = useState("");
  const [cancelOtpSent, setCancelOtpSent] = useState(false);
  const [cancelVerifiedPhone, setCancelVerifiedPhone] = useState("");
  const [cancelVerificationLoading, setCancelVerificationLoading] = useState(false);
  const [cancelOtpSending, setCancelOtpSending] = useState(false);
  const [cancelingOrderId, setCancelingOrderId] = useState<string | null>(null);
  const [expandedDescriptions, setExpandedDescriptions] = useState<string[]>([]);
  const [customerPrefillNotice, setCustomerPrefillNotice] = useState("");
  const [customerPrefillPopup, setCustomerPrefillPopup] = useState("");
  const [isPrefillingCustomer, setIsPrefillingCustomer] = useState(false);
  const [pendingPaymentResume, setPendingPaymentResume] = useState<{
    appOrderId: string;
    displayOrderId: string;
  } | null>(null);
  const [isCheckingPendingPayment, setIsCheckingPendingPayment] = useState(false);
  const [paymentSuccessPopup, setPaymentSuccessPopup] = useState<{
    orderId: string;
    message: string;
  } | null>(null);
  const lastPrefilledPhoneRef = useRef("");
  const cancelConfirmationRef = useRef<ConfirmationResult | null>(null);
  const cancelRecaptchaRef = useRef<RecaptchaVerifier | null>(null);

  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  function clearPendingPaymentResume() {
    setPendingPaymentResume(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(pendingPaymentStorageKey);
    }
  }

  function toggleDescription(itemId: string) {
    setExpandedDescriptions((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
    );
  }

  useEffect(() => {
    return () => {
      if (cancelRecaptchaRef.current) {
        cancelRecaptchaRef.current.clear();
        cancelRecaptchaRef.current = null;
      }
      signOut(auth).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const q = query(
      collection(db, "published_menus"),
      orderBy("createdAt", "desc"),
      limit(10)
    );
    const unsub = onSnapshot(q, (snap) => {
      if (snap.empty) {
        setItems([]);
        setMenuDateLabel("");
        setMenuMealLabel("");
        setPublishedMenuId(null);
        setMenuAvailability("empty");
        return;
      }

      const docSnap =
        snap.docs.find((candidate) => {
          const candidateData = candidate.data() as any;
          if (candidateData.isArchived || candidateData.ordersStopped) return false;
          const itemIds = Array.from(
            new Set(
              [...(candidateData.items || []), ...(candidateData.remaining || [])].map(
                (item: any) => item.itemId
              )
            )
          );
          return itemIds.some((itemId) => {
            const itemRecord = (candidateData.items || []).find(
              (item: any) => item.itemId === itemId
            );
            const remainingRecord = (candidateData.remaining || []).find(
              (item: any) => item.itemId === itemId
            );
            return itemRecord?.active !== false && remainingRecord?.active !== false;
          });
        }) || snap.docs[0];
      const data = docSnap.data() as any;

      setPublishedMenuId(docSnap.id);
      setMenuDateLabel(data.date || "");
      setMenuMealLabel(data.mealType || "");

      if (data.isArchived) {
        setItems([]);
        setMenuAvailability("archived");
        return;
      }

      if (data.ordersStopped) {
        setItems([]);
        setMenuAvailability("sold_out");
        return;
      }

      const itemIds = Array.from(
        new Set(
          [...(data.items || []), ...(data.remaining || [])].map((item: any) => item.itemId)
        )
      );
      const effectiveItems = itemIds.map((itemId) => {
        const itemRecord = (data.items || []).find((item: any) => item.itemId === itemId) || {};
        const remainingRecord =
          (data.remaining || []).find((item: any) => item.itemId === itemId) || {};
        return {
          ...itemRecord,
          ...remainingRecord,
          itemId,
          active: itemRecord.active !== false && remainingRecord.active !== false,
          qty:
            typeof remainingRecord.qty === "number"
              ? remainingRecord.qty
              : typeof itemRecord.qty === "number"
                ? itemRecord.qty
                : 0,
        };
      });
      const remainingMap = new Map(
        effectiveItems
          .filter((item: any) => item.active !== false)
          .map((item: any) => [item.itemId, item.qty ?? 0])
      );
      const menuItems = effectiveItems
        .filter((item: any) => item.active !== false)
        .map((item: any) => ({
          id: item.itemId,
          name: item.name,
          price: item.price,
          qty: 0,
          description: item.description || "",
          imageUrl: item.imageUrl || "",
          remaining: remainingMap.get(item.itemId) ?? 0,
          active: item.active !== false,
        }));
      setItems(menuItems);
      setMenuAvailability("available");
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const stored = window.localStorage.getItem(pendingPaymentStorageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as {
          appOrderId?: string;
          displayOrderId?: string;
        };
        if (parsed?.appOrderId && parsed?.displayOrderId) {
          setPendingPaymentResume({
            appOrderId: parsed.appOrderId,
            displayOrderId: parsed.displayOrderId,
          });
        }
      } catch {
        window.localStorage.removeItem(pendingPaymentStorageKey);
      }
    }

    const url = new URL(window.location.href);
    const paymentState = url.searchParams.get("payment");
    const orderId = url.searchParams.get("orderId");
    const appOrderId = url.searchParams.get("appOrderId");

    if (!paymentState) {
      return;
    }

    const messages: Record<string, string> = {
      success: orderId
        ? `Order placed successfully. Order ID: ${orderId}`
        : "Order placed successfully.",
      pending: orderId
        ? `Payment is pending for order ${orderId}. We will update the status after confirmation.`
        : "Payment is pending. We will update the status after confirmation.",
      verifying: orderId
        ? `Verifying payment for order ${orderId}.`
        : "Verifying payment. Please wait...",
      failed: orderId
        ? `Payment failed for order ${orderId}. Please try again.`
        : "Payment failed. Please try again.",
    };

    const nextMessage = messages[paymentState] || "Payment status updated.";
    setPaymentNotice(nextMessage);
    setPayError(paymentState === "failed" ? messages.failed : "");
    setCustomerView("menu");

    if (paymentState === "verifying" && appOrderId) {
      resetCheckoutState();
      const resumedOrder = {
        appOrderId,
        displayOrderId: orderId || appOrderId,
      };
      setPendingPaymentResume(resumedOrder);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          pendingPaymentStorageKey,
          JSON.stringify(resumedOrder)
        );
      }
      window.setTimeout(() => {
        void checkPendingPaymentStatus(resumedOrder, { silent: true });
      }, 150);
    } else {
      resetCheckoutState();
      clearPendingPaymentResume();
    }

    if (paymentState === "success") {
      setPaymentSuccessPopup({
        orderId: orderId || "",
        message: nextMessage,
      });
    }

    url.searchParams.delete("payment");
    url.searchParams.delete("orderId");
    url.searchParams.delete("appOrderId");
    window.history.replaceState({}, "", url.toString());
  }, []);

  async function checkPendingPaymentStatus(
    pendingOrder = pendingPaymentResume,
    opts?: { silent?: boolean }
  ) {
    if (!pendingOrder?.appOrderId || isCheckingPendingPayment) {
      return;
    }

    setIsCheckingPendingPayment(true);
    if (!opts?.silent) {
      setPayError("");
      setPaymentNotice("");
    }

    try {
      const response = await fetch("/api/icici/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appOrderId: pendingOrder.appOrderId }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to verify payment status.");
      }

      const messages: Record<string, string> = {
        success: `Order placed successfully. Order ID: ${payload.orderId || pendingOrder.displayOrderId}`,
        pending: `Payment is still pending for order ${payload.orderId || pendingOrder.displayOrderId}.`,
        failed: `Payment failed for order ${payload.orderId || pendingOrder.displayOrderId}. Please try again.`,
      };

      const state = String(payload.state || "");
      const nextMessage = messages[state] || "Payment status updated.";

      setPaymentNotice(nextMessage);
      setPayError(state === "failed" ? nextMessage : "");

      if (state === "success") {
        resetCheckoutState();
        setCustomerView("menu");
        clearPendingPaymentResume();
        setPaymentSuccessPopup({
          orderId: String(payload.orderId || pendingOrder.displayOrderId || ""),
          message: nextMessage,
        });
      } else if (state === "failed") {
        clearPendingPaymentResume();
      }
    } catch (error: any) {
      if (!opts?.silent) {
        setPayError(error?.message || "Failed to verify payment status.");
      }
    } finally {
      setIsCheckingPendingPayment(false);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined" || !pendingPaymentResume?.appOrderId) {
      return;
    }

    const handleResume = () => {
      if (document.visibilityState === "visible") {
        void checkPendingPaymentStatus(pendingPaymentResume, { silent: true });
      }
    };

    window.addEventListener("focus", handleResume);
    document.addEventListener("visibilitychange", handleResume);

    return () => {
      window.removeEventListener("focus", handleResume);
      document.removeEventListener("visibilitychange", handleResume);
    };
  }, [pendingPaymentResume, isCheckingPendingPayment]);

  useEffect(() => {
    if (typeof window === "undefined" || customerView !== "menu") {
      return;
    }

    if (step === "details" || step === "payment") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [step, customerView]);

  useEffect(() => {
    if (!customerPrefillPopup) {
      return;
    }

    const timer = window.setTimeout(() => {
      setCustomerPrefillPopup("");
    }, 1800);

    return () => window.clearTimeout(timer);
  }, [customerPrefillPopup]);

  useEffect(() => {
    if (step !== "details") {
      return;
    }

    const trimmedPhone = form.phone.trim();
    const digits = trimmedPhone.replace(/\D/g, "");

    if (digits.length < 10) {
      setCustomerPrefillNotice("");
      setCustomerPrefillPopup("");
      lastPrefilledPhoneRef.current = "";
      return;
    }

    if (lastPrefilledPhoneRef.current === trimmedPhone) {
      return;
    }

    const timer = window.setTimeout(() => {
      setIsPrefillingCustomer(true);
      try {
        const latestOrder = readLocalCustomerProfile(trimmedPhone);
        lastPrefilledPhoneRef.current = trimmedPhone;

        if (!latestOrder) {
          setCustomerPrefillNotice("");
          setCustomerPrefillPopup("");
          return;
        }

        setForm((prev) => ({
          ...prev,
          name: prev.name.trim() || latestOrder.name || "",
          addressLine1:
            latestOrder.deliveryType === "delivery"
              ? latestOrder.addressLine1 || prev.addressLine1
              : prev.addressLine1,
          street:
            latestOrder.deliveryType === "delivery"
              ? latestOrder.street || prev.street
              : prev.street,
          area:
            latestOrder.deliveryType === "delivery"
              ? latestOrder.area || prev.area
              : prev.area,
          subArea:
            latestOrder.deliveryType === "delivery"
              ? latestOrder.subArea || prev.subArea
              : prev.subArea,
        }));

        if (latestOrder.deliveryType === "delivery") {
          setDeliveryType("delivery");
          if (latestOrder.location?.lat && latestOrder.location?.lng) {
            setLocation({
              lat: Number(latestOrder.location.lat),
              lng: Number(latestOrder.location.lng),
            });
            setLocLabel("Saved location loaded from this browser");
            setLocError("");
          }
        } else if (latestOrder.deliveryType === "pickup" && !deliveryType) {
          setDeliveryType("pickup");
        }

        setCustomerPrefillNotice(
          "Address loaded"
        );
        setCustomerPrefillPopup("Address loaded");
      } catch {
        setCustomerPrefillNotice("");
        setCustomerPrefillPopup("");
      } finally {
        setIsPrefillingCustomer(false);
      }
    }, 450);

    return () => window.clearTimeout(timer);
  }, [form.phone, step]);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "service_areas"), orderBy("name", "asc")),
      (snap) => {
        setServiceAreas(
          snap.docs.map((docSnap) => {
            const data = docSnap.data() as any;
            return {
              id: docSnap.id,
              name: data.name || "",
              deliveryFee: Number(data.deliveryFee || 0),
              subAreas: Array.isArray(data.subAreas) ? data.subAreas.filter(Boolean) : [],
            };
          })
        );
      }
    );
    return () => unsub();
  }, []);

  const itemsTotal = useMemo(
    () => items.reduce((sum, item) => sum + item.price * item.qty, 0),
    [items]
  );

  const selectedAreaConfig = useMemo(
    () => serviceAreas.find((area) => area.name === form.area) || null,
    [serviceAreas, form.area]
  );
  const subAreaOptions = useMemo(() => {
    const saved =
      serviceAreas.find((area) => area.name === form.area)?.subAreas?.filter(Boolean) || [];
    const local = localSubAreasByArea[form.area] || [];
    return Array.from(new Set([...getSubAreasForArea(form.area), ...saved, ...local])).sort(
      (a, b) => a.localeCompare(b)
    );
  }, [serviceAreas, form.area, localSubAreasByArea]);

  const isLunchMenu = useMemo(
    () => (menuMealLabel || "").trim().toLowerCase() === "lunch",
    [menuMealLabel]
  );

  const selectedDeliveryFee =
    deliveryType === "delivery" && !isLunchMenu
      ? Number(selectedAreaConfig?.deliveryFee || 0)
      : 0;

  const total = itemsTotal + selectedDeliveryFee;

  const hasItems = total > 0;

  function getMissingOrderFields() {
    const missing: string[] = [];
    const phoneDigits = form.phone.replace(/\D/g, "");

    if (!form.name.trim()) {
      missing.push("Name");
    }
    if (!form.phone.trim()) {
      missing.push("Mobile Number");
    } else if (phoneDigits.length < 10) {
      missing.push("Valid Mobile Number");
    }
    if (!deliveryType) {
      missing.push("Delivery Type");
    }

    if (deliveryType === "delivery") {
      if (!form.addressLine1.trim()) {
        missing.push("Door No / Apartment / House Name");
      }
      if (!form.street.trim()) {
        missing.push("Street");
      }
      if (!form.area.trim()) {
        missing.push("Area");
      }
      if (!form.subArea.trim()) {
        missing.push("Sub Area");
      }
      if (!location) {
        missing.push("Exact Location on Map");
      }
    }

    return missing;
  }

  function updateQty(id: string, delta: number) {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, qty: Math.max(0, item.qty + delta) }
          : item
      )
    );
  }

  function onAutocompleteLoad(ac: google.maps.places.Autocomplete) {
    autocompleteRef.current = ac;
  }

  function onPlaceChanged() {
    const ac = autocompleteRef.current;
    if (!ac) return;
    const place = ac.getPlace();
    if (!place.geometry?.location) return;
    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();
    setLocError("");
    setLocation({ lat, lng });
    setLocLabel(place.formatted_address || place.name || "Location selected");
  }

  const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  function useCurrentLocation() {
    setLocError("");
    if (!navigator.geolocation) {
      setLocError("Geolocation is not supported on this device.");
      return;
    }
    setLocLabel("Fetching current location...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocLabel("Current location selected");
      },
      () => {
        setLocError("Unable to fetch current location.");
        setLocLabel("");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  function formatDateLabel(value: string) {
    if (!value) return "";
    const [year, month, day] = value.split("-");
    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const monthIndex = Number(month) - 1;
    const monthLabel = monthNames[monthIndex] || month;
    return `${day}-${monthLabel}-${year}`;
  }

  function formatDateTimeFromTs(value: any) {
    if (!value) return "-";
    try {
      const date =
        typeof value?.toDate === "function"
          ? value.toDate()
          : value?.seconds
          ? new Date(value.seconds * 1000)
          : new Date(value);
      if (Number.isNaN(date.getTime())) return "-";
      return date.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "-";
    }
  }

  async function loadOrderHistory() {
    setHistoryError("");
    const raw = historyPhone.trim();
    if (!raw) {
      setHistoryError("Enter phone number.");
      return;
    }
    setHistoryLoading(true);
    setHistorySearched(true);
    try {
      setHistoryOrders(await fetchOrdersByPhone(raw));
    } catch (err: any) {
      setHistoryError(err?.message || "Failed to load order history.");
    } finally {
      setHistoryLoading(false);
    }
  }

  function canCancelOrder(order: CustomerOrder) {
    return order.status === "active" || order.status === "payment_pending";
  }

  async function ensureCancelRecaptcha() {
    if (cancelRecaptchaRef.current || typeof window === "undefined") {
      return cancelRecaptchaRef.current;
    }

    cancelRecaptchaRef.current = new RecaptchaVerifier(auth, "cancel-order-recaptcha", {
      size: "invisible",
    });
    await cancelRecaptchaRef.current.render();
    return cancelRecaptchaRef.current;
  }

  async function sendCancelOtp() {
    setCancelError("");
    setCancelStatus("");
    const phone = cancelPhone.trim();
    if (!phone) {
      setCancelError("Enter phone number.");
      return;
    }

    setCancelOtpSending(true);
    try {
      await setPersistence(auth, inMemoryPersistence);
      const verifier = await ensureCancelRecaptcha();
      if (!verifier) {
        throw new Error("Unable to initialize OTP verification.");
      }
      const e164Phone = normalizePhoneForOtp(phone);
      cancelConfirmationRef.current = await signInWithPhoneNumber(auth, e164Phone, verifier);
      setCancelOtpSent(true);
      setCancelStatus("OTP sent");
    } catch (error: any) {
      setCancelError(error?.message || "Failed to send OTP.");
      if (cancelRecaptchaRef.current) {
        cancelRecaptchaRef.current.clear();
        cancelRecaptchaRef.current = null;
      }
    } finally {
      setCancelOtpSending(false);
    }
  }

  async function verifyCancelOtp() {
    setCancelError("");
    setCancelStatus("");
    if (!cancelConfirmationRef.current) {
      setCancelError("Send OTP first.");
      return;
    }
    if (!cancelOtp.trim()) {
      setCancelError("Enter OTP.");
      return;
    }

    setCancelVerificationLoading(true);
    try {
      const credential = await cancelConfirmationRef.current.confirm(cancelOtp.trim());
      const verifiedPhone = credential.user.phoneNumber || normalizePhoneForOtp(cancelPhone);
      setCancelVerifiedPhone(verifiedPhone);
      setCancelOrders(await fetchOrdersByPhone(cancelPhone));
      setCancelStatus("Phone verified");
    } catch (error: any) {
      setCancelError(error?.message || "Invalid OTP.");
    } finally {
      setCancelVerificationLoading(false);
    }
  }

  async function saveCustomSubArea() {
    setCustomSubAreaError("");
    if (!form.area) {
      setCustomSubAreaError("Select area first.");
      return;
    }
    const nextSubArea = customSubAreaDraft.trim();
    if (!nextSubArea) {
      setCustomSubAreaError("Enter sub area name.");
      return;
    }
    const targetArea = serviceAreas.find((area) => area.name === form.area);
    if (!targetArea) {
      setCustomSubAreaError("Selected area is not available.");
      return;
    }
    const alreadyExists = subAreaOptions.some(
      (subArea) => subArea.toLowerCase() === nextSubArea.toLowerCase()
    );
    setForm((prev) => ({ ...prev, subArea: nextSubArea }));
    setShowCustomSubAreaInput(false);
    setCustomSubAreaDraft("");
    setLocalSubAreasByArea((prev) => ({
      ...prev,
      [form.area]: Array.from(new Set([...(prev[form.area] || []), nextSubArea])).sort((a, b) =>
        a.localeCompare(b)
      ),
    }));
    if (alreadyExists) {
      return;
    }

    setIsSavingCustomSubArea(true);
    try {
      setServiceAreas((prev) =>
        prev.map((area) =>
          area.id === targetArea.id
            ? {
                ...area,
                subAreas: Array.from(
                  new Set([...(area.subAreas || []), nextSubArea])
                ).sort((a, b) => a.localeCompare(b)),
              }
            : area
        )
      );
      await updateDoc(doc(db, "service_areas", targetArea.id), {
        subAreas: arrayUnion(nextSubArea),
        updatedAt: serverTimestamp(),
      });
    } catch (error: any) {
      setCustomSubAreaError(error?.message || "Failed to save sub area.");
    } finally {
      setIsSavingCustomSubArea(false);
    }
  }

  async function cancelCustomerOrder(order: CustomerOrder) {
    setCancelError("");
    setCancelStatus("");
    if (!cancelVerifiedPhone) {
      setCancelError("Verify OTP before cancelling an order.");
      return;
    }
    if (!canCancelOrder(order)) {
      setCancelError("This order can no longer be cancelled.");
      return;
    }
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Are you sure you want to cancel order ${order.orderId}?`)
    ) {
      return;
    }

    setCancelingOrderId(order.id);
    try {
      const allowedPhones = getPhoneVariants(cancelVerifiedPhone);
      const orderPhones = getPhoneVariants(order.phone || "");
      const matchesVerifiedPhone = orderPhones.some((phone) => allowedPhones.includes(phone));
      if (!matchesVerifiedPhone) {
        throw new Error("Verified phone number does not match this order.");
      }

      await runTransaction(db, async (tx) => {
        const orderRef = doc(db, "orders", order.id);
        const orderSnap = await tx.get(orderRef);
        if (!orderSnap.exists()) {
          throw new Error("Order not found.");
        }

        const currentOrder = orderSnap.data() as any;
        if (!(currentOrder.status === "active" || currentOrder.status === "payment_pending")) {
          throw new Error("This order can no longer be cancelled.");
        }

        if (currentOrder.publishedMenuId) {
          const menuRef = doc(db, "published_menus", currentOrder.publishedMenuId);
          const menuSnap = await tx.get(menuRef);
          if (menuSnap.exists()) {
            const menuData = menuSnap.data() as any;
            const remaining = (menuData.remaining || menuData.items || []).map((item: any) => ({
              ...item,
            }));

            (currentOrder.items || []).forEach((orderedItem: any) => {
              const remainingItem = remaining.find(
                (menuItem: any) => menuItem.itemId === orderedItem.itemId || menuItem.name === orderedItem.name
              );
              if (remainingItem) {
                remainingItem.qty = (remainingItem.qty || 0) + (orderedItem.qty || 0);
              }
            });

            tx.update(menuRef, {
              remaining,
              updatedAt: serverTimestamp(),
            });
          }
        }

        tx.update(orderRef, {
          status: "cancelled",
          paymentStatus:
            currentOrder.paymentStatus === "paid" ? "refund_pending" : "cancelled",
          cancelledAt: serverTimestamp(),
          cancelledByPhone: cancelVerifiedPhone,
          updatedAt: serverTimestamp(),
        });
      });

      const refreshedOrders = await fetchOrdersByPhone(cancelPhone);
      setCancelOrders(refreshedOrders);
      setHistoryOrders((prev) =>
        prev.map((item) =>
          item.id === order.id
            ? {
                ...item,
                status: "cancelled",
                paymentStatus: item.paymentStatus === "paid" ? "refund_pending" : "cancelled",
              }
            : item
        )
      );
      setCancelStatus(`Order ${order.orderId} cancelled`);
    } catch (error: any) {
      setCancelError(error?.message || "Failed to cancel order.");
    } finally {
      setCancelingOrderId(null);
    }
  }

  async function placeOrder() {
    setPayError("");
    setPaymentNotice("");
    if (!publishedMenuId) {
      setPayError("No menu is available right now.");
      return;
    }
    const missingFields = getMissingOrderFields();
    if (missingFields.length) {
      const message = `Please fill the following before placing the order:\n\n- ${missingFields.join(
        "\n- "
      )}`;
      setPayError(message);
      window.alert(message);
      return;
    }
    if (deliveryType === "delivery" && !location) {
      setPayError("Please select exact location on map.");
      return;
    }
    const selectedItems = items.filter((item) => item.qty > 0);
    if (!selectedItems.length) {
      setPayError("Please select at least one item.");
      return;
    }
    if (deliveryType === "delivery" && itemsTotal < MIN_HOME_DELIVERY_ORDER) {
      const message = `Minimum order value for home delivery is Rs. ${MIN_HOME_DELIVERY_ORDER}.`;
      setPayError(message);
      window.alert(message);
      return;
    }

    setIsPlacingOrder(true);
    try {
      const menuRef = doc(db, "published_menus", publishedMenuId);
      const orderRef = doc(collection(db, "orders"));
      const generatedDisplayOrderId = await generateUniqueSixDigitOrderId();
        const deliveryAddressText =
        deliveryType === "delivery"
          ? [
              form.addressLine1.trim(),
              form.street.trim(),
              form.subArea.trim(),
              form.area.trim(),
            ]
              .filter(Boolean)
              .join(", ")
          : "";
      let effectiveDeliveryFee = selectedDeliveryFee;
      let effectiveOrderTotal = total;
      const summaryForPayment: PaymentSummary = {
        appOrderId: orderRef.id,
        displayOrderId: generatedDisplayOrderId,
        items: selectedItems.map((item) => ({
          id: item.id,
          name: item.name,
          price: item.price,
          qty: item.qty,
          imageUrl: item.imageUrl || "",
        })),
        itemsTotal,
        deliveryFee: effectiveDeliveryFee,
        total: effectiveOrderTotal,
        deliveryType,
        paymentMethod: "upi",
        location,
        addressText: deliveryAddressText,
      };
      await runTransaction(db, async (tx) => {
        const menuSnap = await tx.get(menuRef);
        if (!menuSnap.exists()) {
          throw new Error("Menu not found.");
        }
        const menuData = menuSnap.data() as any;
        if (menuData.isArchived) {
          throw new Error("Stay tuned for the upcoming menu.");
        }
        if (menuData.ordersStopped) {
          throw new Error("Sold out.");
        }
        const mealKey = getAssignmentMealKey(menuData.mealType || "");
        const mealIsLunch = mealKey === "Lunch";
        effectiveDeliveryFee =
          deliveryType === "delivery" && !mealIsLunch ? Number(selectedAreaConfig?.deliveryFee || 0) : 0;
        effectiveOrderTotal = itemsTotal + effectiveDeliveryFee;
        const remaining = (menuData.remaining || menuData.items || []).map(
          (item: any) => ({ ...item })
        );
        selectedItems.forEach((item) => {
          const remainingItem = remaining.find(
            (rem: any) => rem.itemId === item.id
          );
          if (!remainingItem || remainingItem.active === false) {
            throw new Error(`${item.name} is not available.`);
          }
          if ((remainingItem.qty || 0) < item.qty) {
            throw new Error(`${item.name} is sold out or insufficient.`);
          }
          remainingItem.qty = (remainingItem.qty || 0) - item.qty;
        });

        let assignedAgentId = "";
        let assignedAgentName = "";
        if (deliveryType === "delivery" && form.area) {
          const assignmentRef = doc(db, "area_assignments", form.area);
          const assignmentSnap = await tx.get(assignmentRef);
          if (assignmentSnap.exists()) {
            const assignmentData = assignmentSnap.data() as any;
            const subAreaAgentIds: string[] =
              mealKey
                ? assignmentData.subAreaMealAgentIds?.[mealKey]?.[form.subArea] ||
                  assignmentData.subAreaAgentIds?.[form.subArea] ||
                  []
                : assignmentData.subAreaAgentIds?.[form.subArea] || [];
            const requiresOwnerAssignment =
              Boolean(form.subArea) &&
              !isMappedSubArea(form.area, form.subArea) &&
              subAreaAgentIds.length === 0;
            const agentIds: string[] =
              subAreaAgentIds.length > 0
                ? subAreaAgentIds
                : requiresOwnerAssignment
                  ? []
                  : mealKey
                    ? assignmentData.mealAgentIds?.[mealKey] || assignmentData.agentIds || []
                    : assignmentData.agentIds || [];
            if (agentIds.length > 0) {
              const usesSubAreaPool = subAreaAgentIds.length > 0;
              const lastIndex = usesSubAreaPool
                ? mealKey
                  ? typeof assignmentData.subAreaMealLastIndex?.[mealKey]?.[form.subArea] === "number"
                    ? assignmentData.subAreaMealLastIndex[mealKey][form.subArea]
                    : typeof assignmentData.subAreaLastIndex?.[form.subArea] === "number"
                      ? assignmentData.subAreaLastIndex[form.subArea]
                      : -1
                  : typeof assignmentData.subAreaLastIndex?.[form.subArea] === "number"
                    ? assignmentData.subAreaLastIndex[form.subArea]
                    : -1
                : mealKey
                  ? typeof assignmentData.mealLastIndex?.[mealKey] === "number"
                    ? assignmentData.mealLastIndex[mealKey]
                    : typeof assignmentData.lastIndex === "number"
                      ? assignmentData.lastIndex
                      : -1
                  : typeof assignmentData.lastIndex === "number"
                    ? assignmentData.lastIndex
                  : -1
                ;
              const nextIndex = (lastIndex + 1) % agentIds.length;
              const agentId = agentIds[nextIndex];
              const agentSnap = await tx.get(
                doc(db, "delivery_agents", agentId)
              );
              if (agentSnap.exists()) {
                const agentData = agentSnap.data() as any;
                if (agentData.active !== false) {
                  assignedAgentId = agentId;
                  assignedAgentName = agentData.name || "";
                    tx.update(
                      assignmentRef,
                      usesSubAreaPool
                        ? mealKey
                          ? { [`subAreaMealLastIndex.${mealKey}.${form.subArea}`]: nextIndex }
                          : { [`subAreaLastIndex.${form.subArea}`]: nextIndex }
                        : mealKey
                          ? { [`mealLastIndex.${mealKey}`]: nextIndex }
                          : { lastIndex: nextIndex }
                    );
                }
              }
            }
          }
        }

        tx.set(orderRef, {
          orderId: generatedDisplayOrderId,
          status: "payment_pending",
          paymentStatus: "pending",
          createdAt: serverTimestamp(),
          publishedMenuId,
          publishedDate: menuData.date || "",
          mealType: menuData.mealType || "",
          customerName: form.name.trim(),
          phone: normalizePhoneForOtp(form.phone),
          deliveryType,
          address:
            deliveryType === "delivery"
              ? `${form.addressLine1}, ${form.street}`
              : "",
          area: deliveryType === "delivery" ? form.area : "",
          subArea: deliveryType === "delivery" ? form.subArea : "",
          location: location || null,
          items: selectedItems.map((item) => ({
            name: item.name,
            qty: item.qty,
            price: item.price,
          })),
          itemsTotal,
          deliveryFee: effectiveDeliveryFee,
          total: effectiveOrderTotal,
          assignedAgentId,
          assignedAgentName,
        });
        tx.update(menuRef, { remaining });
      });
      saveLocalCustomerProfile(form.phone, {
        name: form.name.trim(),
        deliveryType,
        addressLine1: deliveryType === "delivery" ? form.addressLine1.trim() : "",
        street: deliveryType === "delivery" ? form.street.trim() : "",
        area: deliveryType === "delivery" ? form.area : "",
        subArea: deliveryType === "delivery" ? form.subArea : "",
        location: deliveryType === "delivery" ? location : null,
      });
      summaryForPayment.deliveryFee = effectiveDeliveryFee;
      summaryForPayment.total = effectiveOrderTotal;
      summaryForPayment.displayOrderId = generatedDisplayOrderId;
      setPaymentSummary(summaryForPayment);
      setStep("payment");
    } catch (err: any) {
      setPayError(err?.message || "Failed to place order.");
    } finally {
      setIsPlacingOrder(false);
    }
  }

  function resetCheckoutState() {
    setItems((prev) => prev.map((item) => ({ ...item, qty: 0 })));
    setForm({
      name: "",
      phone: "",
      addressLine1: "",
      street: "",
      area: "",
      subArea: "",
    });
    setLocation(null);
    setLocLabel("");
    setDeliveryType("");
    setPaymentSummary(null);
    setStep("menu");
  }

  async function startOnlinePayment() {
    setPayError("");
    setPaymentNotice("");
    if (!paymentSummary) {
      setPayError("Order summary is missing.");
      return;
    }

    setIsProcessingPayment(true);
    try {
      if (typeof window !== "undefined") {
        const pendingOrder = {
          appOrderId: paymentSummary.appOrderId,
          displayOrderId: paymentSummary.displayOrderId,
        };
        window.localStorage.setItem(
          pendingPaymentStorageKey,
          JSON.stringify(pendingOrder)
        );
        setPendingPaymentResume(pendingOrder);
      }

      const orderResponse = await fetch("/api/icici/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appOrderId: paymentSummary.appOrderId,
        }),
      });
      const orderPayload = await orderResponse.json();
      if (!orderResponse.ok) {
        throw new Error(orderPayload.error || "Failed to initiate payment.");
      }

      if (!orderPayload.paymentUrl) {
        throw new Error("Payment gateway did not return a redirect URL.");
      }

      window.location.href = orderPayload.paymentUrl;
    } catch (error: any) {
      setPayError(error?.message || "Unable to start payment.");
      setIsProcessingPayment(false);
    }
  }

  async function confirmPayAtOutlet() {
    setPayError("");
    setPaymentNotice("");
    if (!paymentSummary) {
      setPayError("Order summary is missing.");
      return;
    }
    setIsConfirmingOutletOrder(true);
    try {
      const response = await fetch("/api/razorpay/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appOrderId: paymentSummary.appOrderId,
          offline: true,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to confirm order.");
      }
      resetCheckoutState();
      setPaymentSuccessPopup({
        orderId: paymentSummary.displayOrderId,
        message: "Order is placed. Please collect from outlet.",
      });
    } catch (error: any) {
      setPayError(error?.message || "Failed to confirm order.");
    } finally {
      setIsConfirmingOutletOrder(false);
    }
  }

  async function confirmCashOnDelivery() {
    setPayError("");
    setPaymentNotice("");
    if (!paymentSummary) {
      setPayError("Order summary is missing.");
      return;
    }
    setIsConfirmingOutletOrder(true);
    try {
      const response = await fetch("/api/razorpay/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appOrderId: paymentSummary.appOrderId,
          offline: true,
          paymentMethod: "cash_on_delivery",
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to confirm order.");
      }
      resetCheckoutState();
      setPaymentSuccessPopup({
        orderId: paymentSummary.displayOrderId,
        message: "Order is placed. Please pay the bill amount to the delivery agent.",
      });
    } catch (error: any) {
      setPayError(error?.message || "Failed to confirm order.");
    } finally {
      setIsConfirmingOutletOrder(false);
    }
  }

  function setPaymentMethod(method: PaymentSummary["paymentMethod"]) {
    setPaymentSummary((prev) => (prev ? { ...prev, paymentMethod: method } : prev));
  }

  return (
    <main className="container customer-shell">
      <div className="stack customer-shell-stack">
        <div
          className="row customer-header-row"
          style={{ justifyContent: "space-between", alignItems: "center" }}
        >
          <div className="row customer-header-brand">
            <button
              className="btn secondary customer-nav-toggle customer-ghost-btn"
              onClick={() => setCustomerDrawerOpen(true)}
              aria-label="Open customer menu"
            >
              {"\u2630"}
            </button>
            <strong className="customer-header-title">MS KITCHEN</strong>
          </div>
        </div>

        {customerView === "menu" && step === "menu" && (
          <section className="card customer-hero">
            <div className="customer-hero-main">
              <div className="customer-hero-image-wrap">
                <img
                  src="/ms-kitchen-hero.jpg"
                  alt="MS Kitchen"
                  className="customer-hero-image"
                />
              </div>
              <div className="customer-hero-meta">
                <p className="customer-brand-eyebrow">Curated Daily Kitchen</p>
                <div className="customer-hero-meta-row">
                  <div className="customer-hero-chip">
                    <span>Date</span>
                    <strong>
                      {menuDateLabel ? formatDateLabel(menuDateLabel) : "Today"}
                    </strong>
                  </div>
                  <div className="customer-hero-chip">
                    <span>Meal</span>
                    <strong>{menuMealLabel || "Not published"}</strong>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {customerDrawerOpen && (
          <div
            className="owner-nav-drawer"
            onClick={() => setCustomerDrawerOpen(false)}
          >
            <div
              className="owner-nav-panel customer-nav-panel"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="stack">
                <strong>Customer Menu</strong>
                <button
                  className={`btn ${customerView === "menu" ? "" : "secondary"}`}
                  onClick={() => {
                    setCustomerView("menu");
                    setCustomerDrawerOpen(false);
                  }}
                >
                  Menu
                </button>
                <button
                  className={`btn ${
                    customerView === "history" ? "" : "secondary"
                  }`}
                  onClick={() => {
                    setCustomerView("history");
                    setCustomerDrawerOpen(false);
                  }}
                >
                  Order History
                </button>
                <button
                  className={`btn ${
                    customerView === "cancel" ? "" : "secondary"
                  }`}
                  onClick={() => {
                    setCustomerView("cancel");
                    setCustomerDrawerOpen(false);
                  }}
                >
                  Cancel Order
                </button>
                <a
                  className="btn secondary"
                  href="/contact-us"
                >
                  Contact Us
                </a>
                <a className="btn secondary" href="/about-us">
                  About Us
                </a>
                <a className="btn secondary" href="/terms-and-conditions">
                  Terms
                </a>
                <a className="btn secondary" href="/privacy-policy">
                  Privacy
                </a>
                <a
                  className="btn secondary"
                  href="/refund-and-cancellation-policy"
                >
                  Refund Policy
                </a>
              </div>
            </div>
          </div>
        )}

        {isProcessingPayment && (
          <div className="customer-processing-overlay" role="alert" aria-live="assertive">
            <div className="customer-processing-modal">
              <div className="customer-processing-spinner" aria-hidden="true" />
              <strong>Payment in progress</strong>
              <p>
                Please wait while we connect you to the UPI payment page. Do not
                close or refresh this screen.
              </p>
            </div>
          </div>
        )}

        {paymentSuccessPopup && (
          <div className="customer-processing-overlay" role="dialog" aria-modal="true">
            <div className="customer-processing-modal customer-success-modal">
              <div className="customer-success-icon" aria-hidden="true">OK</div>
              <strong>Order placed successfully</strong>
              <p>{paymentSuccessPopup.message}</p>
              {paymentSuccessPopup.orderId && (
                <div className="customer-success-orderid">
                  Order ID: <strong>{paymentSuccessPopup.orderId}</strong>
                </div>
              )}
              <button
                className="btn customer-primary-btn"
                onClick={() => setPaymentSuccessPopup(null)}
              >
                OK
              </button>
            </div>
          </div>
        )}

        {!isPrefillingCustomer && customerPrefillPopup && (
          <div className="customer-prefill-toast" role="status" aria-live="polite">
            {customerPrefillPopup}
          </div>
        )}

        {customerView === "history" && (
          <div className="card stack customer-panel">
            <h2>Order History</h2>
            <div className="field">
              <label>Mobile Number</label>
              <div className="row">
                <input
                  className="input"
                  placeholder="Enter phone number"
                  value={historyPhone}
                  onChange={(e) => setHistoryPhone(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button className="btn customer-primary-btn" onClick={loadOrderHistory}>
                  Search
                </button>
              </div>
            </div>
            {historyLoading && <p>Loading orders...</p>}
            {historyError && <small style={{ color: "crimson" }}>{historyError}</small>}
            {!historyLoading &&
              historySearched &&
              !historyError &&
              historyOrders.length === 0 && (
              <p>No orders found for this phone number.</p>
            )}
            <div className="stack">
              {historyOrders.map((order) => (
                <div key={order.id} className="list-card stack customer-order-card customer-history-card">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <strong>{order.orderId}</strong>
                    <span className="badge">{order.status || "unknown"}</span>
                  </div>
                  <div style={{ color: "var(--muted)" }}>
                    {order.publishedDate
                      ? `${formatDateLabel(order.publishedDate)}${
                          order.mealType ? ` - ${order.mealType}` : ""
                        }`
                      : formatDateTimeFromTs(order.createdAt)}
                  </div>
                  <div>
                    {order.items.map((it, idx) => (
                      <div key={`${order.id}-${idx}`}>
                        {it.name} x{it.qty}
                      </div>
                    ))}
                  </div>
                  <div>Total: Rs. {order.total || 0}</div>
                  <div>
                    Delivery:{" "}
                    {order.deliveryType === "delivery" ? "Home Delivery" : "Self Pickup"}
                  </div>
                  {order.deliveryType === "delivery" && (
                    <div>
                      Address: {order.address || "-"}
                      {order.subArea ? `, ${order.subArea}` : ""}
                      {order.area ? `, ${order.area}` : ""}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {customerView === "cancel" && (
          <div className="card stack customer-panel">
            <h2>Cancel Order</h2>
            <div className="field">
              <label>Mobile Number</label>
              <div className="row">
                <input
                  className="input"
                  placeholder="Enter phone number"
                  value={cancelPhone}
                  onChange={(e) => setCancelPhone(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn customer-primary-btn"
                  onClick={sendCancelOtp}
                  disabled={cancelOtpSending}
                >
                  {cancelOtpSending ? "Sending..." : "Send OTP"}
                </button>
              </div>
            </div>
            {cancelOtpSent && (
              <div className="field">
                <label>OTP</label>
                <div className="row">
                  <input
                    className="input"
                    placeholder="Enter OTP"
                    value={cancelOtp}
                    onChange={(e) => setCancelOtp(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn customer-primary-btn"
                    onClick={verifyCancelOtp}
                    disabled={cancelVerificationLoading}
                  >
                    {cancelVerificationLoading ? "Verifying..." : "Verify OTP"}
                  </button>
                </div>
              </div>
            )}
            <div id="cancel-order-recaptcha" />
            {cancelStatus && <small className="customer-success-text">{cancelStatus}</small>}
            {cancelError && <small className="customer-error-text">{cancelError}</small>}
            {cancelVerifiedPhone && cancelOrders.length === 0 && (
              <p>No orders found for this phone number.</p>
            )}
            {cancelVerifiedPhone && cancelOrders.length > 0 && (
              <div className="stack">
                {cancelOrders.map((order) => (
                  <div key={order.id} className="list-card stack customer-order-card customer-history-card">
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <strong>{order.orderId}</strong>
                      <span className="badge">{order.status || "unknown"}</span>
                    </div>
                    <div style={{ color: "var(--muted)" }}>
                      {order.publishedDate
                        ? `${formatDateLabel(order.publishedDate)}${
                            order.mealType ? ` - ${order.mealType}` : ""
                          }`
                        : formatDateTimeFromTs(order.createdAt)}
                    </div>
                    <div>
                      {order.items.map((it, idx) => (
                        <div key={`${order.id}-${idx}`}>
                          {it.name} x{it.qty}
                        </div>
                      ))}
                    </div>
                    <div>Total: Rs. {order.total || 0}</div>
                    <div>
                      Payment:{" "}
                      {order.paymentMethod === "cash_on_delivery"
                        ? "Cash on Delivery"
                        : order.deliveryType === "pickup" && order.paymentStatus === "paid"
                        ? "UPI Paid"
                        : order.paymentMethod === "pay_at_outlet"
                        ? "Legacy Pay at Outlet"
                        : order.paymentStatus === "paid"
                        ? "UPI Paid"
                        : order.paymentStatus || "-"}
                    </div>
                    {canCancelOrder(order) ? (
                      <button
                        className="btn customer-primary-btn"
                        onClick={() => cancelCustomerOrder(order)}
                        disabled={cancelingOrderId === order.id}
                      >
                        {cancelingOrderId === order.id ? "Cancelling..." : "Cancel Order"}
                      </button>
                    ) : (
                      <small className="payments-subtext">Cancellation not available for this order.</small>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {customerView === "menu" && step === "menu" && (
          <div className="card stack customer-panel customer-menu-panel">
            {paymentNotice && <small className="customer-success-text">{paymentNotice}</small>}
            {payError && <small className="customer-error-text">{payError}</small>}
            {pendingPaymentResume && (
              <div className="payment-action-box">
                <div className="payment-action-copy">
                  <strong>Pending payment detected</strong>
                  <p>
                    If your UPI app did not switch back automatically, reopen this page
                    and verify the payment for order {pendingPaymentResume.displayOrderId}.
                  </p>
                </div>
                <button
                  className="btn customer-primary-btn"
                  onClick={() => checkPendingPaymentStatus()}
                  disabled={isCheckingPendingPayment}
                >
                  {isCheckingPendingPayment ? "Checking..." : "Check Payment Status"}
                </button>
              </div>
            )}
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2>Menu</h2>
              <span className="customer-section-meta">
                {menuAvailability === "available" && menuDateLabel
                  ? `${formatDateLabel(menuDateLabel)} ${
                      menuMealLabel ? `- ${menuMealLabel}` : ""
                    }`
                  : menuAvailability === "archived"
                  ? "Stay tuned for the upcoming menu"
                  : menuAvailability === "sold_out"
                  ? "Sold out"
                  : "No menu published"}
              </span>
            </div>
            {menuAvailability === "available" ? (
              <>
                <div className="product-grid">
                  {items.map((item) => (
                    <div key={item.id} className="product-card customer-product-card">
                      <div className="product-image-wrap">
                        {item.remaining === 0 && (
                          <span className="product-badge">Sold Out</span>
                        )}
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt={item.name}
                            className="product-image"
                          />
                        ) : (
                          <div className="product-image product-image-placeholder">
                            No image
                          </div>
                        )}
                      </div>

                      <div className="product-content">
                        <div className="product-title">{item.name}</div>
                        {item.description && (
                          <>
                            <div
                              className={`product-desc ${
                                expandedDescriptions.includes(item.id) ? "expanded" : "collapsed"
                              }`}
                            >
                              {item.description}
                            </div>
                            {item.description.length > 70 && (
                              <button
                                type="button"
                                className="customer-desc-toggle"
                                onClick={() => toggleDescription(item.id)}
                              >
                                {expandedDescriptions.includes(item.id) ? "Show less" : "Read more"}
                              </button>
                            )}
                          </>
                        )}
                        <div className="product-price">Rs. {item.price}</div>
                      </div>

                      <div className="product-qty-row">
                        <button
                          className="btn secondary qty-btn customer-ghost-btn"
                          onClick={() => updateQty(item.id, -1)}
                          disabled={item.remaining === 0}
                        >
                          -
                        </button>
                        <div className="qty-value">{item.qty}</div>
                        <button
                          className="btn qty-btn customer-primary-btn"
                          onClick={() => updateQty(item.id, 1)}
                          disabled={item.remaining === 0}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="row customer-menu-footer">
                  <strong className="customer-menu-total">Total: Rs. {total}</strong>
                  <button
                    className="btn customer-primary-btn"
                    disabled={!hasItems}
                    onClick={() => {
                      setPayError("");
                      setPaymentNotice("");
                      setStep("details");
                    }}
                  >
                    Continue
                  </button>
                </div>
              </>
            ) : (
              <div className="payment-action-box">
                <div className="payment-action-copy">
                  <strong>
                    {menuAvailability === "archived"
                      ? "Stay tuned for the upcoming menu"
                      : menuAvailability === "sold_out"
                      ? "Sold out"
                      : "No menu published"}
                  </strong>
                  <p>
                    {menuAvailability === "archived"
                      ? "The current menu has been archived. Please check back for the next update."
                      : menuAvailability === "sold_out"
                      ? "Orders are currently closed for this menu."
                      : "The next menu will be published here once it is ready."}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {customerView === "menu" && step === "details" && (
          <div className="card stack customer-panel customer-details-panel">
            <h2>Customer Details</h2>
            {isPrefillingCustomer && (
              <small className="customer-success-text">
                Checking saved details on this browser...
              </small>
            )}
            <div className="field">
              <label>Name</label>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Mobile Number</label>
              <input
                className="input"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Delivery Type</label>
              <div className="row">
                <button
                  className={`btn customer-toggle-btn ${
                    deliveryType === "delivery" ? "" : "secondary"
                  }`}
                  onClick={() => setDeliveryType("delivery")}
                >
                  Home Delivery
                </button>
                <button
                  className={`btn customer-toggle-btn ${
                    deliveryType === "pickup" ? "" : "secondary"
                  }`}
                  onClick={() => {
                    setDeliveryType("pickup");
                    setForm((prev) => ({ ...prev, subArea: "" }));
                  }}
                >
                  Self Pickup
                </button>
              </div>
            </div>

            {deliveryType === "delivery" && (
              <>
                <div className="field">
                  <label>Door No / Apartment / House Name</label>
                  <input
                    className="input"
                    value={form.addressLine1}
                    onChange={(e) =>
                      setForm({ ...form, addressLine1: e.target.value })
                    }
                  />
                </div>
                <div className="field">
                  <label>Street</label>
                  <input
                    className="input"
                    value={form.street}
                    onChange={(e) =>
                      setForm({ ...form, street: e.target.value })
                    }
                  />
                </div>
                <div className="field">
                  <label>Area</label>
                  <select
                    className="select"
                    value={form.area}
                    onChange={(e) =>
                      setForm({ ...form, area: e.target.value, subArea: "" })
                    }
                  >
                    <option value="">Select area</option>
                    {serviceAreas.map((area) => (
                      <option key={area.id} value={area.name}>
                        {area.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Sub Area</label>
                  <div className="row">
                    <select
                      className="select"
                      value={form.subArea}
                      onChange={(e) => setForm({ ...form, subArea: e.target.value })}
                      disabled={!form.area}
                      style={{ flex: 1 }}
                    >
                      <option value="">{form.area ? "Select sub area" : "Select area first"}</option>
                      {subAreaOptions.map((subArea) => (
                        <option key={subArea} value={subArea}>
                          {subArea}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn secondary btn-compact"
                      disabled={!form.area}
                      onClick={() => {
                        setShowCustomSubAreaInput((prev) => !prev);
                        setCustomSubAreaError("");
                      }}
                    >
                      Add
                    </button>
                  </div>
                  <small className="payments-subtext">
                    Use sub area to help route your order more accurately.
                  </small>
                  {showCustomSubAreaInput && (
                    <div className="row" style={{ marginTop: 8 }}>
                      <input
                        className="input"
                        placeholder="Enter your sub area"
                        value={customSubAreaDraft}
                        onChange={(e) => setCustomSubAreaDraft(e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <button
                        type="button"
                        className="btn customer-primary-btn btn-compact"
                        onClick={saveCustomSubArea}
                        disabled={isSavingCustomSubArea}
                      >
                        {isSavingCustomSubArea ? "Saving..." : "Save"}
                      </button>
                    </div>
                  )}
                  {customSubAreaError && (
                    <small className="customer-error-text">{customSubAreaError}</small>
                  )}
                </div>

                <div className="field">
                  <label>Exact Location (required)</label>
                  {locLabel && <small>{locLabel}</small>}
                  {location && (
                    <small>
                      {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
                    </small>
                  )}
                  {locError && (
                    <small style={{ color: "crimson" }}>{locError}</small>
                  )}
                </div>

                {mapsKey && (
                  <div className="card stack customer-map-card" style={{ marginTop: 12 }}>
                    <div
                      className="row"
                      style={{ justifyContent: "space-between" }}
                    >
                      <strong>Select location on map</strong>
                    </div>
                    <LoadScript googleMapsApiKey={mapsKey} libraries={["places"]}>
                      <Autocomplete
                        onLoad={onAutocompleteLoad}
                        onPlaceChanged={onPlaceChanged}
                      >
                        <div className="row" style={{ marginBottom: 12 }}>
                          <input
                            className="input"
                            placeholder="Search apartment/landmark"
                            style={{ flex: 1 }}
                          />
                          <button
                            type="button"
                            className="btn secondary customer-ghost-btn"
                            onClick={useCurrentLocation}
                          >
                            Use current location
                          </button>
                        </div>
                      </Autocomplete>
                      <GoogleMap
                        mapContainerStyle={mapContainerStyle}
                        center={location ?? defaultCenter}
                        zoom={location ? 16 : 13}
                        onClick={(e) => {
                          if (!e.latLng) return;
                          setLocation({
                            lat: e.latLng.lat(),
                            lng: e.latLng.lng(),
                          });
                          setLocLabel("Location selected on map");
                        }}
                      >
                        {location && <Marker position={location} />}
                      </GoogleMap>
                    </LoadScript>
                  </div>
                )}
              </>
            )}

            <div className="row">
              <button className="btn secondary customer-ghost-btn" onClick={() => setStep("menu")}>
                Back
              </button>
              <button
                className="btn customer-primary-btn"
                disabled={isPlacingOrder}
                onClick={placeOrder}
              >
                {isPlacingOrder ? "Checking details..." : "Proceed and Pay"}
              </button>
            </div>
            {payError && <small className="customer-error-text">{payError}</small>}
          </div>
        )}

        {customerView === "menu" && step === "payment" && (
          <div className="card payment-card customer-panel">
            <div className="payment-card-header">
              <div>
                <p className="payment-eyebrow">Secure Checkout</p>
                <h2>Payment</h2>
              </div>
              <span className="badge">Final Step</span>
            </div>

            <div className="payment-summary-box">
              <div className="payment-summary-head">
                <div className="payment-summary-title-block">
                  <strong>Order Summary</strong>
                  <span>Review your items and pricing before payment</span>
                </div>
                <span className="payment-summary-count">
                  {(paymentSummary?.items || []).length} item(s)
                </span>
              </div>

              <div className="payment-items">
                <div className="payment-items-head">
                  <span>Item</span>
                  <span>Pricing</span>
                </div>
                {(paymentSummary?.items || []).map((item) => (
                  <div key={item.id} className="payment-item-row">
                    <div className="payment-item-copy">
                      <div className="payment-item-visual">
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt={item.name}
                            className="payment-item-thumb"
                          />
                        ) : (
                          <div className="payment-item-thumb payment-item-thumb-fallback">
                            {item.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="payment-item-text">
                          <div className="payment-item-name">{item.name}</div>
                          <div className="payment-item-qty">Quantity: {item.qty}</div>
                        </div>
                      </div>
                    </div>
                    <div className="payment-item-pricing">
                      <span className="payment-item-unit-price">
                        Rs. {item.price} each
                      </span>
                      <strong className="payment-item-price">
                        Rs. {item.price * item.qty}
                      </strong>
                    </div>
                  </div>
                ))}
              </div>

              <div className="payment-meta">
                <div className="payment-meta-compact">
                  <div className="payment-meta-compact-item">
                    <span>Items Total</span>
                    <strong>Rs. {paymentSummary?.itemsTotal ?? 0}</strong>
                  </div>
                  <div className="payment-meta-compact-item">
                    <span>Delivery Charge</span>
                    <strong>
                      {paymentSummary?.deliveryType === "delivery" && isLunchMenu
                        ? "Not applicable for lunch"
                        : paymentSummary?.deliveryFee
                        ? `Rs. ${paymentSummary.deliveryFee}`
                        : "Included"}
                    </strong>
                  </div>
                  <div className="payment-meta-compact-item">
                    <span>Delivery</span>
                    <strong>
                      {(
                        paymentSummary?.deliveryType === "delivery"
                          ? "Home Delivery"
                          : paymentSummary?.deliveryType === "pickup"
                          ? "Self Pickup"
                          : ""
                      ) || "-"}
                    </strong>
                  </div>
                </div>
                <div className="payment-meta-row payment-total-row">
                  <span>Total</span>
                  <strong>Rs. {paymentSummary?.total ?? 0}</strong>
                </div>
                {(paymentSummary?.addressText || paymentSummary?.location) && (
                  <div className="payment-location-box">
                    <span className="payment-location-label">Delivery Address</span>
                    <span className="payment-location-value">
                      {paymentSummary?.addressText ||
                        `${paymentSummary?.location?.lat.toFixed(5)}, ${paymentSummary?.location?.lng.toFixed(5)}`}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="payment-action-box">
              <div className="payment-action-copy">
                <strong>
                  {paymentSummary?.deliveryType === "pickup"
                    ? "Proceed to payment"
                    : paymentSummary?.paymentMethod === "cash_on_delivery"
                    ? "Cash on delivery"
                    : "Proceed to payment"}
                </strong>
                <p>
                  {paymentSummary?.deliveryType === "pickup"
                    ? "Self pickup orders must be paid online before collecting from the store."
                    : paymentSummary?.paymentMethod === "cash_on_delivery"
                    ? "Pay the bill amount directly to the delivery agent."
                    : "Complete payment to confirm this order."}
                </p>
              </div>
            </div>
            {paymentSummary?.deliveryType === "delivery" ? (
              <div className="row payment-button-row">
                <button
                  className={`btn customer-toggle-btn ${
                    paymentSummary?.paymentMethod === "upi" ? "" : "secondary"
                  }`}
                  onClick={() => setPaymentMethod("upi")}
                  disabled={isProcessingPayment || isConfirmingOutletOrder}
                >
                  UPI
                </button>
                <button
                  className={`btn customer-toggle-btn ${
                    paymentSummary?.paymentMethod === "cash_on_delivery" ? "" : "secondary"
                  }`}
                  onClick={() => setPaymentMethod("cash_on_delivery")}
                  disabled={isProcessingPayment || isConfirmingOutletOrder}
                >
                  Cash on Delivery
                </button>
              </div>
            ) : null}
            {paymentSummary?.paymentMethod === "upi" && (
                <button
                  className="btn payment-primary-btn customer-primary-btn"
                  onClick={startOnlinePayment}
                  disabled={isProcessingPayment}
                >
                  Pay using UPI
                </button>
              )}
            {paymentSummary?.deliveryType === "delivery" &&
              paymentSummary?.paymentMethod === "cash_on_delivery" && (
                <button
                  className="btn payment-primary-btn customer-primary-btn"
                  onClick={confirmCashOnDelivery}
                  disabled={isConfirmingOutletOrder}
                >
                  {isConfirmingOutletOrder ? "Placing order..." : "Cash on Delivery"}
                </button>
              )}
            {isProcessingPayment && (
              <p className="payment-status-text">Redirecting to ICICI payment gateway...</p>
            )}
            {!isProcessingPayment &&
              paymentSummary?.deliveryType === "delivery" &&
              paymentSummary?.paymentMethod === "upi" && (
              <p className="payment-status-text">
                You will be redirected to ICICI to complete payment securely.
              </p>
            )}
            {paymentSummary?.deliveryType === "delivery" &&
              paymentSummary?.paymentMethod === "cash_on_delivery" && (
              <p className="payment-status-text">
                Pay the full bill amount to the delivery agent when your order arrives.
              </p>
            )}
            {paymentSummary?.deliveryType === "delivery" &&
              paymentSummary?.paymentMethod === "upi" && (
              <p className="payment-status-text">
                If Google Pay does not return to the browser automatically, reopen this page
                and use the payment status check.
              </p>
            )}
          </div>
        )}

      </div>
    </main>
  );
}

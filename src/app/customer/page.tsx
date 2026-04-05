"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Autocomplete,
  GoogleMap,
  LoadScript,
  Marker,
} from "@react-google-maps/api";
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";

import { db } from "@/lib/firebase";

type CartItem = {
  id: string;
  name: string;
  price: number;
  qty: number;
  imageUrl?: string;
};

type PaymentSummary = {
  appOrderId: string;
  displayOrderId: string;
  items: { id: string; name: string; price: number; qty: number }[];
  total: number;
  deliveryType: "delivery" | "pickup" | "";
  location: { lat: number; lng: number } | null;
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
  total: number;
  publishedDate: string;
  mealType: string;
  createdAt: any;
  items: { name: string; qty: number; price?: number }[];
};

const mapContainerStyle = { width: "100%", height: "320px" };
const defaultCenter = { lat: 12.9716, lng: 80.2214 };
const pendingPaymentStorageKey = "msk_pending_payment";

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

export default function CustomerPage() {
  const [items, setItems] = useState<
    (CartItem & { description: string; remaining: number })[]
  >([]);
  const [serviceAreas, setServiceAreas] = useState<string[]>([]);
  const [menuDateLabel, setMenuDateLabel] = useState("");
  const [menuMealLabel, setMenuMealLabel] = useState("");
  const [publishedMenuId, setPublishedMenuId] = useState<string | null>(null);
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
  });
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [locLabel, setLocLabel] = useState("");
  const [locError, setLocError] = useState("");
  const [payError, setPayError] = useState("");
  const [paymentNotice, setPaymentNotice] = useState("");
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [paymentSummary, setPaymentSummary] = useState<PaymentSummary | null>(
    null
  );
  const [customerDrawerOpen, setCustomerDrawerOpen] = useState(false);
  const [customerView, setCustomerView] = useState<"menu" | "history">("menu");
  const [historyPhone, setHistoryPhone] = useState("");
  const [historyOrders, setHistoryOrders] = useState<CustomerOrder[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historySearched, setHistorySearched] = useState(false);
  const [customerPrefillNotice, setCustomerPrefillNotice] = useState("");
  const [isPrefillingCustomer, setIsPrefillingCustomer] = useState(false);
  const [pendingPaymentResume, setPendingPaymentResume] = useState<{
    appOrderId: string;
    displayOrderId: string;
  } | null>(null);
  const [isCheckingPendingPayment, setIsCheckingPendingPayment] = useState(false);
  const lastPrefilledPhoneRef = useRef("");

  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  function clearPendingPaymentResume() {
    setPendingPaymentResume(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(pendingPaymentStorageKey);
    }
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

  async function findLatestOrderByPhone(rawPhone: string) {
    const variants = getPhoneVariants(rawPhone);
    const results = new Map<string, CustomerOrder & { location?: { lat: number; lng: number } | null }>();

    for (const phoneVariant of variants) {
      const snap = await getDocs(
        query(collection(db, "orders"), where("phone", "==", phoneVariant))
      );
      snap.docs.forEach((docSnap) => {
        const data = docSnap.data() as any;
        results.set(docSnap.id, {
          id: docSnap.id,
          orderId: data.orderId || docSnap.id,
          customerName: data.customerName || "",
          phone: data.phone || "",
          status: data.status || "",
          deliveryType: data.deliveryType || "",
          address: data.address || "",
          area: data.area || "",
          total: Number(data.total || 0),
          publishedDate: data.publishedDate || "",
          mealType: data.mealType || "",
          createdAt: data.createdAt || null,
          items: Array.isArray(data.items) ? data.items : [],
          location: data.location || null,
        });
      });
    }

    return Array.from(results.values()).sort((a, b) => {
      const aSec = a.createdAt?.seconds || 0;
      const bSec = b.createdAt?.seconds || 0;
      return bSec - aSec;
    })[0] || null;
  }

  function splitSavedAddress(address: string) {
    const [line1, ...rest] = String(address || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

    return {
      addressLine1: line1 || "",
      street: rest.join(", "),
    };
  }

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
        return;
      }
      let docSnap = snap.docs[0];
      let data = docSnap.data() as any;
      if (data.isArchived) {
        const next = snap.docs.find((doc) => !(doc.data() as any).isArchived);
        if (!next) {
          setItems([]);
          setMenuDateLabel("");
          setMenuMealLabel("");
          setPublishedMenuId(null);
          return;
        }
        docSnap = next;
        data = docSnap.data() as any;
      }
      setPublishedMenuId(docSnap.id);
      setMenuDateLabel(data.date || "");
      setMenuMealLabel(data.mealType || "");
      const remainingMap = new Map(
        (data.remaining || data.items || []).map((item: any) => [
          item.itemId,
          data.ordersStopped ? 0 : item.qty ?? 0,
        ])
      );
      const menuItems = (data.items || []).map((item: any) => ({
        id: item.itemId,
        name: item.name,
        price: item.price,
        qty: 0,
        description: item.description || "",
        imageUrl: item.imageUrl || "",
        remaining: remainingMap.get(item.itemId) ?? 0,
      }));
      setItems(menuItems);
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
      failed: orderId
        ? `Payment failed for order ${orderId}. Please try again.`
        : "Payment failed. Please try again.",
    };

    const nextMessage = messages[paymentState] || "Payment status updated.";
    setPaymentNotice(nextMessage);
    setPayError(paymentState === "failed" ? messages.failed : "");
    resetCheckoutState();
    setCustomerView("menu");
    clearPendingPaymentResume();

    if (paymentState === "success") {
      window.alert(nextMessage);
    }

    url.searchParams.delete("payment");
    url.searchParams.delete("orderId");
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
        if (!opts?.silent) {
          window.alert(nextMessage);
        }
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
    if (step !== "details") {
      return;
    }

    const trimmedPhone = form.phone.trim();
    const digits = trimmedPhone.replace(/\D/g, "");

    if (digits.length < 10) {
      setCustomerPrefillNotice("");
      lastPrefilledPhoneRef.current = "";
      return;
    }

    if (lastPrefilledPhoneRef.current === trimmedPhone) {
      return;
    }

    const timer = window.setTimeout(async () => {
      setIsPrefillingCustomer(true);
      try {
        const latestOrder = await findLatestOrderByPhone(trimmedPhone);
        lastPrefilledPhoneRef.current = trimmedPhone;

        if (!latestOrder) {
          setCustomerPrefillNotice("");
          return;
        }

        const savedAddress = splitSavedAddress(latestOrder.address || "");
        setForm((prev) => ({
          ...prev,
          name: prev.name.trim() || latestOrder.customerName || "",
          addressLine1:
            latestOrder.deliveryType === "delivery"
              ? savedAddress.addressLine1 || prev.addressLine1
              : prev.addressLine1,
          street:
            latestOrder.deliveryType === "delivery"
              ? savedAddress.street || prev.street
              : prev.street,
          area:
            latestOrder.deliveryType === "delivery"
              ? latestOrder.area || prev.area
              : prev.area,
        }));

        if (latestOrder.deliveryType === "delivery") {
          setDeliveryType("delivery");
          if (latestOrder.location?.lat && latestOrder.location?.lng) {
            setLocation({
              lat: Number(latestOrder.location.lat),
              lng: Number(latestOrder.location.lng),
            });
            setLocLabel("Saved location loaded from your last order");
            setLocError("");
          }
        } else if (latestOrder.deliveryType === "pickup" && !deliveryType) {
          setDeliveryType("pickup");
        }

        setCustomerPrefillNotice(
          "We found your previous order details. You can edit any field before placing this order."
        );
      } catch {
        setCustomerPrefillNotice("");
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
        setServiceAreas(snap.docs.map((docSnap) => docSnap.data().name as string));
      }
    );
    return () => unsub();
  }, []);

  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.price * item.qty, 0),
    [items]
  );

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
      const latestFirst = await Promise.all(
        getPhoneVariants(raw).map(async (phoneVariant) => {
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
              total: Number(data.total || 0),
              publishedDate: data.publishedDate || "",
              mealType: data.mealType || "",
              createdAt: data.createdAt || null,
              items: Array.isArray(data.items) ? data.items : [],
            } as CustomerOrder;
          });
        })
      );

      const merged = new Map<string, CustomerOrder>();
      latestFirst.flat().forEach((order) => merged.set(order.id, order));
      setHistoryOrders(
        Array.from(merged.values()).sort((a, b) => {
          const aSec = a.createdAt?.seconds || 0;
          const bSec = b.createdAt?.seconds || 0;
          return bSec - aSec;
        })
      );
    } catch (err: any) {
      setHistoryError(err?.message || "Failed to load order history.");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function placeOrder() {
    setPayError("");
    setPaymentNotice("");
    if (!publishedMenuId) {
      setPayError("No menu is published yet.");
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

    setIsPlacingOrder(true);
    try {
      const menuRef = doc(db, "published_menus", publishedMenuId);
      const orderRef = doc(collection(db, "orders"));
      const generatedDisplayOrderId = await generateUniqueSixDigitOrderId();
      const summaryForPayment: PaymentSummary = {
        appOrderId: orderRef.id,
        displayOrderId: generatedDisplayOrderId,
        items: selectedItems.map((item) => ({
          id: item.id,
          name: item.name,
          price: item.price,
          qty: item.qty,
        })),
        total,
        deliveryType,
        location,
      };
      await runTransaction(db, async (tx) => {
        const menuSnap = await tx.get(menuRef);
        if (!menuSnap.exists()) {
          throw new Error("Menu not found.");
        }
        const menuData = menuSnap.data() as any;
        if (menuData.isArchived || menuData.ordersStopped) {
          throw new Error("Orders are closed for this menu.");
        }
        const remaining = (menuData.remaining || menuData.items || []).map(
          (item: any) => ({ ...item })
        );
        selectedItems.forEach((item) => {
          const remainingItem = remaining.find(
            (rem: any) => rem.itemId === item.id
          );
          if (!remainingItem) {
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
            const agentIds: string[] = assignmentData.agentIds || [];
            if (agentIds.length > 0) {
              const lastIndex =
                typeof assignmentData.lastIndex === "number"
                  ? assignmentData.lastIndex
                  : -1;
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
                  tx.update(assignmentRef, { lastIndex: nextIndex });
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
          phone: form.phone.trim(),
          deliveryType,
          address:
            deliveryType === "delivery"
              ? `${form.addressLine1}, ${form.street}`
              : "",
          area: deliveryType === "delivery" ? form.area : "",
          location: location || null,
          items: selectedItems.map((item) => ({
            name: item.name,
            qty: item.qty,
            price: item.price,
          })),
          total,
          assignedAgentId,
          assignedAgentName,
        });
        tx.update(menuRef, { remaining });
      });
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
        body: JSON.stringify({ appOrderId: paymentSummary.appOrderId }),
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
    setIsProcessingPayment(true);
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
      alert(`Order placed. Order ID: ${paymentSummary.displayOrderId}`);
    } catch (error: any) {
      setPayError(error?.message || "Failed to confirm order.");
    } finally {
      setIsProcessingPayment(false);
    }
  }

  return (
    <main className="container customer-shell">
      <div className="stack customer-shell-stack">
        <div
          className="row customer-header-row"
          style={{ justifyContent: "space-between", alignItems: "center" }}
        >
          <div className="row" style={{ alignItems: "center" }}>
            <button
              className="btn secondary customer-nav-toggle customer-ghost-btn"
              onClick={() => setCustomerDrawerOpen(true)}
              aria-label="Open customer menu"
            >
              {"\u2630"}
            </button>
            <div className="customer-brand-block">
              <p className="customer-brand-eyebrow">Curated Daily Kitchen</p>
              <h1>MS Kitchen Menu</h1>
            </div>
          </div>
        </div>

        {customerView === "menu" && (
          <section className="card customer-hero">
            <div className="customer-hero-image-wrap">
              <img
                src="/ms-kitchen-hero.jpg"
                alt="MS Kitchen"
                className="customer-hero-image"
              />
            </div>
            <div className="customer-hero-stats">
              <div className="customer-stat-card">
                <span>Date</span>
                <strong>
                  {menuDateLabel ? formatDateLabel(menuDateLabel) : "Today"}
                </strong>
              </div>
              <div className="customer-stat-card">
                <span>Meal Type</span>
                <strong>{menuMealLabel || "Not published"}</strong>
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
                  <div>Total: INR {order.total || 0}</div>
                  <div>
                    Delivery:{" "}
                    {order.deliveryType === "delivery" ? "Home Delivery" : "Self Pickup"}
                  </div>
                  {order.deliveryType === "delivery" && (
                    <div>
                      Address: {order.address || "-"}
                      {order.area ? `, ${order.area}` : ""}
                    </div>
                  )}
                </div>
              ))}
            </div>
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
                {menuDateLabel
                  ? `${formatDateLabel(menuDateLabel)} ${
                      menuMealLabel ? `- ${menuMealLabel}` : ""
                    }`
                  : "No menu published"}
              </span>
            </div>
            <div className="product-grid">
              {items.map((item) => (
                <div key={item.id} className="product-card customer-product-card">
                  <div className="product-image-wrap">
                    {item.remaining === 0 && (
                      <span className="product-badge">Sold Out</span>
                    )}
                    {item.imageUrl ? (
                      // Using plain img keeps setup simple while owner stores image URLs.
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
                      <div className="product-desc">{item.description}</div>
                    )}
                    <div className="product-price">INR {item.price}</div>
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
            <div className="row">
              <strong>Total: INR {total}</strong>
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
          </div>
        )}

        {customerView === "menu" && step === "details" && (
          <div className="card stack customer-panel customer-details-panel">
            <h2>Customer Details</h2>
            {isPrefillingCustomer && (
              <small className="customer-success-text">
                Checking your previous order details...
              </small>
            )}
            {!isPrefillingCustomer && customerPrefillNotice && (
              <small className="customer-success-text">{customerPrefillNotice}</small>
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
                  onClick={() => setDeliveryType("pickup")}
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
                    onChange={(e) => setForm({ ...form, area: e.target.value })}
                  >
                    <option value="">Select area</option>
                    {serviceAreas.map((area) => (
                      <option key={area} value={area}>
                        {area}
                      </option>
                    ))}
                  </select>
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
                <strong>Order Summary</strong>
                <span>{(paymentSummary?.items || []).length} item(s)</span>
              </div>

              <div className="payment-items">
                {(paymentSummary?.items || []).map((item) => (
                  <div key={item.id} className="payment-item-row">
                    <div className="payment-item-copy">
                      <div className="payment-item-name">{item.name}</div>
                      <div className="payment-item-qty">Qty {item.qty}</div>
                    </div>
                    <div className="payment-item-pricing">
                      <span className="payment-item-unit-price">INR {item.price}</span>
                      <strong className="payment-item-price">
                        INR {item.price * item.qty}
                      </strong>
                    </div>
                  </div>
                ))}
              </div>

              <div className="payment-meta">
                <div className="payment-meta-row">
                  <span>Total</span>
                  <strong>INR {paymentSummary?.total ?? 0}</strong>
                </div>
                <div className="payment-meta-row">
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
                {paymentSummary?.location && (
                  <div className="payment-location-box">
                    <span className="payment-location-label">Exact Location</span>
                    <span className="payment-location-value">
                      {paymentSummary.location.lat.toFixed(5)},{" "}
                      {paymentSummary.location.lng.toFixed(5)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="payment-action-box">
              <div className="payment-action-copy">
                <strong>Proceed to payment</strong>
                <p>Complete payment to confirm this order.</p>
              </div>
            </div>

            {paymentSummary?.deliveryType === "pickup" ? (
              <div className="row payment-button-row">
                <button
                  className="btn customer-primary-btn"
                  onClick={startOnlinePayment}
                  disabled={isProcessingPayment}
                >
                  Pay using UPI
                </button>
                <button
                  className="btn secondary customer-ghost-btn"
                  onClick={confirmPayAtOutlet}
                  disabled={isProcessingPayment}
                >
                  Pay at Outlet
                </button>
              </div>
            ) : (
              <button
                className="btn payment-primary-btn customer-primary-btn"
                onClick={startOnlinePayment}
                disabled={isProcessingPayment}
              >
                Pay using UPI
              </button>
            )}
            {isProcessingPayment && (
              <p className="payment-status-text">Redirecting to ICICI payment gateway...</p>
            )}
            {!isProcessingPayment && (
              <p className="payment-status-text">
                You will be redirected to ICICI to complete payment securely.
              </p>
            )}
            <p className="payment-status-text">
              If Google Pay does not return to the browser automatically, reopen this page
              and use the payment status check.
            </p>
          </div>
        )}

      </div>
    </main>
  );
}

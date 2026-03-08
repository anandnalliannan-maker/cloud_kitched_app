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
  orderId: string;
  items: { id: string; name: string; price: number; qty: number }[];
  total: number;
  deliveryType: "delivery" | "pickup" | "";
  location: { lat: number; lng: number } | null;
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, handler: (payload: unknown) => void) => void;
    };
  }
}

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

  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const razorpayKeyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || "";

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
    const digits = raw.replace(/\D/g, "");
    const variants = Array.from(
      new Set(
        [raw, digits, digits ? `+${digits}` : "", digits.length === 10 ? `+91${digits}` : ""].filter(
          Boolean
        )
      )
    );
    setHistoryLoading(true);
    setHistorySearched(true);
    try {
      const results = new Map<string, CustomerOrder>();
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
          });
        });
      }
      const sorted = Array.from(results.values()).sort((a, b) => {
        const aSec = a.createdAt?.seconds || 0;
        const bSec = b.createdAt?.seconds || 0;
        return bSec - aSec;
      });
      setHistoryOrders(sorted);
    } catch (err: any) {
      setHistoryError(err?.message || "Failed to load order history.");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function placeOrder() {
    setPayError("");
    if (!publishedMenuId) {
      setPayError("No menu is published yet.");
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
      const summaryForPayment: PaymentSummary = {
        orderId: orderRef.id,
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
          orderId: orderRef.id,
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
      setPaymentSummary(summaryForPayment);
      setStep("payment");
    } catch (err: any) {
      setPayError(err?.message || "Failed to place order.");
    } finally {
      setIsPlacingOrder(false);
    }
  }

  async function loadRazorpayScript() {
    if (typeof window === "undefined") {
      return false;
    }
    if (window.Razorpay) {
      return true;
    }
    return await new Promise<boolean>((resolve) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  }

  async function startOnlinePayment() {
    setPayError("");
    if (!paymentSummary) {
      setPayError("Order summary is missing.");
      return;
    }
    if (!razorpayKeyId) {
      setPayError("Razorpay key is not configured.");
      return;
    }

    setIsProcessingPayment(true);
    try {
      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded || !window.Razorpay) {
        throw new Error("Failed to load Razorpay checkout.");
      }

      const orderResponse = await fetch("/api/razorpay/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appOrderId: paymentSummary.orderId }),
      });
      const orderPayload = await orderResponse.json();
      if (!orderResponse.ok) {
        throw new Error(orderPayload.error || "Failed to create payment order.");
      }

      const razorpay = new window.Razorpay({
        key: orderPayload.keyId,
        amount: orderPayload.amount,
        currency: orderPayload.currency,
        name: "MS Kitchen",
        description: `Order ${paymentSummary.orderId}`,
        order_id: orderPayload.razorpayOrderId,
        prefill: {
          name: form.name.trim(),
          contact: form.phone.trim(),
        },
        notes: {
          internalOrderId: paymentSummary.orderId,
        },
        theme: {
          color: "#147d75",
        },
        config: {
          display: {
            blocks: {
              upi: {
                name: "Pay using UPI",
                instruments: [{ method: "upi" }],
              },
            },
            sequence: ["block.upi"],
            preferences: {
              show_default_blocks: false,
            },
          },
        },
        handler: async (response: Record<string, string>) => {
          try {
            const verifyResponse = await fetch("/api/razorpay/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                appOrderId: paymentSummary.orderId,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });
            const verifyPayload = await verifyResponse.json();
            if (!verifyResponse.ok) {
              throw new Error(
                verifyPayload.error || "Payment verification failed."
              );
            }

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
            alert(`Payment successful. Order ID: ${paymentSummary.orderId}`);
          } catch (error: any) {
            setPayError(error?.message || "Payment verification failed.");
          } finally {
            setIsProcessingPayment(false);
          }
        },
        modal: {
          ondismiss: () => {
            setIsProcessingPayment(false);
          },
        },
      });

      razorpay.on("payment.failed", (response: any) => {
        setPayError(
          response?.error?.description || "Payment failed. Please try again."
        );
        setIsProcessingPayment(false);
      });

      razorpay.open();
    } catch (error: any) {
      setPayError(error?.message || "Unable to start payment.");
      setIsProcessingPayment(false);
    }
  }

  async function confirmPayAtOutlet() {
    setPayError("");
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
          appOrderId: paymentSummary.orderId,
          offline: true,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to confirm order.");
      }
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
      alert(`Order placed. Order ID: ${paymentSummary.orderId}`);
    } catch (error: any) {
      setPayError(error?.message || "Failed to confirm order.");
    } finally {
      setIsProcessingPayment(false);
    }
  }

  return (
    <main className="container">
      <div className="stack">
        <div
          className="row"
          style={{ justifyContent: "space-between", alignItems: "center" }}
        >
          <div className="row" style={{ alignItems: "center" }}>
            <button
              className="btn secondary customer-nav-toggle"
              onClick={() => setCustomerDrawerOpen(true)}
              aria-label="Open customer menu"
            >
              {"\u2630"}
            </button>
            <h1>MS Kitchen Menu</h1>
          </div>
        </div>

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

        {customerView === "history" && (
          <div className="card stack">
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
                <button className="btn" onClick={loadOrderHistory}>
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
                <div key={order.id} className="list-card stack customer-order-card">
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
          <div className="card stack">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2>Menu</h2>
              <span style={{ color: "var(--muted)", fontWeight: 600 }}>
                {menuDateLabel
                  ? `${formatDateLabel(menuDateLabel)} ${
                      menuMealLabel ? `- ${menuMealLabel}` : ""
                    }`
                  : "No menu published"}
              </span>
            </div>
            <div className="product-grid">
              {items.map((item) => (
                <div key={item.id} className="product-card">
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
                      className="btn secondary qty-btn"
                      onClick={() => updateQty(item.id, -1)}
                      disabled={item.remaining === 0}
                    >
                      -
                    </button>
                    <div className="qty-value">{item.qty}</div>
                    <button
                      className="btn qty-btn"
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
                className="btn"
                disabled={!hasItems}
                onClick={() => setStep("details")}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {customerView === "menu" && step === "details" && (
          <div className="card stack">
            <h2>Customer Details</h2>
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
                  className={`btn ${
                    deliveryType === "delivery" ? "" : "secondary"
                  }`}
                  onClick={() => setDeliveryType("delivery")}
                >
                  Home Delivery
                </button>
                <button
                  className={`btn ${
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
                  <div className="card stack" style={{ marginTop: 12 }}>
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
                            className="btn secondary"
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
              <button className="btn secondary" onClick={() => setStep("menu")}>
                Back
              </button>
              <button
                className="btn"
                disabled={
                  !deliveryType ||
                  !form.name ||
                  !form.phone ||
                  (deliveryType === "delivery" &&
                    (!form.addressLine1 ||
                      !form.street ||
                      !form.area ||
                      !location))
                }
                onClick={placeOrder}
              >
                Proceed and Pay
              </button>
            </div>
            {payError && <small style={{ color: "crimson" }}>{payError}</small>}
          </div>
        )}

        {customerView === "menu" && step === "payment" && (
          <div className="card stack">
            <h2>Payment</h2>
            <div className="stack">
              <strong>Order Summary</strong>
              {(paymentSummary?.items || []).map((item) => (
                  <div key={item.id}>
                    {item.name} x{item.qty} = INR {item.price * item.qty}
                  </div>
                ))}
              <div>Total: INR {paymentSummary?.total ?? 0}</div>
              <div>
                Delivery:{" "}
                {(
                  paymentSummary?.deliveryType === "delivery"
                    ? "Home"
                    : paymentSummary?.deliveryType === "pickup"
                    ? "Pickup"
                    : ""
                ) || "-"}
              </div>
              {paymentSummary?.location && (
                <div>
                  Location: {paymentSummary.location.lat.toFixed(5)},{" "}
                  {paymentSummary.location.lng.toFixed(5)}
                </div>
              )}
            </div>
            {paymentSummary?.deliveryType === "pickup" ? (
              <div className="row">
                <button
                  className="btn"
                  onClick={startOnlinePayment}
                  disabled={isProcessingPayment}
                >
                  Pay Online
                </button>
                <button
                  className="btn secondary"
                  onClick={confirmPayAtOutlet}
                  disabled={isProcessingPayment}
                >
                  Pay at Outlet
                </button>
              </div>
            ) : (
              <button
                className="btn"
                onClick={startOnlinePayment}
                disabled={isProcessingPayment}
              >
                Pay Online
              </button>
            )}
            {isProcessingPayment && <p>Preparing payment...</p>}
            {!isProcessingPayment && (
              <p>
                Complete payment to confirm this order.
              </p>
            )}
          </div>
        )}

      </div>
    </main>
  );
}

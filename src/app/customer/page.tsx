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
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "@/lib/firebase";

type CartItem = {
  id: string;
  name: string;
  price: number;
  qty: number;
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

  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

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
    setLocation({ lat, lng });
    setLocLabel(place.formatted_address || place.name || "Location selected");
  }

  const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

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

        const orderRef = doc(collection(db, "orders"));
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
          status: "active",
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
      setStep("payment");
    } catch (err: any) {
      setPayError(err?.message || "Failed to place order.");
    } finally {
      setIsPlacingOrder(false);
    }
  }

  return (
    <main className="container">
      <div className="stack">
        <h1>MS Kitchen Menu</h1>

        {step === "menu" && (
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
            {items.map((item) => (
              <div key={item.id} className="row">
                <div style={{ flex: 1 }}>
                  <div>{item.name}</div>
                  <small>{item.description}</small>
                  <div>
                    <small>INR {item.price}</small>
                  </div>
                  {item.remaining === 0 && (
                    <small style={{ color: "crimson", fontWeight: 600 }}>
                      Sold Out
                    </small>
                  )}
                </div>
                <div className="row">
                  <button
                    className="btn secondary"
                    onClick={() => updateQty(item.id, -1)}
                    disabled={item.remaining === 0}
                  >
                    -
                  </button>
                  <div>{item.qty}</div>
                  <button
                    className="btn"
                    onClick={() => updateQty(item.id, 1)}
                    disabled={item.remaining === 0}
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
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

        {step === "details" && (
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
                        <input
                          className="input"
                          placeholder="Search apartment/landmark"
                          style={{ marginBottom: 12 }}
                        />
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

        {step === "payment" && (
          <div className="card stack">
            <h2>Payment</h2>
            <div className="stack">
              <strong>Order Summary</strong>
              {items
                .filter((item) => item.qty > 0)
                .map((item) => (
                  <div key={item.id}>
                    {item.name} x{item.qty} = INR {item.price * item.qty}
                  </div>
                ))}
              <div>Total: INR {total}</div>
              <div>
                Delivery: {deliveryType === "delivery" ? "Home" : "Pickup"}
              </div>
              {location && (
                <div>
                  Location: {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
                </div>
              )}
            </div>
            {deliveryType === "pickup" ? (
              <div className="row">
                <button className="btn">Pay Online</button>
                <button className="btn secondary">Pay at Outlet</button>
              </div>
            ) : (
              <button className="btn">Pay Online</button>
            )}
            {isPlacingOrder && <p>Placing order...</p>}
            {!isPlacingOrder && (
              <p>Payment integration pending. Order has been reserved.</p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

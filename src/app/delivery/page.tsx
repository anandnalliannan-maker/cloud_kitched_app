"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  updateDoc,
  where,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import { loginDelivery, normalizePhone } from "@/lib/auth";
import { clearSession, getSession, saveSession } from "@/lib/session";

type Mode = "loading" | "login" | "dashboard";
type Order = {
  id: string;
  orderId?: string;
  customerName?: string;
  phone?: string;
  items?: { name: string; qty: number; price: number }[];
  address?: string;
  area?: string;
  deliveryType?: string;
  location?: { lat: number; lng: number };
  assignedAgentId?: string;
  status?: string;
  undeliveredReason?: string;
};

export default function DeliveryPage() {
  const [mode, setMode] = useState<Mode>("loading");
  const [tab, setTab] = useState<"summary" | "orders" | "history">("summary");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    username: "",
    password: "",
  });
  const [orders, setOrders] = useState<Order[]>([]);
  const [openOrderActions, setOpenOrderActions] = useState<string | null>(null);
  const [agentInfo, setAgentInfo] = useState<{
    name: string;
    areas: string[];
  } | null>(null);
  const [currentLocation, setCurrentLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [locError, setLocError] = useState("");

  useEffect(() => {
    const session = getSession();
    if (session?.role === "delivery") {
      setMode("dashboard");
      return;
    }
    setMode("login");
  }, []);

  useEffect(() => {
    if (mode !== "dashboard") return;
    const session = getSession();
    const username = session?.username;
    if (!username) return;
    getDoc(doc(db, "delivery_agents", username)).then((snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as any;
      setAgentInfo({
        name: data.name || "",
        areas: [],
      });
    });
    const unsubAssignments = onSnapshot(
      collection(db, "area_assignments"),
      (snap) => {
        const areas = snap.docs
          .filter((docSnap) => {
            const data = docSnap.data() as any;
            return (data.agentIds || []).includes(username);
          })
          .map((docSnap) => docSnap.id);
        setAgentInfo((prev) =>
          prev ? { ...prev, areas } : { name: "", areas }
        );
      }
    );
    const q = query(
      collection(db, "orders"),
      where("assignedAgentId", "==", username)
    );
    const unsub = onSnapshot(q, (snap) => {
      setOrders(
        snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as any),
        }))
      );
    });
    return () => {
      unsub();
      unsubAssignments();
    };
  }, [mode]);

  function requestCurrentLocation() {
    setLocError("");
    if (!navigator.geolocation) {
      setLocError("Geolocation is not supported.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCurrentLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      () => {
        setLocError("Unable to access current location.");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function handleLogin() {
    setError("");
    if (!form.username || !form.password) {
      setError("Enter username and password");
      return;
    }
    const username = normalizePhone(form.username);
    await loginDelivery(username, form.password);
    saveSession({ role: "delivery", username });
    setMode("dashboard");
  }

  function handleLogout() {
    clearSession();
    setMode("login");
  }

  const orderSummary = useMemo(() => {
    const activeOrders = orders.filter((order) => order.status !== "closed");
    const totalOrders = activeOrders.length;
    const itemCounts: Record<string, number> = {};
    activeOrders.forEach((order) => {
      (order.items || []).forEach((item) => {
        itemCounts[item.name] = (itemCounts[item.name] || 0) + item.qty;
      });
    });
    return { totalOrders, itemCounts };
  }, [orders]);

  const activeOrders = useMemo(
    () => orders.filter((order) => !order.status || order.status === "active"),
    [orders]
  );

  const deliveredOrders = useMemo(
    () => orders.filter((order) => order.status === "closed"),
    [orders]
  );

  const undeliveredOrders = useMemo(
    () => orders.filter((order) => order.status === "undelivered"),
    [orders]
  );

  function haversineKm(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number
  ) {
    const toRad = (value: number) => (value * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  const sortedActiveOrders = useMemo(() => {
    if (!currentLocation) return activeOrders;
    return [...activeOrders].sort((a, b) => {
      const aLoc = a.location;
      const bLoc = b.location;
      if (!aLoc && !bLoc) return 0;
      if (!aLoc) return 1;
      if (!bLoc) return -1;
      const aDist = haversineKm(
        currentLocation.lat,
        currentLocation.lng,
        aLoc.lat,
        aLoc.lng
      );
      const bDist = haversineKm(
        currentLocation.lat,
        currentLocation.lng,
        bLoc.lat,
        bLoc.lng
      );
      return aDist - bDist;
    });
  }, [activeOrders, currentLocation]);

  async function markDelivered(order: Order) {
    await updateDoc(doc(db, "orders", order.id), {
      status: "closed",
      deliveredAt: new Date().toISOString(),
    });
  }

  async function markUndelivered(order: Order, reason: string) {
    await updateDoc(doc(db, "orders", order.id), {
      status: "undelivered",
      undeliveredReason: reason,
      undeliveredAt: new Date().toISOString(),
    });
  }

  function getMapsLink(order: Order) {
    if (order.location?.lat && order.location?.lng) {
      return `https://www.google.com/maps?q=${order.location.lat},${order.location.lng}`;
    }
    return "";
  }

  return (
    <main className="container">
      <div className="card stack">
        <h1>Delivery Portal</h1>
        {mode === "loading" && <p>Loading...</p>}
        {mode === "login" && (
          <div className="stack">
            <p>Use the phone number and password given by the owner.</p>
            <div className="field">
              <label>Phone Number</label>
              <input
                className="input"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                className="input"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            {error && <p style={{ color: "crimson" }}>{error}</p>}
            <button className="btn" onClick={handleLogin}>
              Login
            </button>
          </div>
        )}

        {mode === "dashboard" && (
          <div className="stack">
            {agentInfo && (
              <div className="card row" style={{ justifyContent: "space-between" }}>
                <div>
                  <strong>{agentInfo.name}</strong>
                </div>
                <div>
                  Areas: {agentInfo.areas.length ? agentInfo.areas.join(", ") : "Not set"}
                </div>
              </div>
            )}
            <div className="row">
              <button className="btn secondary" onClick={requestCurrentLocation}>
                Use Current Location (Sort by distance)
              </button>
              {currentLocation && (
                <small>
                  {currentLocation.lat.toFixed(5)}, {currentLocation.lng.toFixed(5)}
                </small>
              )}
              {locError && <small style={{ color: "crimson" }}>{locError}</small>}
            </div>
            <div className="row">
              <button
                className={`btn ${tab === "summary" ? "" : "secondary"}`}
                onClick={() => setTab("summary")}
              >
                Order Summary
              </button>
              <button
                className={`btn ${tab === "orders" ? "" : "secondary"}`}
                onClick={() => setTab("orders")}
              >
                Orders Assigned
              </button>
              <button
                className={`btn ${tab === "history" ? "" : "secondary"}`}
                onClick={() => setTab("history")}
              >
                Delivery History
              </button>
              <button className="btn secondary" onClick={handleLogout}>
                Logout
              </button>
            </div>

            {tab === "summary" && (
              <div className="stack">
                <div className="card">Orders Assigned: {orderSummary.totalOrders}</div>
                <div className="card">
                  <strong>Items Count</strong>
                  {Object.keys(orderSummary.itemCounts).length === 0 && (
                    <p>No items</p>
                  )}
                  {Object.entries(orderSummary.itemCounts).map(
                    ([name, count]) => (
                      <div key={name} className="row">
                        <div style={{ flex: 1 }}>{name}</div>
                        <div>{count}</div>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}

            {tab === "orders" && (
              <div className="stack">
                {sortedActiveOrders.length === 0 && <p>No orders assigned.</p>}
                {sortedActiveOrders.map((order) => {
                  const distance =
                    currentLocation && order.location
                      ? haversineKm(
                          currentLocation.lat,
                          currentLocation.lng,
                          order.location.lat,
                          order.location.lng
                        )
                      : null;
                  return (
                  <div key={order.id} className="card" style={{ position: "relative" }}>
                    <div>
                      {order.customerName || "Customer"} | {order.phone || ""}
                    </div>
                    <div>
                      Items:{" "}
                      {order.items
                        ?.map((item) => `${item.name} x${item.qty}`)
                        .join(", ") || "Items"}
                    </div>
                    <div>Address: {order.address || ""}</div>
                    <div>Area: {order.area || "Unknown"}</div>
                    {distance !== null && (
                      <div>Distance: {distance.toFixed(2)} km</div>
                    )}
                    <div className="row">
                      <a
                        className="btn secondary"
                        href={`tel:${order.phone || ""}`}
                      >
                        Call
                      </a>
                      {getMapsLink(order) ? (
                        <a
                          className="btn secondary"
                          href={getMapsLink(order)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Navigate
                        </a>
                      ) : (
                        <button className="btn secondary" disabled>
                          Navigate
                        </button>
                      )}
                      <button
                        className="btn secondary"
                        onClick={() =>
                          setOpenOrderActions(
                            openOrderActions === order.id ? null : order.id
                          )
                        }
                      >
                        ⋮
                      </button>
                    </div>
                    {openOrderActions === order.id && (
                      <div
                        className="card stack"
                        style={{
                          position: "absolute",
                          right: 12,
                          top: "100%",
                          zIndex: 10,
                          minWidth: 180,
                        }}
                      >
                        <button className="btn" onClick={() => markDelivered(order)}>
                          Mark Delivered
                        </button>
                        <button
                          className="btn secondary"
                          onClick={() => {
                            const reason =
                              window.prompt(
                                "Reason for undelivered? (e.g., customer not available, address not found, payment issue)"
                              ) || "";
                            if (!reason.trim()) return;
                            markUndelivered(order, reason.trim());
                          }}
                        >
                          Mark Undelivered
                        </button>
                      </div>
                    )}
                  </div>
                );
                })}
              </div>
            )}

            {tab === "history" && (
              <div className="stack">
                {deliveredOrders.length === 0 && <p>No delivered orders.</p>}
                {deliveredOrders.map((order) => (
                  <div key={order.id} className="card">
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <div>
                        {order.customerName || "Customer"} | {order.phone || ""}
                      </div>
                      <span className="badge">Delivered</span>
                    </div>
                    <div>
                      Items:{" "}
                      {order.items
                        ?.map((item) => `${item.name} x${item.qty}`)
                        .join(", ") || "Items"}
                    </div>
                    <div>Address: {order.address || ""}</div>
                    <div>Area: {order.area || "Unknown"}</div>
                  </div>
                ))}
                {undeliveredOrders.length > 0 && (
                  <div className="stack">
                    <h3>Undelivered</h3>
                    {undeliveredOrders.map((order) => (
                      <div key={order.id} className="card">
                        <div className="row" style={{ justifyContent: "space-between" }}>
                          <div>
                            {order.customerName || "Customer"} | {order.phone || ""}
                          </div>
                          <span className="badge">Undelivered</span>
                        </div>
                        <div>
                          Items:{" "}
                          {order.items
                            ?.map((item) => `${item.name} x${item.qty}`)
                            .join(", ") || "Items"}
                        </div>
                        <div>Address: {order.address || ""}</div>
                        <div>Area: {order.area || "Unknown"}</div>
                        <div>Reason: {order.undeliveredReason || "-"}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

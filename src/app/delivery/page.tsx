"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import { loginDelivery, normalizePhone } from "@/lib/auth";
import { clearSession, getSession, saveSession } from "@/lib/session";

type Mode = "loading" | "login" | "dashboard";
type PublishedMenu = {
  id: string;
  date: string;
  mealType?: string;
  isArchived?: boolean;
  ordersStopped?: boolean;
  createdAt?: any;
};

type Order = {
  id: string;
  orderId?: string;
  customerName?: string;
  phone?: string;
  items?: { name: string; qty: number; price: number }[];
  address?: string;
  area?: string;
  subArea?: string;
  deliveryType?: string;
  location?: { lat: number; lng: number };
  assignedAgentId?: string;
  assignedAgentName?: string;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  undeliveredReason?: string;
  total?: number;
  mealType?: string;
  publishedDate?: string;
  publishedMenuId?: string;
  createdAt?: any;
  deliveredAt?: string;
  undeliveredAt?: string;
  codPaymentStatus?: string;
  codAmountCollected?: number;
  codBalance?: number;
  codPaymentNotes?: string;
  codCollectedByAgentId?: string;
  codCollectedByAgentName?: string;
};

function formatOrderDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getOrderDateKey(order: Order) {
  if (order.publishedDate) return order.publishedDate;
  if (order.createdAt?.seconds) {
    return new Date(order.createdAt.seconds * 1000).toISOString().slice(0, 10);
  }
  if (typeof order.createdAt === "string") {
    return order.createdAt.slice(0, 10);
  }
  return "";
}

function isCashOnDeliveryOrder(order: Order) {
  return order.deliveryType === "delivery" && order.paymentMethod === "cash_on_delivery";
}

export default function DeliveryPage() {
  const [mode, setMode] = useState<Mode>("loading");
  const [tab, setTab] = useState<"summary" | "orders" | "dashboard">("summary");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    username: "",
    password: "",
  });
  const [orders, setOrders] = useState<Order[]>([]);
  const [publishedMenus, setPublishedMenus] = useState<PublishedMenu[]>([]);
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
  const [historyFilters, setHistoryFilters] = useState({
    date: "",
    area: "",
  });

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
    const unsubMenus = onSnapshot(
      query(collection(db, "published_menus"), orderBy("createdAt", "desc")),
      (snap) => {
        setPublishedMenus(
          snap.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as any),
          }))
        );
      }
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
      unsubMenus();
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

  const currentPublishedMenu = useMemo(
    () => publishedMenus.find((menu) => !menu.isArchived && !menu.ordersStopped) || null,
    [publishedMenus]
  );

  const currentPublishedMenuKey = useMemo(() => {
    if (!currentPublishedMenu) return "";
    return `${currentPublishedMenu.date}__${currentPublishedMenu.mealType || "Unknown"}`;
  }, [currentPublishedMenu]);

  const currentMenuOrders = useMemo(() => {
    if (!currentPublishedMenu) return [];
    return orders.filter((order) => {
      if (order.publishedMenuId) {
        return order.publishedMenuId === currentPublishedMenu.id;
      }
      return `${getOrderDateKey(order)}__${order.mealType || "Unknown"}` === currentPublishedMenuKey;
    });
  }, [orders, currentPublishedMenu, currentPublishedMenuKey]);

  const activeOrders = useMemo(
    () => currentMenuOrders.filter((order) => !order.status || order.status === "active"),
    [currentMenuOrders]
  );

  const orderSummary = useMemo(() => {
    const totalOrders = activeOrders.length;
    const itemCounts: Record<string, number> = {};
    const itemPairCounts: Record<string, number> = {};
    const areaCounts: Record<string, number> = {};
    let codDue = 0;
    activeOrders.forEach((order) => {
      const area = order.area || "Unknown";
      areaCounts[area] = (areaCounts[area] || 0) + 1;
      if (isCashOnDeliveryOrder(order)) {
        codDue += typeof order.codBalance === "number" ? order.codBalance : order.total || 0;
      }
      (order.items || []).forEach((item) => {
        itemCounts[item.name] = (itemCounts[item.name] || 0) + item.qty;
        const pairKey = `${item.name}__${item.qty}`;
        itemPairCounts[pairKey] = (itemPairCounts[pairKey] || 0) + 1;
      });
    });
    return { totalOrders, itemCounts, itemPairCounts, areaCounts, codDue };
  }, [activeOrders]);

  const activeItemPackingMatrix = useMemo(() => {
    const packQtySet = new Set<number>();
    const grouped: Record<string, Record<number, number>> = {};

    Object.entries(orderSummary.itemPairCounts).forEach(([pairKey, count]) => {
      const [itemName, packQtyRaw] = pairKey.split("__");
      const packQty = Number(packQtyRaw || 0);
      if (!itemName || !packQty) return;

      packQtySet.add(packQty);
      if (!grouped[itemName]) {
        grouped[itemName] = {};
      }
      grouped[itemName][packQty] = count;
    });

    const packQtyColumns = Array.from(packQtySet).sort((a, b) => a - b);
    const rows = Object.entries(grouped)
      .map(([itemName, buckets]) => ({
        key: itemName,
        itemName,
        buckets,
      }))
      .sort((a, b) => a.itemName.localeCompare(b.itemName));

    return {
      packQtyColumns,
      rows,
    };
  }, [orderSummary.itemPairCounts]);

  const codCollectedSummary = useMemo(() => {
    return currentMenuOrders.reduce(
      (summary, order) => {
        if (!isCashOnDeliveryOrder(order)) return summary;
        summary.totalOrders += 1;
        summary.collected += order.codAmountCollected || 0;
        summary.outstanding +=
          typeof order.codBalance === "number" ? order.codBalance : order.total || 0;
        return summary;
      },
      { totalOrders: 0, collected: 0, outstanding: 0 }
    );
  }, [currentMenuOrders]);

  const historicalOrders = useMemo(
    () =>
      orders.filter(
        (order) => order.status === "closed" || order.status === "undelivered"
      ),
    [orders]
  );

  const historyDateOptions = useMemo(
    () =>
      Array.from(
        new Set(historicalOrders.map((order) => getOrderDateKey(order)).filter(Boolean))
      ).sort((a, b) => b.localeCompare(a)),
    [historicalOrders]
  );

  const historyAreaOptions = useMemo(
    () =>
      Array.from(
        new Set(historicalOrders.map((order) => order.area || "Unknown"))
      ).sort((a, b) => a.localeCompare(b)),
    [historicalOrders]
  );

  const filteredHistoryOrders = useMemo(
    () =>
      historicalOrders.filter((order) => {
        const matchesDate =
          !historyFilters.date || getOrderDateKey(order) === historyFilters.date;
        const matchesArea =
          !historyFilters.area || (order.area || "Unknown") === historyFilters.area;
        return matchesDate && matchesArea;
      }),
    [historicalOrders, historyFilters]
  );

  const historySummary = useMemo(() => {
    const byDate: Record<string, { delivered: number; undelivered: number }> = {};
    const byArea: Record<string, { delivered: number; undelivered: number }> = {};

    filteredHistoryOrders.forEach((order) => {
      const dateKey = getOrderDateKey(order) || "Unknown";
      const areaKey = order.area || "Unknown";
      const isDelivered = order.status === "closed";

      byDate[dateKey] ||= { delivered: 0, undelivered: 0 };
      byArea[areaKey] ||= { delivered: 0, undelivered: 0 };

      if (isDelivered) {
        byDate[dateKey].delivered += 1;
        byArea[areaKey].delivered += 1;
      } else {
        byDate[dateKey].undelivered += 1;
        byArea[areaKey].undelivered += 1;
      }
    });

    return {
      total: filteredHistoryOrders.length,
      delivered: filteredHistoryOrders.filter((order) => order.status === "closed")
        .length,
      undelivered: filteredHistoryOrders.filter(
        (order) => order.status === "undelivered"
      ).length,
      byDate: Object.entries(byDate).sort((a, b) => b[0].localeCompare(a[0])),
      byArea: Object.entries(byArea).sort((a, b) => a[0].localeCompare(b[0])),
    };
  }, [filteredHistoryOrders]);

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

  async function markDelivered(order: Order, paymentReceived = false) {
    const payload: Record<string, any> = {
      status: "closed",
      deliveredAt: new Date().toISOString(),
    };

    if (isCashOnDeliveryOrder(order)) {
      const collectedAmount = paymentReceived ? order.total || 0 : order.codAmountCollected || 0;
      const balanceAmount = paymentReceived
        ? 0
        : typeof order.codBalance === "number"
        ? order.codBalance
        : order.total || 0;
      payload.paymentMethod = "cash_on_delivery";
      payload.paymentStatus = paymentReceived ? "paid" : "cash_on_delivery";
      payload.codAmountCollected = collectedAmount;
      payload.codBalance = balanceAmount;
      payload.codPaymentStatus = paymentReceived ? "paid" : "unpaid";
      payload.codCollectedByAgentId = paymentReceived ? getSession()?.username || "" : "";
      payload.codCollectedByAgentName = paymentReceived ? agentInfo?.name || "" : "";
      payload.codPaymentNotes = paymentReceived
        ? "Payment collected by delivery agent."
        : order.codPaymentNotes || "";
    }

    await updateDoc(doc(db, "orders", order.id), payload);
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
                Active Orders
              </button>
              <button
                className={`btn ${tab === "dashboard" ? "" : "secondary"}`}
                onClick={() => setTab("dashboard")}
              >
                Dashboard
              </button>
              <button className="btn secondary" onClick={handleLogout}>
                Logout
              </button>
            </div>

            {tab === "summary" && (
              <div className="stack">
                <div className="card">
                  Current Menu:{" "}
                  {currentPublishedMenu
                    ? `${formatOrderDate(currentPublishedMenu.date)} - ${
                        currentPublishedMenu.mealType || "Unknown"
                      }`
                    : "No live published menu"}
                </div>
                <div className="card">Active Orders: {orderSummary.totalOrders}</div>
                <div className="card">COD Due on Active Orders: INR {orderSummary.codDue}</div>
                <div className="card">
                  COD to hand over: INR {codCollectedSummary.collected}
                </div>
                <div className="card">
                  <strong>Active Orders by Area</strong>
                  {Object.keys(orderSummary.areaCounts).length === 0 && <p>No active orders.</p>}
                  {Object.entries(orderSummary.areaCounts).map(([name, count]) => (
                    <div key={name} className="row">
                      <div style={{ flex: 1 }}>{name}</div>
                      <div>{count}</div>
                    </div>
                  ))}
                </div>
                <div className="card">
                  <strong>Active Items Count</strong>
                  {Object.keys(orderSummary.itemCounts).length === 0 && <p>No items</p>}
                  {Object.entries(orderSummary.itemCounts).map(([name, count]) => (
                    <div key={name} className="row">
                      <div style={{ flex: 1 }}>{name}</div>
                      <div>{count}</div>
                    </div>
                  ))}
                </div>
                <div className="card">
                  <strong>Packing Buckets</strong>
                  <div className="table-scroll">
                    <table className="payments-table payments-table-compact owner-summary-packing-table">
                      <thead>
                        <tr>
                          <th>Item</th>
                          {activeItemPackingMatrix.packQtyColumns.map((packQty) => (
                            <th key={packQty}>{packQty} Pack</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {activeItemPackingMatrix.rows.length === 0 && (
                          <tr>
                            <td
                              colSpan={Math.max(activeItemPackingMatrix.packQtyColumns.length + 1, 2)}
                            >
                              No packing data
                            </td>
                          </tr>
                        )}
                        {activeItemPackingMatrix.rows.map((row) => (
                          <tr key={row.key}>
                            <td>{row.itemName}</td>
                            {activeItemPackingMatrix.packQtyColumns.map((packQty) => (
                              <td key={`${row.key}-${packQty}`}>
                                {row.buckets[packQty] || "-"}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {tab === "orders" && (
              <div className="stack">
                <div className="card">
                  Current Menu:{" "}
                  {currentPublishedMenu
                    ? `${formatOrderDate(currentPublishedMenu.date)} - ${
                        currentPublishedMenu.mealType || "Unknown"
                      }`
                    : "No live published menu"}
                </div>
                {sortedActiveOrders.length === 0 && <p>No active orders assigned.</p>}
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
                    <div>
                      Payment:{" "}
                      {isCashOnDeliveryOrder(order)
                        ? `Cash on Delivery${` - INR ${
                            typeof order.codBalance === "number"
                              ? order.codBalance
                              : order.total || 0
                          } due`}`
                        : "Prepaid / Settled"}
                    </div>
                    <div>Address: {order.address || ""}</div>
                    <div>
                      Area: {order.area || "Unknown"}
                      {order.subArea ? ` - ${order.subArea}` : ""}
                    </div>
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
                        {isCashOnDeliveryOrder(order) ? (
                          <>
                            <button
                              className="btn"
                              onClick={() => markDelivered(order, true)}
                            >
                              Delivered + Payment Received
                            </button>
                            <button
                              className="btn secondary"
                              onClick={() => markDelivered(order, false)}
                            >
                              Delivered, Payment Pending
                            </button>
                          </>
                        ) : (
                          <button className="btn" onClick={() => markDelivered(order)}>
                            Mark Delivered
                          </button>
                        )}
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

            {tab === "dashboard" && (
              <div className="stack">
                <div className="row">
                  <input
                    className="input"
                    type="date"
                    value={historyFilters.date}
                    onChange={(e) =>
                      setHistoryFilters((prev) => ({ ...prev, date: e.target.value }))
                    }
                    style={{ maxWidth: 220 }}
                  />
                  <select
                    className="input"
                    value={historyFilters.area}
                    onChange={(e) =>
                      setHistoryFilters((prev) => ({ ...prev, area: e.target.value }))
                    }
                    style={{ maxWidth: 220 }}
                  >
                    <option value="">All areas</option>
                    {historyAreaOptions.map((area) => (
                      <option key={area} value={area}>
                        {area}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn secondary"
                    onClick={() => setHistoryFilters({ date: "", area: "" })}
                  >
                    Clear Filters
                  </button>
                </div>

                <div className="row">
                  <div className="card" style={{ minWidth: 160 }}>
                    Total History Orders: {historySummary.total}
                  </div>
                  <div className="card" style={{ minWidth: 160 }}>
                    Delivered: {historySummary.delivered}
                  </div>
                  <div className="card" style={{ minWidth: 160 }}>
                    Undelivered: {historySummary.undelivered}
                  </div>
                </div>

                <div className="card stack">
                  <strong>History by Date</strong>
                  {historySummary.byDate.length === 0 && <p>No history found.</p>}
                  {historySummary.byDate.length > 0 && (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: "left", padding: "8px 0" }}>Date</th>
                            <th style={{ textAlign: "left", padding: "8px 0" }}>Delivered</th>
                            <th style={{ textAlign: "left", padding: "8px 0" }}>Undelivered</th>
                          </tr>
                        </thead>
                        <tbody>
                          {historySummary.byDate.map(([date, counts]) => (
                            <tr key={date}>
                              <td style={{ padding: "8px 0" }}>
                                {date ? formatOrderDate(date) : "Unknown"}
                              </td>
                              <td style={{ padding: "8px 0" }}>{counts.delivered}</td>
                              <td style={{ padding: "8px 0" }}>{counts.undelivered}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="card stack">
                  <strong>History by Area</strong>
                  {historySummary.byArea.length === 0 && <p>No history found.</p>}
                  {historySummary.byArea.length > 0 && (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: "left", padding: "8px 0" }}>Area</th>
                            <th style={{ textAlign: "left", padding: "8px 0" }}>Delivered</th>
                            <th style={{ textAlign: "left", padding: "8px 0" }}>Undelivered</th>
                          </tr>
                        </thead>
                        <tbody>
                          {historySummary.byArea.map(([area, counts]) => (
                            <tr key={area}>
                              <td style={{ padding: "8px 0" }}>{area}</td>
                              <td style={{ padding: "8px 0" }}>{counts.delivered}</td>
                              <td style={{ padding: "8px 0" }}>{counts.undelivered}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="card stack">
                  <strong>History Orders</strong>
                  {filteredHistoryOrders.length === 0 && <p>No history orders found.</p>}
                  {filteredHistoryOrders.length > 0 && (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: "left", padding: "8px 12px 8px 0" }}>Date</th>
                            <th style={{ textAlign: "left", padding: "8px 12px 8px 0" }}>Customer</th>
                            <th style={{ textAlign: "left", padding: "8px 12px 8px 0" }}>Area</th>
                            <th style={{ textAlign: "left", padding: "8px 12px 8px 0" }}>Items</th>
                            <th style={{ textAlign: "left", padding: "8px 12px 8px 0" }}>Status</th>
                            <th style={{ textAlign: "left", padding: "8px 0" }}>Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredHistoryOrders.map((order) => (
                            <tr key={order.id}>
                              <td style={{ padding: "8px 12px 8px 0", verticalAlign: "top" }}>
                                {formatOrderDate(getOrderDateKey(order))}
                              </td>
                              <td style={{ padding: "8px 12px 8px 0", verticalAlign: "top" }}>
                                <div>{order.customerName || "Customer"}</div>
                                <small>{order.phone || ""}</small>
                              </td>
                              <td style={{ padding: "8px 12px 8px 0", verticalAlign: "top" }}>
                                {order.area || "Unknown"}
                              </td>
                              <td style={{ padding: "8px 12px 8px 0", verticalAlign: "top" }}>
                                {order.items?.map((item) => `${item.name} x${item.qty}`).join(", ") ||
                                  "Items"}
                              </td>
                              <td style={{ padding: "8px 12px 8px 0", verticalAlign: "top" }}>
                                {order.status === "closed" ? "Delivered" : "Undelivered"}
                              </td>
                              <td style={{ padding: "8px 0", verticalAlign: "top" }}>
                                {order.undeliveredReason || "-"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                {historyDateOptions.length === 0 && filteredHistoryOrders.length === 0 && (
                  <div className="card">
                    History will appear here once this agent completes or marks orders as
                    undelivered.
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

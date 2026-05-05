"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import { loginDelivery } from "@/lib/auth";
import { clearSession, getSession, saveSession } from "@/lib/session";

type Mode = "loading" | "login" | "dashboard";

type PublishedMenu = {
  id: string;
  date: string;
  mealType?: string;
  isArchived?: boolean;
  ordersStopped?: boolean;
  createdAt?: unknown;
};

type OrderItem = {
  name: string;
  qty: number;
  price?: number;
};

type Order = {
  id: string;
  orderId?: string;
  customerName?: string;
  phone?: string;
  items?: OrderItem[];
  address?: string;
  area?: string;
  subArea?: string;
  deliveryType?: string;
  assignedAgentId?: string;
  assignedAgentName?: string;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  undeliveredReason?: string;
  total?: number;
  mealType?: string;
  publishedDate?: string;
  createdAt?: any;
  codPaymentStatus?: string;
  codAmountCollected?: number;
  codBalance?: number;
  codPaymentNotes?: string;
  codCollectedByAgentId?: string;
  codCollectedByAgentName?: string;
};

type MasterSubAreaRecord = {
  id: string;
  name: string;
  parentArea?: string;
  deliveryAgentName?: string;
  lunchDeliveryAgentName?: string;
  dinnerDeliveryAgentName?: string;
};

type DeliveryAgentRecord = {
  id: string;
  name: string;
  active?: boolean;
};

const DELIVERY_AGENT_STORAGE_KEY = "msk_delivery_selected_agent";

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

function normalizeLookupLabel(value: string) {
  return value.trim().toLowerCase();
}

function getMasterSubAreaAgentNames(
  record: MasterSubAreaRecord | null | undefined
) {
  return [
    record?.lunchDeliveryAgentName || "",
    record?.dinnerDeliveryAgentName || "",
    record?.deliveryAgentName || "",
  ].filter(Boolean);
}

function isCashOnDeliveryOrder(order: Order) {
  return order.deliveryType === "delivery" && order.paymentMethod === "cash_on_delivery";
}

function buildAgentPackingMatrix(operationalOrders: Order[]) {
  const itemSet = new Set<string>();
  const grouped: Record<string, Record<string, Record<number, number>>> = {};
  const itemPackQtyMap: Record<string, Set<number>> = {};

  operationalOrders.forEach((order) => {
    const agent = order.assignedAgentName || "Unassigned";
    if (!grouped[agent]) {
      grouped[agent] = {};
    }
    (order.items || []).forEach((item) => {
      if (!item.name || !item.qty) return;
      itemSet.add(item.name);
      if (!itemPackQtyMap[item.name]) {
        itemPackQtyMap[item.name] = new Set<number>();
      }
      itemPackQtyMap[item.name].add(item.qty);
      if (!grouped[agent][item.name]) {
        grouped[agent][item.name] = {};
      }
      grouped[agent][item.name][item.qty] = (grouped[agent][item.name][item.qty] || 0) + 1;
    });
  });

  const itemNames = Array.from(itemSet).sort((a, b) => a.localeCompare(b));
  const itemPackQtyColumns = Object.fromEntries(
    itemNames.map((itemName) => [
      itemName,
      Array.from(itemPackQtyMap[itemName] || []).sort((a, b) => a - b),
    ])
  ) as Record<string, number[]>;

  const rows = Object.entries(grouped)
    .map(([agent, items]) => ({
      key: agent,
      agent,
      items,
    }))
    .sort((a, b) => a.agent.localeCompare(b.agent));

  return { itemNames, itemPackQtyColumns, rows };
}

function exportPackingMatrixCsv(
  filename: string,
  matrix: ReturnType<typeof buildAgentPackingMatrix>
) {
  const headerRowTop = ["Name"];
  const headerRowBottom = [""];

  matrix.itemNames.forEach((itemName) => {
    const packColumns = matrix.itemPackQtyColumns[itemName] || [];
    if (packColumns.length === 0) return;
    headerRowTop.push(itemName, ...Array(Math.max(packColumns.length - 1, 0)).fill(""));
    headerRowBottom.push(...packColumns.map((packQty) => `Pack ${packQty}`));
  });

  const rows = matrix.rows.map((row) => {
    const line = [row.agent];
    matrix.itemNames.forEach((itemName) => {
      const packColumns = matrix.itemPackQtyColumns[itemName] || [];
      packColumns.forEach((packQty) => {
        line.push(String(row.items[itemName]?.[packQty] || "-"));
      });
    });
    return line;
  });

  const csvLines = [headerRowTop, headerRowBottom, ...rows]
    .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csvLines], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function DeliveryPage() {
  const [mode, setMode] = useState<Mode>("loading");
  const [tab, setTab] = useState<"summary" | "orders">("summary");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    username: "",
    password: "",
  });
  const [selectedAgentName, setSelectedAgentName] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [publishedMenus, setPublishedMenus] = useState<PublishedMenu[]>([]);
  const [masterSubAreas, setMasterSubAreas] = useState<MasterSubAreaRecord[]>([]);
  const [deliveryAgents, setDeliveryAgents] = useState<DeliveryAgentRecord[]>([]);
  const [openOrderActions, setOpenOrderActions] = useState<string | null>(null);
  const navigationReadyRef = useRef(false);

  useEffect(() => {
    const session = getSession();
    if (session?.role === "delivery") {
      const savedAgent =
        typeof window !== "undefined"
          ? window.localStorage.getItem(DELIVERY_AGENT_STORAGE_KEY) || ""
          : "";
      setSelectedAgentName(savedAgent);
      setMode("dashboard");
      return;
    }
    setMode("login");
  }, []);

  useEffect(() => {
    if (mode !== "dashboard") return;

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

    const unsubOrders = onSnapshot(
      query(collection(db, "orders"), orderBy("createdAt", "desc")),
      (snap) => {
        setOrders(
          snap.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as any),
          }))
        );
      }
    );

    const unsubMasterSubAreas = onSnapshot(
      query(collection(db, "master_sub_areas"), orderBy("name", "asc")),
      (snap) => {
        setMasterSubAreas(
          snap.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as any),
          }))
        );
      }
    );

    const unsubDeliveryAgents = onSnapshot(
      query(collection(db, "delivery_agents"), orderBy("name", "asc")),
      (snap) => {
        setDeliveryAgents(
          snap.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as any),
          }))
        );
      }
    );

    return () => {
      unsubMenus();
      unsubOrders();
      unsubMasterSubAreas();
      unsubDeliveryAgents();
    };
  }, [mode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!selectedAgentName) {
      window.localStorage.removeItem(DELIVERY_AGENT_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(DELIVERY_AGENT_STORAGE_KEY, selectedAgentName);
  }, [selectedAgentName]);

  useEffect(() => {
    if (mode !== "dashboard" || typeof window === "undefined") return;

    const applyNavigationState = (state: any) => {
      const nextView = state?.deliveryView;
      if (nextView === "orders") {
        setSelectedAgentName(state.agentName || "");
        setTab("orders");
        setOpenOrderActions(null);
        return;
      }
      if (nextView === "summary") {
        setSelectedAgentName(state.agentName || "");
        setTab("summary");
        setOpenOrderActions(null);
        return;
      }
      setSelectedAgentName("");
      setTab("summary");
      setOpenOrderActions(null);
    };

    const handlePopState = (event: PopStateEvent) => {
      applyNavigationState(event.state);
    };

    if (!navigationReadyRef.current) {
      navigationReadyRef.current = true;
      const initialState = selectedAgentName
        ? { deliveryView: tab, agentName: selectedAgentName }
        : { deliveryView: "picker" };
      window.history.replaceState(initialState, "", window.location.href);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [mode, selectedAgentName, tab]);

  function openAgent(agentName: string) {
    setSelectedAgentName(agentName);
    setTab("summary");
    setOpenOrderActions(null);
    if (typeof window !== "undefined") {
      window.history.pushState(
        { deliveryView: "summary", agentName },
        "",
        window.location.href
      );
    }
  }

  function openTab(nextTab: "summary" | "orders") {
    setTab(nextTab);
    setOpenOrderActions(null);
    if (typeof window !== "undefined" && selectedAgentName) {
      window.history.pushState(
        { deliveryView: nextTab, agentName: selectedAgentName },
        "",
        window.location.href
      );
    }
  }

  function goToAgentPicker() {
    setSelectedAgentName("");
    setTab("summary");
    setOpenOrderActions(null);
    if (typeof window !== "undefined") {
      window.history.pushState(
        { deliveryView: "picker" },
        "",
        window.location.href
      );
    }
  }

  async function handleLogin() {
    setError("");
    if (!form.username.trim() || !form.password) {
      setError("Enter username and password");
      return;
    }
    try {
      await loginDelivery(form.username, form.password);
      saveSession({ role: "delivery", username: "mskitchen" });
      setMode("dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to login");
    }
  }

  function handleLogout() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(DELIVERY_AGENT_STORAGE_KEY);
    }
    clearSession();
    setSelectedAgentName("");
    setOpenOrderActions(null);
    setMode("login");
  }

  const agentOptions = useMemo(() => {
    const byKey = new Map<string, string>();

    masterSubAreas.forEach((record) => {
      getMasterSubAreaAgentNames(record).forEach((name) => {
        const trimmed = name.trim();
        const key = normalizeLookupLabel(trimmed);
        if (trimmed && key && !byKey.has(key)) {
          byKey.set(key, trimmed);
        }
      });
    });

    deliveryAgents.forEach((agent) => {
      const name = (agent.name || "").trim();
      const key = normalizeLookupLabel(name);
      if (name && key && !byKey.has(key)) {
        byKey.set(key, name);
      }
    });

    orders.forEach((order) => {
      const name = (order.assignedAgentName || "").trim();
      const key = normalizeLookupLabel(name);
      if (name && key && !byKey.has(key)) {
        byKey.set(key, name);
      }
    });

    return Array.from(byKey.entries())
      .map(([key, name]) => ({ key, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [deliveryAgents, masterSubAreas, orders]);

  useEffect(() => {
    if (!agentOptions.length) {
      setSelectedAgentName("");
      return;
    }

    if (
      selectedAgentName &&
      agentOptions.some(
        (option) => option.key === normalizeLookupLabel(selectedAgentName)
      )
    ) {
      return;
    }

    const savedAgent =
      typeof window !== "undefined"
        ? window.localStorage.getItem(DELIVERY_AGENT_STORAGE_KEY) || ""
        : "";
    const savedMatch = agentOptions.find(
      (option) => option.key === normalizeLookupLabel(savedAgent)
    );
    if (savedMatch) {
      setSelectedAgentName(savedMatch.name);
    } else if (
      selectedAgentName &&
      !agentOptions.some(
        (option) => option.key === normalizeLookupLabel(selectedAgentName)
      )
    ) {
      setSelectedAgentName("");
    }
  }, [agentOptions, selectedAgentName]);

  const currentPublishedMenu = useMemo(
    () => publishedMenus.find((menu) => !menu.isArchived && !menu.ordersStopped) || null,
    [publishedMenus]
  );

  const currentPublishedMenuKey = useMemo(() => {
    if (!currentPublishedMenu) return "";
    return `${currentPublishedMenu.date}__${currentPublishedMenu.mealType || "Unknown"}`;
  }, [currentPublishedMenu]);

  const selectedAgentKey = useMemo(
    () => normalizeLookupLabel(selectedAgentName),
    [selectedAgentName]
  );

  const currentMenuOrders = useMemo(() => {
    if (!currentPublishedMenu) return [];
    return orders.filter(
      (order) =>
        `${getOrderDateKey(order)}__${order.mealType || "Unknown"}` ===
        currentPublishedMenuKey
    );
  }, [orders, currentPublishedMenu, currentPublishedMenuKey]);

  const activeOrders = useMemo(
    () =>
      currentMenuOrders.filter(
        (order) =>
          (!order.status || order.status === "active") &&
          normalizeLookupLabel(order.assignedAgentName || "") === selectedAgentKey
      ),
    [currentMenuOrders, selectedAgentKey]
  );

  const selectedAgentAreas = useMemo(
    () =>
      Array.from(
        new Set(
          masterSubAreas
            .filter(
              (record) =>
                getMasterSubAreaAgentNames(record).some(
                  (name) => normalizeLookupLabel(name) === selectedAgentKey
                )
            )
            .map((record) => record.parentArea || "Unknown")
        )
      ).sort((a, b) => a.localeCompare(b)),
    [masterSubAreas, selectedAgentKey]
  );

  const summary = useMemo(() => {
    const bySubArea: Record<string, number> = {};
    let codOrders = 0;

    activeOrders.forEach((order) => {
      const subArea = order.subArea || "No sub area mapped";
      bySubArea[subArea] = (bySubArea[subArea] || 0) + 1;
      if (isCashOnDeliveryOrder(order)) {
        codOrders += 1;
      }
    });

    return {
      activeOrders: activeOrders.length,
      codOrders,
      bySubArea: Object.entries(bySubArea)
        .map(([subArea, count]) => ({ subArea, count }))
        .sort((a, b) => b.count - a.count || a.subArea.localeCompare(b.subArea)),
    };
  }, [activeOrders]);

  const packingMatrix = useMemo(
    () => buildAgentPackingMatrix(activeOrders),
    [activeOrders]
  );

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
      payload.codCollectedByAgentId = paymentReceived ? selectedAgentKey : "";
      payload.codCollectedByAgentName = paymentReceived ? selectedAgentName : "";
      payload.codPaymentNotes = paymentReceived
        ? "Payment collected by delivery agent."
        : order.codPaymentNotes || "";
    }

    await updateDoc(doc(db, "orders", order.id), payload);
    setOpenOrderActions(null);
  }

  async function markUndelivered(order: Order, reason: string) {
    await updateDoc(doc(db, "orders", order.id), {
      status: "undelivered",
      undeliveredReason: reason,
      undeliveredAt: new Date().toISOString(),
    });
    setOpenOrderActions(null);
  }

  return (
    <main className="container delivery-portal">
      <div className="card stack delivery-shell">
        <h1>Delivery Portal</h1>

        {mode === "loading" && <p>Loading...</p>}

        {mode === "login" && (
          <div className="stack">
            <p>Use the shared delivery login.</p>
            <div className="field">
              <label>Username</label>
              <input
                className="input"
                value={form.username}
                onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                className="input"
                type="password"
                value={form.password}
                onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
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
            {!selectedAgentName ? (
              <div className="card stack">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>Select delivery agent</strong>
                  <button className="btn secondary" onClick={handleLogout}>
                    Logout
                  </button>
                </div>
                {agentOptions.length === 0 ? (
                  <p>No delivery agents are currently available from master data.</p>
                ) : (
                  <div className="delivery-agent-picker">
                    {agentOptions.map((agent) => (
                      <button
                        key={agent.key}
                        className="btn secondary delivery-agent-option"
                        onClick={() => openAgent(agent.name)}
                      >
                        {agent.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="card delivery-agent-bar">
                  <div className="delivery-agent-bar-copy">
                    <strong>{selectedAgentName}</strong>
                    <span>
                      {selectedAgentAreas.length
                        ? selectedAgentAreas.join(", ")
                        : "No mapped areas"}
                    </span>
                  </div>
                  <div className="row delivery-tab-actions">
                    <button
                      className={`btn ${tab === "summary" ? "" : "secondary"}`}
                      onClick={() => openTab("summary")}
                    >
                      Summary
                    </button>
                    <button
                      className={`btn ${tab === "orders" ? "" : "secondary"}`}
                      onClick={() => openTab("orders")}
                    >
                      Active Orders
                    </button>
                    <button className="btn secondary" onClick={goToAgentPicker}>
                      Back
                    </button>
                    <button className="btn secondary" onClick={handleLogout}>
                      Logout
                    </button>
                  </div>
                </div>

                {tab === "summary" && (
                  <div className="stack delivery-summary-stack">
                    <div className="card delivery-summary-card">
                      Current Menu:{" "}
                      {currentPublishedMenu
                        ? `${formatOrderDate(currentPublishedMenu.date)} - ${
                            currentPublishedMenu.mealType || "Unknown"
                          }`
                        : "No live published menu"}
                    </div>

                    <div className="delivery-summary-grid">
                      <div className="card delivery-summary-card">
                        <strong>Active Orders</strong>
                        <div>{summary.activeOrders}</div>
                      </div>
                      <div className="card delivery-summary-card">
                        <strong>COD Orders</strong>
                        <div>{summary.codOrders}</div>
                      </div>
                    </div>

                    <div className="card delivery-summary-card">
                      <strong>Orders by Sub Area</strong>
                      {summary.bySubArea.length === 0 ? (
                        <p>No active orders.</p>
                      ) : (
                        summary.bySubArea.map((row) => (
                          <div key={row.subArea} className="row delivery-summary-row">
                            <div style={{ flex: 1 }}>{row.subArea}</div>
                            <div>{row.count}</div>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="card owner-packing-matrix-card">
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <strong>Item Packing Pairs</strong>
                        <button
                          className="btn secondary"
                          onClick={() =>
                            exportPackingMatrixCsv(
                              `${selectedAgentName.replace(/\s+/g, "_").toLowerCase()}_packing.csv`,
                              packingMatrix
                            )
                          }
                        >
                          Export to Excel
                        </button>
                      </div>
                      <div className="table-scroll">
                        <table className="payments-table owner-packing-matrix-table">
                          <thead>
                            <tr>
                              <th rowSpan={2}>Name</th>
                              {packingMatrix.itemNames.map((itemName, itemIndex) => (
                                <th
                                  key={itemName}
                                  colSpan={packingMatrix.itemPackQtyColumns[itemName]?.length || 1}
                                  className={`packing-group-header packing-group-${itemIndex % 5}`}
                                >
                                  {itemName}
                                </th>
                              ))}
                            </tr>
                            <tr>
                              {packingMatrix.itemNames.flatMap((itemName, itemIndex) =>
                                (packingMatrix.itemPackQtyColumns[itemName] || []).map((packQty) => (
                                  <th
                                    key={`${itemName}-${packQty}`}
                                    className={`packing-group-subheader packing-group-${itemIndex % 5}`}
                                  >
                                    Pack {packQty}
                                  </th>
                                ))
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {packingMatrix.rows.length === 0 && (
                              <tr>
                                <td
                                  colSpan={
                                    1 +
                                    packingMatrix.itemNames.reduce(
                                      (sum, itemName) =>
                                        sum + (packingMatrix.itemPackQtyColumns[itemName]?.length || 0),
                                      0
                                    )
                                  }
                                >
                                  No packing data
                                </td>
                              </tr>
                            )}
                            {packingMatrix.rows.map((row) => (
                              <tr key={row.key}>
                                <td className="packing-agent-cell">{row.agent}</td>
                                {packingMatrix.itemNames.flatMap((itemName, itemIndex) =>
                                  (packingMatrix.itemPackQtyColumns[itemName] || []).map((packQty) => (
                                    <td
                                      key={`${row.key}-${itemName}-${packQty}`}
                                      className={`packing-group-cell packing-group-${itemIndex % 5}`}
                                    >
                                      {row.items[itemName]?.[packQty] || "-"}
                                    </td>
                                  ))
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {tab === "orders" && (
                  <div className="stack delivery-orders-stack">
                    <div className="card delivery-summary-card">
                      Current Menu:{" "}
                      {currentPublishedMenu
                        ? `${formatOrderDate(currentPublishedMenu.date)} - ${
                            currentPublishedMenu.mealType || "Unknown"
                          }`
                        : "No live published menu"}
                    </div>
                    {activeOrders.length === 0 && <p>No active orders assigned.</p>}
                    {activeOrders.map((order) => (
                      <div
                        key={order.id}
                        className="card delivery-order-card"
                        style={{ position: "relative" }}
                      >
                        <div>
                          <strong>{order.customerName || "Customer"}</strong>
                          {order.phone ? ` | ${order.phone}` : ""}
                        </div>
                        <div>
                          Items:{" "}
                          {order.items?.map((item) => `${item.name} x${item.qty}`).join(", ") ||
                            "Items"}
                        </div>
                        <div>
                          Payment:{" "}
                          {isCashOnDeliveryOrder(order)
                            ? `Cash on Delivery - Rs. ${
                                typeof order.codBalance === "number"
                                  ? order.codBalance
                                  : order.total || 0
                              } due`
                            : "UPI"}
                        </div>
                        <div>Address: {order.address || "-"}</div>
                        <div>Area: {order.area || "Unknown"}</div>
                        <div>Sub Area: {order.subArea || "No sub area mapped"}</div>
                        <div className="row delivery-order-actions">
                          <a
                            className="btn secondary delivery-call-btn"
                            href={`tel:${order.phone || ""}`}
                            aria-label={`Call ${order.customerName || "customer"}`}
                            title="Call customer"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path
                                d="M6.6 10.8a15.5 15.5 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.2 11.2 0 0 0 3.5.56 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 11.2 11.2 0 0 0 .56 3.5 1 1 0 0 1-.25 1Z"
                                fill="currentColor"
                              />
                            </svg>
                          </a>
                          <button
                            className="btn secondary"
                            onClick={() =>
                              setOpenOrderActions(
                                openOrderActions === order.id ? null : order.id
                              )
                            }
                          >
                            Actions
                          </button>
                        </div>
                        {openOrderActions === order.id && (
                          <div className="card stack delivery-order-menu">
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
                                void markUndelivered(order, reason.trim());
                              }}
                            >
                              Mark Undelivered
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

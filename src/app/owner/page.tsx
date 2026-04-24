"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Autocomplete,
  GoogleMap,
  LoadScript,
  Marker,
} from "@react-google-maps/api";
import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

import { db, storage } from "@/lib/firebase";
import {
  changeOwnerPassword,
  ensureOwnerAccounts,
  loginOwner,
  normalizePhone,
  ownerExists,
  setDeliveryPassword,
} from "@/lib/auth";
import { clearSession, getSession, saveSession } from "@/lib/session";
import { getSubAreasForArea, isMappedSubArea } from "@/lib/subareas";

type Mode = "loading" | "setup" | "login" | "dashboard";
type Tab =
  | "menu"
  | "publish"
  | "dashboard"
  | "history"
  | "delivery"
  | "areas"
  | "createOrder";

type MenuItem = {
  id: string;
  name: string;
  price: number;
  mealType: string;
  description?: string;
  imageUrl?: string;
  active?: boolean;
};

type PublishedMenu = {
  id: string;
  date: string;
  mealType: string;
  items: {
    itemId: string;
    name: string;
    qty: number;
    price: number;
    description?: string;
    imageUrl?: string;
    active?: boolean;
  }[];
  remaining?: {
    itemId: string;
    name: string;
    qty: number;
    price: number;
    description?: string;
    imageUrl?: string;
    active?: boolean;
  }[];
  createdAt?: any;
  isArchived?: boolean;
  ordersStopped?: boolean;
};

type OrderItem = { name: string; qty: number; price: number };

type Order = {
  id: string;
  orderId?: string;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  customerName?: string;
  phone?: string;
  items?: OrderItem[];
  total?: number;
  deliveryType?: string;
  address?: string;
  area?: string;
  subArea?: string;
  publishedMenuId?: string;
  createdAt?: any;
  mealType?: string;
  publishedDate?: string;
  assignedAgentId?: string;
  assignedAgentName?: string;
  pickupPaymentStatus?: string;
  pickupAmountPaid?: number;
  pickupBalance?: number;
  pickupPaymentNotes?: string;
  pickupPaymentUpdatedAt?: any;
  pickupPaymentClosedAt?: any;
  manualAmountPaid?: number;
  manualBalance?: number;
  manualPaymentStatus?: string;
  manualPaymentNotes?: string;
  manualPaymentUpdatedAt?: any;
  manualPaymentClosedAt?: any;
  codPaymentStatus?: string;
  codAmountCollected?: number;
  codBalance?: number;
  codPaymentNotes?: string;
  codPaymentUpdatedAt?: any;
  codPaymentClosedAt?: any;
  codCollectedByAgentId?: string;
  codCollectedByAgentName?: string;
  orderSource?: string;
  location?: any;
  cancelledAt?: any;
  cancelledByPhone?: string;
  cancellationRemarks?: string;
  cancelledByOwner?: boolean;
};

type DeliveryAgent = {
  id: string;
  name: string;
  phone: string;
  active: boolean;
};

type ServiceArea = {
  id: string;
  name: string;
  deliveryFee?: number;
  subAreas?: string[];
};

type AreaAssignment = {
  id: string;
  agentIds: string[];
  lastIndex?: number;
  subAreaAgentIds?: Record<string, string[]>;
  subAreaLastIndex?: Record<string, number>;
  mealAgentIds?: Record<string, string[]>;
  mealLastIndex?: Record<string, number>;
  subAreaMealAgentIds?: Record<string, Record<string, string[]>>;
  subAreaMealLastIndex?: Record<string, Record<string, number>>;
};

type OrdersSummaryData = {
  totalOrders: number;
  totalItems: number;
  totalValue: number;
  upiValue: number;
  codValue: number;
  selfPickupValue: number;
  codOrders: number;
  itemCounts: Record<string, number>;
  itemPairCounts: Record<string, number>;
  byArea: Record<string, number>;
  byDelivery: Record<string, number>;
  byAgent: Record<string, number>;
};

const mealTypes = ["Breakfast", "Lunch", "Snacks", "Dinner"];
const deliveryAssignmentMeals = ["Lunch", "Dinner"] as const;
const fallbackAreas = ["Madipakkam", "Medavakkam", "Velachery"];
const mapContainerStyle = { width: "100%", height: "320px" };
const defaultCenter = { lat: 12.9716, lng: 80.2214 };

async function generateUniqueSixDigitOrderId() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const timestampPart = Date.now() % 100000;
    const randomPart = Math.floor(Math.random() * 10);
    const candidate = String(timestampPart * 10 + randomPart).padStart(6, "0");
    const existing = await getDocs(
      query(collection(db, "orders"), where("orderId", "==", candidate))
    );
    if (existing.empty) {
      return candidate;
    }
  }
  return String(Math.floor(100000 + Math.random() * 900000));
}

function formatDateKey(value: any) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value?.toDate) {
    return value.toDate().toISOString().slice(0, 10);
  }
  if (typeof value === "object" && "seconds" in value) {
    return new Date(value.seconds * 1000).toISOString().slice(0, 10);
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value);
}

function formatDateLabel(value: any) {
  const key = formatDateKey(value);
  if (!key) return "";
  const [year, month, day] = key.split("-");
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

function formatDateTimeLabel(value: any) {
  let ms = 0;
  if (!value) {
    ms = 0;
  } else if (value?.toDate) {
    ms = value.toDate().getTime();
  } else if (typeof value === "object" && "seconds" in value) {
    ms = value.seconds * 1000;
  } else if (value instanceof Date) {
    ms = value.getTime();
  } else if (typeof value === "number") {
    ms = value;
  } else {
    const parsed = Date.parse(String(value));
    ms = Number.isNaN(parsed) ? 0 : parsed;
  }
  if (!ms) return "";
  return new Date(ms).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function splitAddress(address: string) {
  const [addressLine1, ...rest] = String(address || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  return {
    addressLine1: addressLine1 || "",
    street: rest.join(", "),
  };
}

function formatLocationInput(location: any) {
  if (!location) return "";
  if (typeof location === "string") return location;
  if (typeof location === "object" && "lat" in location && "lng" in location) {
    return `${location.lat}, ${location.lng}`;
  }
  return String(location);
}

function getPublishedItemDraftKey(menuId: string, itemId: string) {
  return `${menuId}__${itemId}`;
}

function getWhatsAppPhone(rawPhone?: string) {
  const normalized = normalizePhone(String(rawPhone || ""));
  const digits = normalized.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.startsWith("91")) return digits;
  return digits;
}

function getOrderStatusLabel(order: Order) {
  if (order.status === "closed") {
    return order.deliveryType === "pickup" ? "Picked Up" : "Delivered";
  }
  if (order.status === "undelivered") {
    return "Undelivered";
  }
  if (order.status === "payment_pending") {
    return "Payment Pending";
  }
  if (order.deliveryType === "pickup" && order.pickupPaymentStatus === "paid") {
    return "Picked Up";
  }
  return "Active";
}

function isCashOnDeliveryOrder(order: Order) {
  return order.deliveryType === "delivery" && order.paymentMethod === "cash_on_delivery";
}

function isOwnerManualPaymentOrder(order: Order) {
  return (
    order.orderSource === "owner" &&
    (order.paymentMethod === "manual_pending" ||
      Boolean(order.manualPaymentStatus) ||
      order.paymentStatus === "manual_pending")
  );
}

function isPaymentStatusOrder(order: Order) {
  return (
    isOwnerManualPaymentOrder(order) ||
    (order.deliveryType === "pickup" &&
      (order.paymentMethod === "pay_at_outlet" ||
        order.paymentStatus === "pay_at_outlet" ||
        Boolean(order.pickupPaymentStatus))) ||
    isCashOnDeliveryOrder(order)
  );
}

function getPaymentStatusLabel(order: Order) {
  if (isOwnerManualPaymentOrder(order)) {
    return order.manualPaymentStatus || order.paymentStatus || "unpaid";
  }
  if (order.deliveryType === "pickup") {
    return order.pickupPaymentStatus || order.paymentStatus || "unpaid";
  }
  if (isCashOnDeliveryOrder(order)) {
    return order.codPaymentStatus || "unpaid";
  }
  return order.paymentStatus || "pending";
}

function getPaymentAmountPaid(order: Order) {
  if (isOwnerManualPaymentOrder(order)) {
    return order.manualAmountPaid || 0;
  }
  if (order.deliveryType === "pickup") {
    if (order.paymentStatus === "paid") {
      return order.total || 0;
    }
    return order.pickupAmountPaid || 0;
  }
  if (isCashOnDeliveryOrder(order)) {
    return order.codAmountCollected || 0;
  }
  return 0;
}

function getPaymentBalance(order: Order) {
  if (isOwnerManualPaymentOrder(order)) {
    return typeof order.manualBalance === "number" ? order.manualBalance : order.total || 0;
  }
  if (order.deliveryType === "pickup") {
    return typeof order.pickupBalance === "number"
      ? order.pickupBalance
      : order.total || 0;
  }
  if (isCashOnDeliveryOrder(order)) {
    return typeof order.codBalance === "number" ? order.codBalance : order.total || 0;
  }
  return 0;
}

function getPaymentNotes(order: Order) {
  if (isOwnerManualPaymentOrder(order)) {
    return order.manualPaymentNotes || "";
  }
  if (order.deliveryType === "pickup") {
    return order.pickupPaymentNotes || "";
  }
  if (isCashOnDeliveryOrder(order)) {
    return order.codPaymentNotes || "";
  }
  return "";
}

function getPaymentMethodLabel(order: Order) {
  if (isOwnerManualPaymentOrder(order)) {
    return "Manual";
  }
  if (order.deliveryType === "pickup") {
    if (
      order.paymentMethod === "upi" ||
      order.paymentMethod === "online" ||
      order.paymentStatus === "paid"
    ) {
      return "UPI";
    }
    return "Pay at Outlet";
  }
  if (isCashOnDeliveryOrder(order)) {
    return "Cash on Delivery";
  }
  if (order.paymentMethod === "upi" || order.paymentStatus === "paid") {
    return "UPI";
  }
  return order.paymentMethod || "-";
}

function buildOrdersSummary(operationalOrders: Order[]): OrdersSummaryData {
  const summary: OrdersSummaryData = {
    totalOrders: 0,
    totalItems: 0,
    totalValue: 0,
    upiValue: 0,
    codValue: 0,
    selfPickupValue: 0,
    codOrders: 0,
    itemCounts: {},
    itemPairCounts: {},
    byArea: {},
    byDelivery: {},
    byAgent: {},
  };

  operationalOrders.forEach((order) => {
    summary.totalOrders += 1;
    summary.totalItems += (order.items || []).reduce((sum, item) => sum + item.qty, 0);
    const orderTotal = order.total || 0;
    summary.totalValue += orderTotal;
    if (order.deliveryType === "pickup") {
      summary.selfPickupValue += orderTotal;
    } else if (isCashOnDeliveryOrder(order)) {
      summary.codValue += orderTotal;
    } else {
      summary.upiValue += orderTotal;
    }
    if (isCashOnDeliveryOrder(order)) {
      summary.codOrders += 1;
    }
    (order.items || []).forEach((item) => {
      summary.itemCounts[item.name] = (summary.itemCounts[item.name] || 0) + item.qty;
      const pairKey = `${item.name}__${item.qty}`;
      summary.itemPairCounts[pairKey] = (summary.itemPairCounts[pairKey] || 0) + 1;
    });
    const area = order.area || "Unknown";
    summary.byArea[area] = (summary.byArea[area] || 0) + 1;
    const deliveryType = order.deliveryType === "pickup" ? "Self Pickup" : "Home Delivery";
    summary.byDelivery[deliveryType] = (summary.byDelivery[deliveryType] || 0) + 1;
    const agent =
      order.deliveryType === "delivery" ? order.assignedAgentName || "Unassigned" : "Pickup";
    summary.byAgent[agent] = (summary.byAgent[agent] || 0) + 1;
  });

  return summary;
}

function buildAreaRows(summary: OrdersSummaryData) {
  return Object.entries(summary.byArea)
    .map(([area, count]) => ({ key: area, area, count }))
    .sort((a, b) => b.count - a.count || a.area.localeCompare(b.area));
}

function buildItemRows(summary: OrdersSummaryData) {
  return Object.entries(summary.itemCounts)
    .map(([itemName, count]) => ({ key: itemName, itemName, count }))
    .sort((a, b) => b.count - a.count || a.itemName.localeCompare(b.itemName));
}

function buildPackingMatrix(summary: OrdersSummaryData) {
  const packQtySet = new Set<number>();
  const grouped: Record<string, Record<number, number>> = {};

  Object.entries(summary.itemPairCounts).forEach(([pairKey, count]) => {
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

  return { packQtyColumns, rows };
}

function buildDeliveryTypeRows(summary: OrdersSummaryData) {
  return Object.entries(summary.byDelivery)
    .map(([deliveryType, count]) => ({ key: deliveryType, deliveryType, count }))
    .sort((a, b) => b.count - a.count || a.deliveryType.localeCompare(b.deliveryType));
}

function buildAgentDetailRows(operationalOrders: Order[]) {
  const grouped: Record<
    string,
    {
      key: string;
      agent: string;
      orders: number;
      totalItems: number;
      totalValue: number;
      areas: Record<string, number>;
      itemCounts: Record<string, number>;
    }
  > = {};

  operationalOrders.forEach((order) => {
    const agent =
      order.deliveryType === "delivery" ? order.assignedAgentName || "Unassigned" : "Pickup";

    if (!grouped[agent]) {
      grouped[agent] = {
        key: agent,
        agent,
        orders: 0,
        totalItems: 0,
        totalValue: 0,
        areas: {},
        itemCounts: {},
      };
    }

    grouped[agent].orders += 1;
    grouped[agent].totalItems += (order.items || []).reduce((sum, item) => sum + item.qty, 0);
    grouped[agent].totalValue += order.total || 0;
    const area = order.area || "Unknown";
    grouped[agent].areas[area] = (grouped[agent].areas[area] || 0) + 1;
    (order.items || []).forEach((item) => {
      grouped[agent].itemCounts[item.name] = (grouped[agent].itemCounts[item.name] || 0) + item.qty;
    });
  });

  return Object.values(grouped).sort((a, b) => b.orders - a.orders || a.agent.localeCompare(b.agent));
}

function buildCancelledOrderRows(cancelledOrders: Order[]) {
  return cancelledOrders
    .map((order) => ({
      id: order.id,
      orderId: order.orderId || order.id,
      customerName: order.customerName || "Customer",
      deliveryType: order.deliveryType === "pickup" ? "Self Pickup" : "Home Delivery",
      paymentMethod: getPaymentMethodLabel(order),
      paymentStatus:
        order.paymentStatus === "refund_pending" ? "Refund Pending" : order.paymentStatus || "-",
      total: order.total || 0,
      remarks: order.cancellationRemarks || "-",
      cancelledAt: order.cancelledAt || order.createdAt || order.publishedDate,
    }))
    .sort((a, b) => String(b.orderId).localeCompare(String(a.orderId)));
}

function getAssignmentMealKey(mealType?: string) {
  const normalized = String(mealType || "").trim().toLowerCase();
  if (normalized === "lunch") return "Lunch";
  if (normalized === "dinner") return "Dinner";
  return "";
}

function getAreaAgentIdsForMeal(assignmentData: any, mealType?: string) {
  const mealKey = getAssignmentMealKey(mealType);
  return mealKey
    ? assignmentData.mealAgentIds?.[mealKey] || assignmentData.agentIds || []
    : assignmentData.agentIds || [];
}

function getSubAreaAgentIdsForMeal(assignmentData: any, mealType: string | undefined, subArea: string) {
  const mealKey = getAssignmentMealKey(mealType);
  return mealKey
    ? assignmentData.subAreaMealAgentIds?.[mealKey]?.[subArea] ||
        assignmentData.subAreaAgentIds?.[subArea] ||
        []
    : assignmentData.subAreaAgentIds?.[subArea] || [];
}

function getAreaLastIndexForMeal(assignmentData: any, mealType?: string) {
  const mealKey = getAssignmentMealKey(mealType);
  if (mealKey) {
    return typeof assignmentData.mealLastIndex?.[mealKey] === "number"
      ? assignmentData.mealLastIndex[mealKey]
      : typeof assignmentData.lastIndex === "number"
        ? assignmentData.lastIndex
        : -1;
  }
  return typeof assignmentData.lastIndex === "number" ? assignmentData.lastIndex : -1;
}

function getSubAreaLastIndexForMeal(assignmentData: any, mealType: string | undefined, subArea: string) {
  const mealKey = getAssignmentMealKey(mealType);
  if (mealKey) {
    return typeof assignmentData.subAreaMealLastIndex?.[mealKey]?.[subArea] === "number"
      ? assignmentData.subAreaMealLastIndex[mealKey][subArea]
      : typeof assignmentData.subAreaLastIndex?.[subArea] === "number"
        ? assignmentData.subAreaLastIndex[subArea]
        : -1;
  }
  return typeof assignmentData.subAreaLastIndex?.[subArea] === "number"
    ? assignmentData.subAreaLastIndex[subArea]
    : -1;
}

export default function OwnerPage() {
  const [mode, setMode] = useState<Mode>("loading");
  const [tab, setTab] = useState<Tab>("menu");

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [publishedMenus, setPublishedMenus] = useState<PublishedMenu[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [deliveryAgents, setDeliveryAgents] = useState<DeliveryAgent[]>([]);
  const [serviceAreas, setServiceAreas] = useState<ServiceArea[]>([]);
  const [areaAssignments, setAreaAssignments] = useState<AreaAssignment[]>([]);
  const [selectedMenuIds, setSelectedMenuIds] = useState<string[]>([]);
  const [editingMenuId, setEditingMenuId] = useState<string | null>(null);
  const [editMenuForm, setEditMenuForm] = useState({
    name: "",
    price: "",
    mealType: "Lunch",
    description: "",
    imageUrl: "",
  });
  const [openMenuActionsId, setOpenMenuActionsId] = useState<string | null>(
    null
  );
  const [showMenuForm, setShowMenuForm] = useState(false);
  const [menuImageFile, setMenuImageFile] = useState<File | null>(null);
  const [menuImageUploading, setMenuImageUploading] = useState(false);
  const [menuSearch, setMenuSearch] = useState("");
  const [menuMealFilter, setMenuMealFilter] = useState("All");

  const [menuForm, setMenuForm] = useState({
    name: "",
    price: "",
    mealType: "Lunch",
    description: "",
    imageUrl: "",
  });

  const [publishForm, setPublishForm] = useState({
    date: "",
    mealType: "Lunch",
  });
  const [publishQty, setPublishQty] = useState<Record<string, number>>({});
  const [showPublishForm, setShowPublishForm] = useState(false);

  const [reportFilters, setReportFilters] = useState({
    search: "",
    startDate: "",
    endDate: "",
    area: "All",
    deliveryType: "All",
    trend: "weekly",
  });
  const [appliedReportFilters, setAppliedReportFilters] = useState({
    search: "",
    startDate: "",
    endDate: "",
    area: "All",
    deliveryType: "All",
    trend: "weekly",
  });

  const [agentForm, setAgentForm] = useState({
    name: "",
    phone: "",
    password: "",
  });
  const [showAgentForm, setShowAgentForm] = useState(false);
  const [openAgentActionsId, setOpenAgentActionsId] = useState<string | null>(
    null
  );
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [editMenuImageFile, setEditMenuImageFile] = useState<File | null>(null);
  const [editAgentForm, setEditAgentForm] = useState({
    name: "",
    phone: "",
    password: "",
  });
  const [publishError, setPublishError] = useState("");
  const [publishedMenuNotice, setPublishedMenuNotice] = useState("");
  const [editingPublishedMenuDateId, setEditingPublishedMenuDateId] = useState<string | null>(
    null
  );
  const [publishedMenuDateDraft, setPublishedMenuDateDraft] = useState("");
  const [publishedMenuAddItem, setPublishedMenuAddItem] = useState<
    Record<string, { itemId: string; qty: string }>
  >({});
  const [areaForm, setAreaForm] = useState("");
  const [areaFeeForm, setAreaFeeForm] = useState("");
  const [areaSearch, setAreaSearch] = useState("");
  const [areaSubAreaDrafts, setAreaSubAreaDrafts] = useState<Record<string, string>>({});
  const [editingAreaSubAreaKey, setEditingAreaSubAreaKey] = useState<string | null>(null);
  const [areaSubAreaEditDrafts, setAreaSubAreaEditDrafts] = useState<Record<string, string>>({});
  const [showNav, setShowNav] = useState(false);
  const [historyTab, setHistoryTab] = useState<
    "summary" | "activeOrders" | "pastOrders" | "paymentStatus"
  >("summary");
  const [deliveryTab, setDeliveryTab] = useState<"agents" | "assignments">(
    "agents"
  );
  const [assignmentMeal, setAssignmentMeal] =
    useState<(typeof deliveryAssignmentMeals)[number]>("Lunch");
  const [openAssignmentArea, setOpenAssignmentArea] = useState<string | null>(
    null
  );
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    current: "",
    next: "",
  });
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [activeOrderSearch, setActiveOrderSearch] = useState("");
  const [activeOrderAreaFilter, setActiveOrderAreaFilter] = useState("All");
  const [activeOrderDeliveryFilter, setActiveOrderDeliveryFilter] = useState("All");
  const [activeOrderStatusFilter, setActiveOrderStatusFilter] = useState("All");
  const [pastOrderSearch, setPastOrderSearch] = useState("");
  const [pastOrderAreaFilter, setPastOrderAreaFilter] = useState("All");
  const [pastOrderDeliveryFilter, setPastOrderDeliveryFilter] = useState("All");
  const [pastOrderStatusFilter, setPastOrderStatusFilter] = useState("All");
  const [selectedPastMenuKey, setSelectedPastMenuKey] = useState("");
  const [placedNotificationSentIds, setPlacedNotificationSentIds] = useState<string[]>([]);
  const [openActiveOrderActionsId, setOpenActiveOrderActionsId] = useState<string | null>(null);
  const [editingActiveOrderId, setEditingActiveOrderId] = useState<string | null>(
    null
  );
  const [cancellingOwnerOrderId, setCancellingOwnerOrderId] = useState<string | null>(null);
  const [activeOrderEditError, setActiveOrderEditError] = useState("");
  const [ownerCancelError, setOwnerCancelError] = useState("");
  const [ownerCancelRemarks, setOwnerCancelRemarks] = useState("");
  const [activeOrderEditForm, setActiveOrderEditForm] = useState({
    customerName: "",
    phone: "",
    deliveryType: "pickup",
    addressLine1: "",
    street: "",
    area: "",
    subArea: "",
    location: "",
    assignedAgentId: "",
    status: "active",
  });

  useEffect(() => {
    if (!openActiveOrderActionsId) {
      return;
    }

    const handleOutsideOrderActions = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-owner-order-actions]")) {
        return;
      }
      setOpenActiveOrderActionsId(null);
    };

    document.addEventListener("mousedown", handleOutsideOrderActions);
    return () => {
      document.removeEventListener("mousedown", handleOutsideOrderActions);
    };
  }, [openActiveOrderActionsId]);
  const [editPublishQty, setEditPublishQty] = useState<Record<string, number>>({});
  const [editPublishPrice, setEditPublishPrice] = useState<Record<string, number>>({});
  const [pickupPaymentFilters, setPickupPaymentFilters] = useState({
    startDate: "",
    endDate: "",
    search: "",
  });
  const [editingPickupPaymentId, setEditingPickupPaymentId] = useState<
    string | null
  >(null);
  const [pickupPaymentForm, setPickupPaymentForm] = useState({
    amount: "",
    notes: "",
  });
  const [ownerOrderMenuId, setOwnerOrderMenuId] = useState("");
  const [ownerOrderError, setOwnerOrderError] = useState("");
  const [ownerOrderSuccess, setOwnerOrderSuccess] = useState("");
  const [ownerOrderSubmitting, setOwnerOrderSubmitting] = useState(false);
  const [ownerOrderLocation, setOwnerOrderLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [ownerOrderLocLabel, setOwnerOrderLocLabel] = useState("");
  const [ownerOrderLocError, setOwnerOrderLocError] = useState("");
  const [ownerOrderForm, setOwnerOrderForm] = useState({
    name: "",
    phone: "",
    deliveryType: "pickup",
    addressLine1: "",
    street: "",
    area: "",
    subArea: "",
    preferredAgentId: "",
  });
  const [ownerOrderQty, setOwnerOrderQty] = useState<Record<string, number>>({});
  const ownerOrderAutocompleteRef =
    useRef<google.maps.places.Autocomplete | null>(null);

  function showPublishedMenuNotice(message: string) {
    setPublishedMenuNotice(message);
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        setPublishedMenuNotice((current) => (current === message ? "" : current));
      }, 1800);
    }
  }

  async function uploadMenuImage(file: File) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `menu_images/${Date.now()}_${safeName}`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    return getDownloadURL(storageRef);
  }

  const areaOptions = serviceAreas.length
    ? serviceAreas.map((area) => area.name)
    : fallbackAreas;

  const filteredServiceAreas = useMemo(() => {
    const search = areaSearch.trim().toLowerCase();
    if (!search) return serviceAreas;
    return serviceAreas.filter((area) => area.name.toLowerCase().includes(search));
  }, [serviceAreas, areaSearch]);
  const subAreaOptionsByArea = useMemo(() => {
    const map: Record<string, string[]> = {};
    serviceAreas.forEach((area) => {
      map[area.name] = Array.from(
        new Set([...(getSubAreasForArea(area.name) || []), ...((area.subAreas || []).filter(Boolean))])
      ).sort((a, b) => a.localeCompare(b));
    });
    return map;
  }, [serviceAreas]);
  const ownerOrderSubAreaOptions = useMemo(
    () => subAreaOptionsByArea[ownerOrderForm.area] || [],
    [subAreaOptionsByArea, ownerOrderForm.area]
  );
  const activeOrderEditSubAreaOptions = useMemo(
    () => subAreaOptionsByArea[activeOrderEditForm.area] || [],
    [subAreaOptionsByArea, activeOrderEditForm.area]
  );

  const agentNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    deliveryAgents.forEach((agent) => {
      map[agent.id] = agent.name;
    });
    return map;
  }, [deliveryAgents]);

  const areaAssignmentMap = useMemo(() => {
    const map: Record<string, AreaAssignment> = {};
    areaAssignments.forEach((assignment) => {
      map[assignment.id] = assignment;
    });
    return map;
  }, [areaAssignments]);
  const unassignedCustomSubAreas = useMemo(() => {
    const mealKey = getAssignmentMealKey(assignmentMeal);
    return serviceAreas.flatMap((area) =>
      ((area.subAreas || []).filter(Boolean) || [])
        .filter((subArea) => !isMappedSubArea(area.name, subArea))
        .filter(
          (subArea) =>
            (
              mealKey
                ? areaAssignmentMap[area.name]?.subAreaMealAgentIds?.[mealKey]?.[subArea] ||
                  areaAssignmentMap[area.name]?.subAreaAgentIds?.[subArea] ||
                  []
                : areaAssignmentMap[area.name]?.subAreaAgentIds?.[subArea] || []
            ).length === 0
        )
        .sort((a, b) => a.localeCompare(b))
        .map((subArea) => ({
          area: area.name,
          subArea,
        }))
    );
  }, [serviceAreas, areaAssignmentMap, assignmentMeal]);

  function getCreatedAtMs(value: any) {
    if (!value) return 0;
    if (value?.toDate) return value.toDate().getTime();
    if (typeof value === "object" && "seconds" in value) {
      return value.seconds * 1000;
    }
    if (value instanceof Date) return value.getTime();
    return 0;
  }

  function onOwnerOrderAutocompleteLoad(ac: google.maps.places.Autocomplete) {
    ownerOrderAutocompleteRef.current = ac;
  }

  function onOwnerOrderPlaceChanged() {
    const ac = ownerOrderAutocompleteRef.current;
    if (!ac) return;
    const place = ac.getPlace();
    if (!place.geometry?.location) return;
    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();
    setOwnerOrderLocError("");
    setOwnerOrderLocation({ lat, lng });
    setOwnerOrderLocLabel(place.formatted_address || place.name || "Location selected");
  }

  function useOwnerCurrentLocation() {
    setOwnerOrderLocError("");
    if (!navigator.geolocation) {
      setOwnerOrderLocError("Geolocation is not supported on this device.");
      return;
    }
    setOwnerOrderLocLabel("Fetching current location...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOwnerOrderLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setOwnerOrderLocLabel("Current location selected");
      },
      () => {
        setOwnerOrderLocError("Unable to fetch current location.");
        setOwnerOrderLocLabel("");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  useEffect(() => {
    async function loadOwnerAuth() {
      const session = getSession();
      if (session?.role === "owner") {
        setMode("dashboard");
        return;
      }
      await ensureOwnerAccounts();
      const exists = await ownerExists();
      setMode(exists ? "login" : "setup");
    }
    loadOwnerAuth();
  }, []);

  useEffect(() => {
    if (mode !== "dashboard") return;
    const unsubMenu = onSnapshot(
      query(collection(db, "menu_items"), orderBy("name", "asc")),
      (snap) => {
        setMenuItems(
          snap.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as any),
          }))
        );
      }
    );
    const unsubPublished = onSnapshot(
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
    const unsubAgents = onSnapshot(
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
    const unsubAreas = onSnapshot(
      query(collection(db, "service_areas"), orderBy("name", "asc")),
      (snap) => {
        setServiceAreas(
          snap.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as any),
          }))
        );
      }
    );
    const unsubAssignments = onSnapshot(
      collection(db, "area_assignments"),
      (snap) => {
        setAreaAssignments(
          snap.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as any),
          }))
        );
      }
    );
    return () => {
      unsubMenu();
      unsubPublished();
      unsubOrders();
      unsubAgents();
      unsubAreas();
      unsubAssignments();
    };
  }, [mode]);

  async function addMenuItem() {
    if (!menuForm.name || !menuForm.price || !menuForm.mealType) return;
    let imageUrl = menuForm.imageUrl.trim();
    if (menuImageFile) {
      setMenuImageUploading(true);
      try {
        imageUrl = await uploadMenuImage(menuImageFile);
      } finally {
        setMenuImageUploading(false);
      }
    }
    await addDoc(collection(db, "menu_items"), {
      name: menuForm.name.trim(),
      price: Number(menuForm.price),
      mealType: menuForm.mealType,
      description: menuForm.description.trim(),
      imageUrl,
      active: true,
      createdAt: serverTimestamp(),
    });
    setMenuForm({
      name: "",
      price: "",
      mealType: "Lunch",
      description: "",
      imageUrl: "",
    });
    setMenuImageFile(null);
  }

  async function updateMenuItem(id: string, data: Partial<MenuItem>) {
    await updateDoc(doc(db, "menu_items", id), data as any);
  }

  async function deleteMenuItem(id: string) {
    const confirmed = window.confirm("Delete this menu item?");
    if (!confirmed) return;
    await deleteDoc(doc(db, "menu_items", id));
  }

  function toggleMenuSelection(id: string) {
    setSelectedMenuIds((prev) =>
      prev.includes(id) ? prev.filter((itemId) => itemId !== id) : [...prev, id]
    );
  }

  function startEditMenu(item: MenuItem) {
    setEditingMenuId(item.id);
    setEditMenuForm({
      name: item.name,
      price: String(item.price),
      mealType: item.mealType || "Lunch",
      description: item.description || "",
      imageUrl: item.imageUrl || "",
    });
    setOpenMenuActionsId(null);
  }

  async function saveEditMenu() {
    if (!editingMenuId) return;
    if (!editMenuForm.name || !editMenuForm.price || !editMenuForm.mealType) {
      return;
    }
    let imageUrl = editMenuForm.imageUrl.trim();
    if (editMenuImageFile) {
      setMenuImageUploading(true);
      try {
        imageUrl = await uploadMenuImage(editMenuImageFile);
      } finally {
        setMenuImageUploading(false);
      }
    }
    await updateMenuItem(editingMenuId, {
      name: editMenuForm.name.trim(),
      price: Number(editMenuForm.price),
      mealType: editMenuForm.mealType,
      description: editMenuForm.description.trim(),
      imageUrl,
    });
    setEditMenuImageFile(null);
    setEditingMenuId(null);
  }

  function cancelEditMenu() {
    setEditMenuImageFile(null);
    setEditingMenuId(null);
  }

  function openCheckoutSelected() {
    const initialQty: Record<string, number> = {};
    selectedMenuIds.forEach((id) => {
      initialQty[id] = publishQty[id] || 0;
    });
    setPublishQty((prev) => ({ ...prev, ...initialQty }));
    setShowPublishForm(true);
  }

  async function publishMenu() {
    setPublishError("");
    if (!publishForm.date || !publishForm.mealType) {
      setPublishError("Please select date and meal type.");
      return;
    }
    const items = menuItems
      .filter((item) =>
        selectedMenuIds.length ? selectedMenuIds.includes(item.id) : true
      )
      .map((item) => ({
        itemId: item.id,
        name: item.name,
        price: item.price,
        description: item.description || "",
        imageUrl: item.imageUrl || "",
        qty: publishQty[item.id] || 0,
        active: true,
      }))
      .filter((item) => item.qty > 0);
    if (!items.length) {
      setPublishError("Please enter quantity for at least one item.");
      return;
    }
    await addDoc(collection(db, "published_menus"), {
      date: publishForm.date,
      mealType: publishForm.mealType,
      items,
      remaining: items,
      isArchived: false,
      ordersStopped: false,
      createdAt: serverTimestamp(),
    });
    setPublishQty({});
    setSelectedMenuIds([]);
    setShowPublishForm(false);
  }

  async function addDeliveryAgent() {
    if (!agentForm.name || !agentForm.phone || !agentForm.password) return;
    const normalizedPhone = normalizePhone(agentForm.phone);
    const ref = doc(db, "delivery_agents", normalizedPhone);
    await setDoc(ref, {
      name: agentForm.name.trim(),
      phone: normalizedPhone,
      username: normalizedPhone,
      active: true,
      createdAt: serverTimestamp(),
    });
    await setDeliveryPassword(normalizedPhone, agentForm.password);
    setAgentForm({
      name: "",
      phone: "",
      password: "",
    });
    setShowAgentForm(false);
  }

  async function updateDeliveryAgent(id: string, data: Partial<DeliveryAgent>) {
    await updateDoc(doc(db, "delivery_agents", id), data as any);
  }

  async function deleteDeliveryAgent(id: string) {
    const confirmed = window.confirm("Delete this delivery agent?");
    if (!confirmed) return;
    await deleteDoc(doc(db, "delivery_agents", id));
  }

  async function saveAgentEdits(agent: DeliveryAgent) {
    const newPhone = normalizePhone(editAgentForm.phone || agent.phone);
    const payload = {
      name: editAgentForm.name.trim(),
      phone: newPhone,
      username: newPhone,
      active: agent.active,
    };
    if (newPhone !== agent.id) {
      await setDoc(doc(db, "delivery_agents", newPhone), payload);
      await deleteDoc(doc(db, "delivery_agents", agent.id));
    } else {
      await updateDoc(doc(db, "delivery_agents", agent.id), payload as any);
    }
    if (editAgentForm.password) {
      await setDeliveryPassword(newPhone, editAgentForm.password);
    }
    setEditingAgentId(null);
    setEditAgentForm({
      name: "",
      phone: "",
      password: "",
    });
  }

  async function addServiceArea() {
    if (!areaForm.trim()) return;
    await addDoc(collection(db, "service_areas"), {
      name: areaForm.trim(),
      deliveryFee: Number(areaFeeForm || 0),
      createdAt: serverTimestamp(),
    });
    setAreaForm("");
    setAreaFeeForm("");
  }

  async function deleteServiceArea(id: string) {
    const confirmed = window.confirm("Delete this area?");
    if (!confirmed) return;
    await deleteDoc(doc(db, "service_areas", id));
  }

  async function updateServiceAreaFee(id: string, deliveryFee: number) {
    await updateDoc(doc(db, "service_areas", id), {
      deliveryFee: Number.isFinite(deliveryFee) ? deliveryFee : 0,
    });
  }

  async function addServiceSubArea(area: ServiceArea) {
    const nextSubArea = (areaSubAreaDrafts[area.id] || "").trim();
    if (!nextSubArea) {
      return;
    }
    const existingSubAreas = subAreaOptionsByArea[area.name] || [];
    const alreadyExists = existingSubAreas.some(
      (subArea) => subArea.toLowerCase() === nextSubArea.toLowerCase()
    );
    if (!alreadyExists) {
      await updateDoc(doc(db, "service_areas", area.id), {
        subAreas: arrayUnion(nextSubArea),
        updatedAt: serverTimestamp(),
      });
    }
    setAreaSubAreaDrafts((prev) => ({
      ...prev,
      [area.id]: "",
    }));
  }

  function openServiceSubAreaEdit(area: ServiceArea, subArea: string) {
    const editKey = `${area.id}::${subArea}`;
    setEditingAreaSubAreaKey(editKey);
    setAreaSubAreaEditDrafts((prev) => ({
      ...prev,
      [editKey]: subArea,
    }));
  }

  async function saveServiceSubAreaEdit(area: ServiceArea, previousSubArea: string) {
    const editKey = `${area.id}::${previousSubArea}`;
    const nextSubArea = (areaSubAreaEditDrafts[editKey] || "").trim();
    if (!nextSubArea) {
      return;
    }
    if (nextSubArea === previousSubArea) {
      setEditingAreaSubAreaKey(null);
      return;
    }
    const existingSubAreas = subAreaOptionsByArea[area.name] || [];
    const alreadyExists = existingSubAreas.some(
      (subArea) =>
        subArea.toLowerCase() === nextSubArea.toLowerCase() &&
        subArea.toLowerCase() !== previousSubArea.toLowerCase()
    );
    if (alreadyExists) {
      window.alert("This sub area already exists.");
      return;
    }

    const storedSubAreas = area.subAreas || [];
    const nextStoredSubAreas = storedSubAreas.map((subArea) =>
      subArea === previousSubArea ? nextSubArea : subArea
    );
    await updateDoc(doc(db, "service_areas", area.id), {
      subAreas: nextStoredSubAreas,
      updatedAt: serverTimestamp(),
    });

    const assignment = areaAssignmentMap[area.name];
    if (assignment?.id) {
      const assignmentUpdates: Record<string, any> = {
        updatedAt: serverTimestamp(),
      };
      if (assignment.subAreaAgentIds?.[previousSubArea]) {
        assignmentUpdates.subAreaAgentIds = Object.fromEntries(
          Object.entries(assignment.subAreaAgentIds).map(([key, value]) => [
            key === previousSubArea ? nextSubArea : key,
            value,
          ])
        );
      }
      if (assignment.subAreaLastIndex?.[previousSubArea] !== undefined) {
        assignmentUpdates.subAreaLastIndex = Object.fromEntries(
          Object.entries(assignment.subAreaLastIndex || {}).map(([key, value]) => [
            key === previousSubArea ? nextSubArea : key,
            value,
          ])
        );
      }
      if (assignment.subAreaMealAgentIds) {
        assignmentUpdates.subAreaMealAgentIds = Object.fromEntries(
          Object.entries(assignment.subAreaMealAgentIds).map(([meal, mealMap]) => [
            meal,
            Object.fromEntries(
              Object.entries(mealMap || {}).map(([key, value]) => [
                key === previousSubArea ? nextSubArea : key,
                value,
              ])
            ),
          ])
        );
      }
      if (assignment.subAreaMealLastIndex) {
        assignmentUpdates.subAreaMealLastIndex = Object.fromEntries(
          Object.entries(assignment.subAreaMealLastIndex).map(([meal, mealMap]) => [
            meal,
            Object.fromEntries(
              Object.entries(mealMap || {}).map(([key, value]) => [
                key === previousSubArea ? nextSubArea : key,
                value,
              ])
            ),
          ])
        );
      }
      await updateDoc(doc(db, "area_assignments", assignment.id), assignmentUpdates);
    }

    const ordersSnapshot = await getDocs(
      query(
        collection(db, "orders"),
        where("area", "==", area.name),
        where("subArea", "==", previousSubArea)
      )
    );
    await Promise.all(
      ordersSnapshot.docs.map((orderDoc) =>
        updateDoc(orderDoc.ref, {
          subArea: nextSubArea,
          updatedAt: serverTimestamp(),
        })
      )
    );

    setEditingAreaSubAreaKey(null);
    setAreaSubAreaEditDrafts((prev) => ({
      ...prev,
      [editKey]: nextSubArea,
    }));
  }

  function runReport() {
    setAppliedReportFilters({ ...reportFilters });
  }

  async function updatePublishedMenuItem(
    menu: PublishedMenu,
    itemId: string,
    updates: { active?: boolean; qty?: number; price?: number }
  ) {
    const items = (menu.items || []).map((item) => {
      if (item.itemId !== itemId) return { ...item, active: item.active !== false };
      const nextQty =
        typeof updates.qty === "number" && Number.isFinite(updates.qty)
          ? Math.max(0, updates.qty)
          : item.qty;
      const nextPrice =
        typeof updates.price === "number" && Number.isFinite(updates.price)
          ? Math.max(0, updates.price)
          : item.price;
      const nextActive =
        typeof updates.active === "boolean" ? updates.active : item.active !== false;
      return {
        ...item,
        qty: nextQty,
        price: nextPrice,
        active: nextActive,
      };
    });

    const remaining = (menu.remaining || menu.items || []).map((item) => {
      const sourceItem = (menu.items || []).find((menuItem) => menuItem.itemId === item.itemId);
      const sourceQty = sourceItem?.qty ?? item.qty;
      const soldQty = Math.max(0, sourceQty - (item.qty || 0));
      if (item.itemId !== itemId) {
        return { ...item, active: item.active !== false };
      }
      const nextQty =
        typeof updates.qty === "number" && Number.isFinite(updates.qty)
          ? Math.max(0, updates.qty)
          : sourceQty;
      const nextPrice =
        typeof updates.price === "number" && Number.isFinite(updates.price)
          ? Math.max(0, updates.price)
          : item.price;
      const nextActive =
        typeof updates.active === "boolean" ? updates.active : item.active !== false;
      return {
        ...item,
        qty: Math.max(0, nextQty - soldQty),
        price: nextPrice,
        active: nextActive,
      };
    });

    await updateDoc(doc(db, "published_menus", menu.id), {
      items,
      remaining,
      updatedAt: serverTimestamp(),
    });
  }

  async function savePublishedMenuItemDetails(
    menu: PublishedMenu,
    item: PublishedMenu["items"][number]
  ) {
    const draftKey = getPublishedItemDraftKey(menu.id, item.itemId);
    const draftQty = editPublishQty[draftKey];
    const draftPrice = editPublishPrice[draftKey];
    const nextQty = typeof draftQty === "number" ? draftQty : item.qty;
    const nextPrice = typeof draftPrice === "number" ? draftPrice : item.price;
    if (nextQty === item.qty && nextPrice === item.price) {
      return;
    }
    await updatePublishedMenuItem(menu, item.itemId, {
      qty: nextQty,
      price: nextPrice,
    });
    setEditPublishQty((prev) => {
      const next = { ...prev };
      delete next[draftKey];
      return next;
    });
    setEditPublishPrice((prev) => {
      const next = { ...prev };
      delete next[draftKey];
      return next;
    });
    showPublishedMenuNotice("Item updated");
  }

  async function addItemToPublishedMenu(menu: PublishedMenu) {
    const draft = publishedMenuAddItem[menu.id] || { itemId: "", qty: "" };
    const itemId = draft.itemId;
    const qty = Math.max(0, Number(draft.qty || 0));

    if (!itemId) {
      window.alert("Select an item to add.");
      return;
    }
    if (!qty) {
      window.alert("Enter quantity greater than 0.");
      return;
    }

    const sourceItem = menuItems.find((item) => item.id === itemId);
    if (!sourceItem) {
      window.alert("Selected item not found.");
      return;
    }

    const existingItem = (menu.items || []).find((item) => item.itemId === itemId);
    if (existingItem) {
      await updatePublishedMenuItem(menu, itemId, {
        active: true,
        qty: existingItem.qty + qty,
      });
      showPublishedMenuNotice("Item quantity increased");
    } else {
      const nextItem = {
        itemId: sourceItem.id,
        name: sourceItem.name,
        qty,
        price: sourceItem.price,
        description: sourceItem.description || "",
        imageUrl: sourceItem.imageUrl || "",
        active: true,
      };
      await updateDoc(doc(db, "published_menus", menu.id), {
        items: [...(menu.items || []), nextItem],
        remaining: [...(menu.remaining || menu.items || []), nextItem],
        updatedAt: serverTimestamp(),
      });
      showPublishedMenuNotice("Item added to menu");
    }

    setPublishedMenuAddItem((prev) => ({
      ...prev,
      [menu.id]: { itemId: "", qty: "" },
    }));
  }

  async function saveAreaAssignment(areaName: string, agentIds: string[], mealType = assignmentMeal) {
    const existing = areaAssignmentMap[areaName];
    const ref = doc(db, "area_assignments", areaName);
    const mealKey = getAssignmentMealKey(mealType);
    const nextAssignment = {
      id: areaName,
      agentIds: existing?.agentIds || [],
      lastIndex: typeof existing?.lastIndex === "number" ? existing.lastIndex : -1,
      subAreaAgentIds: existing?.subAreaAgentIds || {},
      subAreaLastIndex: existing?.subAreaLastIndex || {},
      mealAgentIds: {
        ...(existing?.mealAgentIds || {}),
        ...(mealKey ? { [mealKey]: agentIds } : {}),
      },
      mealLastIndex: {
        ...(existing?.mealLastIndex || {}),
        ...(mealKey
          ? {
              [mealKey]:
                typeof existing?.mealLastIndex?.[mealKey] === "number"
                  ? existing.mealLastIndex[mealKey]
                  : -1,
            }
          : {}),
      },
      subAreaMealAgentIds: existing?.subAreaMealAgentIds || {},
      subAreaMealLastIndex: existing?.subAreaMealLastIndex || {},
    };
    await setDoc(
      ref,
      {
        agentIds: nextAssignment.agentIds,
        lastIndex: nextAssignment.lastIndex,
        subAreaAgentIds: nextAssignment.subAreaAgentIds,
        subAreaLastIndex: nextAssignment.subAreaLastIndex,
        mealAgentIds: nextAssignment.mealAgentIds,
        mealLastIndex: nextAssignment.mealLastIndex,
        subAreaMealAgentIds: nextAssignment.subAreaMealAgentIds,
        subAreaMealLastIndex: nextAssignment.subAreaMealLastIndex,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    await reassignOrdersForArea(areaName, nextAssignment, mealType);
  }

  async function saveSubAreaAssignment(
    areaName: string,
    subArea: string,
    agentIds: string[],
    mealType = assignmentMeal
  ) {
    const existing = areaAssignmentMap[areaName];
    const ref = doc(db, "area_assignments", areaName);
    const mealKey = getAssignmentMealKey(mealType);
    const nextAssignment = {
      id: areaName,
      agentIds: existing?.agentIds || [],
      lastIndex: typeof existing?.lastIndex === "number" ? existing.lastIndex : -1,
      subAreaAgentIds: {
        ...(existing?.subAreaAgentIds || {}),
        [subArea]: agentIds,
      },
      subAreaLastIndex: {
        ...(existing?.subAreaLastIndex || {}),
        [subArea]:
          typeof existing?.subAreaLastIndex?.[subArea] === "number"
            ? existing.subAreaLastIndex[subArea]
            : -1,
      },
      mealAgentIds: existing?.mealAgentIds || {},
      mealLastIndex: existing?.mealLastIndex || {},
      subAreaMealAgentIds: {
        ...(existing?.subAreaMealAgentIds || {}),
        ...(mealKey
          ? {
              [mealKey]: {
                ...(existing?.subAreaMealAgentIds?.[mealKey] || {}),
                [subArea]: agentIds,
              },
            }
          : {}),
      },
      subAreaMealLastIndex: {
        ...(existing?.subAreaMealLastIndex || {}),
        ...(mealKey
          ? {
              [mealKey]: {
                ...(existing?.subAreaMealLastIndex?.[mealKey] || {}),
                [subArea]:
                  typeof existing?.subAreaMealLastIndex?.[mealKey]?.[subArea] === "number"
                    ? existing.subAreaMealLastIndex[mealKey][subArea]
                    : -1,
              },
            }
          : {}),
      },
    };
    await setDoc(
      ref,
      {
        agentIds: nextAssignment.agentIds,
        lastIndex: nextAssignment.lastIndex,
        subAreaAgentIds: nextAssignment.subAreaAgentIds,
        subAreaLastIndex: nextAssignment.subAreaLastIndex,
        mealAgentIds: nextAssignment.mealAgentIds,
        mealLastIndex: nextAssignment.mealLastIndex,
        subAreaMealAgentIds: nextAssignment.subAreaMealAgentIds,
        subAreaMealLastIndex: nextAssignment.subAreaMealLastIndex,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    await reassignOrdersForArea(areaName, nextAssignment, mealType);
  }

  async function handleOwnerLogin() {
    setLoginError("");
    if (!loginForm.username || !loginForm.password) {
      setLoginError("Enter username and password");
      return;
    }
    const raw = loginForm.username.trim();
    const candidates = new Set<string>();
    candidates.add(raw);
    const normalized = normalizePhone(raw);
    candidates.add(normalized);
    if (raw.startsWith("+91")) {
      candidates.add(raw.replace("+91", ""));
    }
    if (raw.startsWith("91") && raw.length === 12) {
      candidates.add(raw.substring(2));
    }
    for (const candidate of candidates) {
      try {
        await loginOwner(candidate, loginForm.password);
        saveSession({ role: "owner", username: candidate });
        setMode("dashboard");
        return;
      } catch {
        // try next candidate
      }
    }
    setLoginError("Invalid credentials");
  }

  function handleOwnerLogout() {
    clearSession();
    setMode("login");
  }

  async function handleChangePassword() {
    setPasswordError("");
    setPasswordSuccess("");
    const session = getSession();
    if (!session?.username) {
      setPasswordError("No active session");
      return;
    }
    if (!passwordForm.current || !passwordForm.next) {
      setPasswordError("Enter current and new password");
      return;
    }
    try {
      await loginOwner(session.username, passwordForm.current);
      await changeOwnerPassword(session.username, passwordForm.next);
      setPasswordSuccess("Password updated");
      setPasswordForm({ current: "", next: "" });
      setShowPasswordForm(false);
    } catch {
      setPasswordError("Current password is incorrect");
    }
  }

  async function reassignOrdersForArea(
    areaName: string,
    assignment?: AreaAssignment,
    mealType?: string
  ) {
    const relevantOrders = orders
      .filter(
        (order) =>
          (order.area || "Unknown") === areaName &&
          order.status !== "closed" &&
          order.status !== "cancelled" &&
          (!mealType || getAssignmentMealKey(order.mealType) === getAssignmentMealKey(mealType))
      )
      .sort((a, b) => getCreatedAtMs(a.createdAt) - getCreatedAtMs(b.createdAt));
    if (!relevantOrders.length) return;
    const currentAssignment = assignment || areaAssignmentMap[areaName] || {
      id: areaName,
      agentIds: [],
      lastIndex: -1,
      subAreaAgentIds: {},
      subAreaLastIndex: {},
    };
    const mealKey = getAssignmentMealKey(mealType);
    let areaLastIndex = mealKey
      ? typeof currentAssignment.mealLastIndex?.[mealKey] === "number"
        ? currentAssignment.mealLastIndex[mealKey]
        : typeof currentAssignment.lastIndex === "number"
          ? currentAssignment.lastIndex
          : -1
      : typeof currentAssignment.lastIndex === "number"
        ? currentAssignment.lastIndex
        : -1;
    const nextSubAreaLastIndex = { ...(currentAssignment.subAreaLastIndex || {}) };
    const nextSubAreaMealLastIndex = { ...(currentAssignment.subAreaMealLastIndex || {}) };
    if (mealKey && !nextSubAreaMealLastIndex[mealKey]) {
      nextSubAreaMealLastIndex[mealKey] = {};
    }
    await Promise.all(
      relevantOrders.map((order) => {
        const subArea = order.subArea || "";
        const subAreaAgentIds = getSubAreaAgentIdsForMeal(currentAssignment, order.mealType, subArea);
        const requiresOwnerAssignment =
          Boolean(subArea) &&
          !isMappedSubArea(areaName, subArea) &&
          subAreaAgentIds.length === 0;
        let assignmentPool = subAreaAgentIds;
        let agentId = "";
        if (assignmentPool.length > 0) {
          const lastIndex = mealKey
            ? typeof nextSubAreaMealLastIndex[mealKey]?.[subArea] === "number"
              ? nextSubAreaMealLastIndex[mealKey][subArea]
              : typeof nextSubAreaLastIndex[subArea] === "number"
                ? nextSubAreaLastIndex[subArea]
                : -1
            : typeof nextSubAreaLastIndex[subArea] === "number"
              ? nextSubAreaLastIndex[subArea]
              : -1;
          const nextIndex = (lastIndex + 1) % assignmentPool.length;
          if (mealKey) {
            nextSubAreaMealLastIndex[mealKey][subArea] = nextIndex;
          } else {
            nextSubAreaLastIndex[subArea] = nextIndex;
          }
          agentId = assignmentPool[nextIndex];
        } else if (!requiresOwnerAssignment && getAreaAgentIdsForMeal(currentAssignment, order.mealType).length > 0) {
          assignmentPool = getAreaAgentIdsForMeal(currentAssignment, order.mealType);
          areaLastIndex = (areaLastIndex + 1) % assignmentPool.length;
          agentId = assignmentPool[areaLastIndex];
        }
        return updateDoc(doc(db, "orders", order.id), {
          assignedAgentId: agentId,
          assignedAgentName: agentNameMap[agentId] || "",
        });
      })
    );
    await updateDoc(
      doc(db, "area_assignments", areaName),
      mealKey
        ? {
            [`mealLastIndex.${mealKey}`]: areaLastIndex,
            [`subAreaMealLastIndex.${mealKey}`]: nextSubAreaMealLastIndex[mealKey] || {},
          }
        : {
            lastIndex: areaLastIndex,
            subAreaLastIndex: nextSubAreaLastIndex,
          }
    );
  }

  async function saveOrderPaymentStatus(order: Order, markAsFullyPaid = false) {
    const additionalAmount = markAsFullyPaid
      ? Math.max((order.total || 0) - getPaymentAmountPaid(order), 0)
      : Number(pickupPaymentForm.amount || 0);
    if (!markAsFullyPaid && additionalAmount <= 0) {
      return;
    }
    const nextPaid = Math.min(
      (order.total || 0),
      getPaymentAmountPaid(order) + additionalAmount
    );
    const nextBalance = Math.max((order.total || 0) - nextPaid, 0);
    const nextStatus =
      nextBalance === 0 ? "paid" : nextPaid > 0 ? "partial" : "unpaid";
    const notes = pickupPaymentForm.notes.trim();
    const payload =
      isOwnerManualPaymentOrder(order)
        ? {
            manualAmountPaid: nextPaid,
            manualBalance: nextBalance,
            manualPaymentStatus: nextStatus,
            manualPaymentNotes: notes,
            manualPaymentUpdatedAt: serverTimestamp(),
            paymentMethod: "manual_pending",
            paymentStatus: nextBalance === 0 ? "paid" : "manual_pending",
            ...(nextBalance === 0 ? { manualPaymentClosedAt: serverTimestamp() } : {}),
          }
        : order.deliveryType === "pickup"
        ? {
            pickupAmountPaid: nextPaid,
            pickupBalance: nextBalance,
            pickupPaymentStatus: nextStatus,
            pickupPaymentNotes: notes,
            pickupPaymentUpdatedAt: serverTimestamp(),
            paymentStatus: nextBalance === 0 ? "paid" : order.paymentStatus || "pending",
            status: nextBalance === 0 ? "closed" : order.status || "active",
            ...(nextBalance === 0 ? { pickupPaymentClosedAt: serverTimestamp() } : {}),
          }
        : {
            codAmountCollected: nextPaid,
            codBalance: nextBalance,
            codPaymentStatus: nextStatus,
            codPaymentNotes: notes,
            codPaymentUpdatedAt: serverTimestamp(),
            paymentMethod: "cash_on_delivery",
            paymentStatus: nextBalance === 0 ? "paid" : "cash_on_delivery",
            ...(nextBalance === 0 ? { codPaymentClosedAt: serverTimestamp() } : {}),
          };
    await updateDoc(doc(db, "orders", order.id), payload);
    setEditingPickupPaymentId(null);
    setPickupPaymentForm({ amount: "", notes: "" });
  }

  function openActiveOrderEditor(order: Order) {
    const savedAddress = splitAddress(order.address || "");
    setOpenActiveOrderActionsId(null);
    setCancellingOwnerOrderId(null);
    setOwnerCancelRemarks("");
    setOwnerCancelError("");
    setEditingActiveOrderId(order.id);
    setActiveOrderEditError("");
    setActiveOrderEditForm({
      customerName: order.customerName || "",
      phone: order.phone || "",
      deliveryType: order.deliveryType || "pickup",
      addressLine1: savedAddress.addressLine1,
      street: savedAddress.street,
      area: order.area || "",
      subArea: order.subArea || "",
      location: formatLocationInput(order.location),
      assignedAgentId: order.assignedAgentId || "",
      status:
        order.status === "undelivered" || order.status === "closed"
          ? order.status
          : "active",
    });
  }

  function canOwnerCancelOrder(order: Order) {
    return order.orderSource !== "owner" && (order.status === "active" || order.status === "payment_pending");
  }

  function openOwnerCancelOrder(order: Order) {
    setEditingActiveOrderId(null);
    setActiveOrderEditError("");
    setOpenActiveOrderActionsId(null);
    setOwnerCancelError("");
    setOwnerCancelRemarks("");
    setCancellingOwnerOrderId(order.id);
  }

  async function cancelOrderByOwner(order: Order) {
    setOwnerCancelError("");
    const remarks = ownerCancelRemarks.trim();
    if (!canOwnerCancelOrder(order)) {
      setOwnerCancelError("Only customer-created active orders can be cancelled.");
      return;
    }
    if (!remarks) {
      setOwnerCancelError("Enter cancellation remarks.");
      return;
    }
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Are you sure you want to cancel order ${order.orderId || order.id}?`)
    ) {
      return;
    }

    setCancellingOwnerOrderId(order.id);
    try {
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
                (menuItem: any) =>
                  menuItem.itemId === orderedItem.itemId || menuItem.name === orderedItem.name
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
          paymentStatus: currentOrder.paymentStatus === "paid" ? "refund_pending" : "cancelled",
          cancelledAt: serverTimestamp(),
          cancelledByOwner: true,
          cancellationRemarks: remarks,
          updatedAt: serverTimestamp(),
        });
      });

      setCancellingOwnerOrderId(null);
      setOwnerCancelRemarks("");
      setOwnerCancelError("");
    } catch (error: any) {
      setOwnerCancelError(error?.message || "Failed to cancel order.");
    }
  }

  async function savePublishedMenuDate(menu: PublishedMenu) {
    if (!publishedMenuDateDraft) {
      return;
    }
    await updateDoc(doc(db, "published_menus", menu.id), {
      date: publishedMenuDateDraft,
      updatedAt: serverTimestamp(),
    });
    const matchingOrders = await getDocs(
      query(collection(db, "orders"), where("publishedMenuId", "==", menu.id))
    );
    await Promise.all(
      matchingOrders.docs.map((docSnap) =>
        updateDoc(doc(db, "orders", docSnap.id), {
          publishedDate: publishedMenuDateDraft,
          updatedAt: serverTimestamp(),
        })
      )
    );
    setEditingPublishedMenuDateId(null);
    setPublishedMenuDateDraft("");
    showPublishedMenuNotice("Published menu date updated");
  }

  function buildPlacedNotificationMessage(order: Order) {
    const mealLabel = (order.mealType || "order").toLowerCase();
    const itemLines =
      (order.items || []).length > 0
        ? (order.items || [])
            .map((item) => `*${item.name}---${item.qty}*`)
            .join("\n")
        : "*Items---0*";
    const amountLine = `Total Amount is *Rs. ${order.total || 0}/-*`;
    let deliveryLine = "You have opted for ===Home Delivery";
    let followupLine = "";

    if (order.deliveryType === "pickup") {
      deliveryLine = "You have opted for ===Self Pickup";
      followupLine = "Please visit the store and pick up your ordered items.";
    } else if (order.paymentMethod === "cash_on_delivery") {
      deliveryLine = "You have opted for ===Cash On Delivery";
      followupLine = `Please pay the bill amount of Rs. ${order.total || 0}/- to the delivery agent.`;
    }

    return `Your ${mealLabel} Order has been\nSuccessfully Received as\n${itemLines}\n${amountLine}\n\n${deliveryLine}${followupLine ? `\n${followupLine}` : ""}\n\n-MS Kitchen`;
  }

  function openPlacedNotification(order: Order) {
    const phone = getWhatsAppPhone(order.phone);
    if (!phone) {
      window.alert("Customer phone number is missing or invalid.");
      return;
    }
    const text = encodeURIComponent(buildPlacedNotificationMessage(order));
    window.open(`https://wa.me/${phone}?text=${text}`, "_blank", "noopener,noreferrer");
    setPlacedNotificationSentIds((prev) =>
      prev.includes(order.id) ? prev : [...prev, order.id]
    );
  }

  async function saveActiveOrderEdits(order: Order) {
    setActiveOrderEditError("");
    if (!activeOrderEditForm.customerName.trim() || !activeOrderEditForm.phone.trim()) {
      setActiveOrderEditError("Customer name and phone number are required.");
      return;
    }
    if (
      activeOrderEditForm.deliveryType === "delivery" &&
      (!activeOrderEditForm.addressLine1.trim() ||
        !activeOrderEditForm.street.trim() ||
        !activeOrderEditForm.area ||
        !activeOrderEditForm.subArea)
    ) {
      setActiveOrderEditError("Delivery orders require address, street, area and sub area.");
      return;
    }

    const nextAssignedAgentId =
      activeOrderEditForm.deliveryType === "delivery"
        ? activeOrderEditForm.assignedAgentId
        : "";
    await updateDoc(doc(db, "orders", order.id), {
      customerName: activeOrderEditForm.customerName.trim(),
      phone: normalizePhone(activeOrderEditForm.phone),
      deliveryType: activeOrderEditForm.deliveryType,
      address:
        activeOrderEditForm.deliveryType === "delivery"
          ? `${activeOrderEditForm.addressLine1.trim()}, ${activeOrderEditForm.street.trim()}`
          : "",
      area:
        activeOrderEditForm.deliveryType === "delivery"
          ? activeOrderEditForm.area
          : "",
      subArea:
        activeOrderEditForm.deliveryType === "delivery"
          ? activeOrderEditForm.subArea
          : "",
      location:
        activeOrderEditForm.deliveryType === "delivery"
          ? activeOrderEditForm.location.trim() || null
          : null,
      assignedAgentId: nextAssignedAgentId,
      assignedAgentName: nextAssignedAgentId ? agentNameMap[nextAssignedAgentId] || "" : "",
      status:
        order.status === "payment_pending"
          ? "payment_pending"
          : activeOrderEditForm.status,
    });
    setEditingActiveOrderId(null);
    setActiveOrderEditError("");
  }

  async function createOwnerOrder() {
    setOwnerOrderError("");
    setOwnerOrderSuccess("");
    if (!selectedOwnerMenu) {
      setOwnerOrderError("Select an active published menu.");
      return;
    }
    if (!ownerOrderForm.name.trim() || !ownerOrderForm.phone.trim()) {
      setOwnerOrderError("Enter customer name and phone number.");
      return;
    }
    if (
      ownerOrderForm.deliveryType === "delivery" &&
      (!ownerOrderForm.addressLine1.trim() ||
        !ownerOrderForm.street.trim() ||
        !ownerOrderForm.area ||
        !ownerOrderForm.subArea ||
        !ownerOrderLocation)
    ) {
      setOwnerOrderError("Enter full delivery address, area, sub area and exact location on map.");
      return;
    }

    const selectedItems = (selectedOwnerMenu.remaining || selectedOwnerMenu.items || [])
      .filter((item) => item.active !== false)
      .map((item) => ({
        ...item,
        qty: ownerOrderQty[item.itemId] || 0,
      }))
      .filter((item) => item.qty > 0);

    if (!selectedItems.length) {
      setOwnerOrderError("Select quantity for at least one item.");
      return;
    }

    setOwnerOrderSubmitting(true);
    try {
      const displayOrderId = await generateUniqueSixDigitOrderId();
      const orderRef = doc(collection(db, "orders"));
      const menuRef = doc(db, "published_menus", selectedOwnerMenu.id);
      const total = selectedItems.reduce(
        (sum, item) => sum + item.qty * item.price,
        0
      );

      await runTransaction(db, async (tx) => {
        const menuSnap = await tx.get(menuRef);
        if (!menuSnap.exists()) {
          throw new Error("Published menu not found.");
        }
        const menuData = menuSnap.data() as any;
        const mealKey = getAssignmentMealKey(menuData.mealType || "");
        if (menuData.isArchived || menuData.ordersStopped) {
          throw new Error("Orders are closed for this menu.");
        }

        const remaining = (menuData.remaining || menuData.items || []).map(
          (item: any) => ({ ...item })
        );

        selectedItems.forEach((item) => {
          const remainingItem = remaining.find(
            (rem: any) => rem.itemId === item.itemId
          );
          if (
            !remainingItem ||
            remainingItem.active === false ||
            (remainingItem.qty || 0) < item.qty
          ) {
            throw new Error(`${item.name} is sold out or insufficient.`);
          }
          remainingItem.qty = (remainingItem.qty || 0) - item.qty;
        });

        let assignedAgentId = "";
        let assignedAgentName = "";
        if (ownerOrderForm.deliveryType === "delivery" && ownerOrderForm.area) {
          if (ownerOrderForm.preferredAgentId) {
            const preferredAgentRef = doc(
              db,
              "delivery_agents",
              ownerOrderForm.preferredAgentId
            );
            const preferredAgentSnap = await tx.get(preferredAgentRef);
            if (preferredAgentSnap.exists()) {
              const preferredAgentData = preferredAgentSnap.data() as any;
              if (preferredAgentData.active !== false) {
                assignedAgentId = ownerOrderForm.preferredAgentId;
                assignedAgentName = preferredAgentData.name || "";
              }
            }
          }

          if (!assignedAgentId) {
            const assignmentRef = doc(db, "area_assignments", ownerOrderForm.area);
            const assignmentSnap = await tx.get(assignmentRef);
            if (assignmentSnap.exists()) {
              const assignmentData = assignmentSnap.data() as any;
              const subAreaAgentIds: string[] =
                mealKey
                  ? assignmentData.subAreaMealAgentIds?.[mealKey]?.[ownerOrderForm.subArea] ||
                    assignmentData.subAreaAgentIds?.[ownerOrderForm.subArea] ||
                    []
                  : assignmentData.subAreaAgentIds?.[ownerOrderForm.subArea] || [];
              const requiresOwnerAssignment =
                Boolean(ownerOrderForm.subArea) &&
                !isMappedSubArea(ownerOrderForm.area, ownerOrderForm.subArea) &&
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
                const usesSubAreaPool =
                  subAreaAgentIds.length > 0;
                const lastIndex = usesSubAreaPool
                  ? mealKey
                    ? typeof assignmentData.subAreaMealLastIndex?.[mealKey]?.[ownerOrderForm.subArea] === "number"
                      ? assignmentData.subAreaMealLastIndex[mealKey][ownerOrderForm.subArea]
                      : typeof assignmentData.subAreaLastIndex?.[ownerOrderForm.subArea] === "number"
                        ? assignmentData.subAreaLastIndex[ownerOrderForm.subArea]
                        : -1
                    : typeof assignmentData.subAreaLastIndex?.[ownerOrderForm.subArea] === "number"
                      ? assignmentData.subAreaLastIndex[ownerOrderForm.subArea]
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
                const agentSnap = await tx.get(doc(db, "delivery_agents", agentId));
                if (agentSnap.exists()) {
                  const agentData = agentSnap.data() as any;
                  if (agentData.active !== false) {
                    assignedAgentId = agentId;
                    assignedAgentName = agentData.name || "";
                    tx.update(
                      assignmentRef,
                      usesSubAreaPool
                        ? mealKey
                          ? { [`subAreaMealLastIndex.${mealKey}.${ownerOrderForm.subArea}`]: nextIndex }
                          : { [`subAreaLastIndex.${ownerOrderForm.subArea}`]: nextIndex }
                        : mealKey
                          ? { [`mealLastIndex.${mealKey}`]: nextIndex }
                          : { lastIndex: nextIndex }
                    );
                  }
                }
              }
            }
          }
        }

        tx.set(orderRef, {
          orderId: displayOrderId,
          status: "active",
          paymentStatus: "manual_pending",
          paymentMethod: "manual_pending",
          createdAt: serverTimestamp(),
          publishedMenuId: selectedOwnerMenu.id,
          publishedDate: menuData.date || "",
          mealType: menuData.mealType || "",
          customerName: ownerOrderForm.name.trim(),
          phone: normalizePhone(ownerOrderForm.phone),
          deliveryType: ownerOrderForm.deliveryType,
          address:
            ownerOrderForm.deliveryType === "delivery"
              ? `${ownerOrderForm.addressLine1.trim()}, ${ownerOrderForm.street.trim()}`
              : "",
          area: ownerOrderForm.deliveryType === "delivery" ? ownerOrderForm.area : "",
          subArea:
            ownerOrderForm.deliveryType === "delivery" ? ownerOrderForm.subArea : "",
          location:
            ownerOrderForm.deliveryType === "delivery"
              ? ownerOrderLocation || null
              : null,
          items: selectedItems.map((item) => ({
            name: item.name,
            qty: item.qty,
            price: item.price,
          })),
          total,
          assignedAgentId,
          assignedAgentName,
          orderSource: "owner",
          manualAmountPaid: 0,
          manualBalance: total,
          manualPaymentStatus: "unpaid",
          manualPaymentNotes: "",
          pickupAmountPaid: 0,
          pickupBalance: 0,
          pickupPaymentStatus: "",
          pickupPaymentNotes: "",
        });
        tx.update(menuRef, { remaining });
      });

      setOwnerOrderSuccess(`Order ${displayOrderId} created successfully.`);
      setOwnerOrderForm({
        name: "",
        phone: "",
        deliveryType: "pickup",
        addressLine1: "",
        street: "",
        area: "",
        subArea: "",
        preferredAgentId: "",
      });
      setOwnerOrderLocation(null);
      setOwnerOrderLocLabel("");
      setOwnerOrderLocError("");
      if (selectedOwnerMenu) {
        const resetQty: Record<string, number> = {};
        (selectedOwnerMenu.remaining || selectedOwnerMenu.items || [])
          .filter((item) => item.active !== false)
          .forEach((item) => {
          resetQty[item.itemId] = 0;
          });
        setOwnerOrderQty(resetQty);
      }
    } catch (error: any) {
      setOwnerOrderError(error?.message || "Failed to create order.");
    } finally {
      setOwnerOrderSubmitting(false);
    }
  }

  const reportBaseOrders = useMemo(
    () => orders.filter((order) => order.status === "closed" || order.status === "cancelled"),
    [orders]
  );

  const filteredReportOrders = useMemo(() => {
    const { search, startDate, endDate, area, deliveryType } = appliedReportFilters;
    return reportBaseOrders.filter((order) => {
      const haystack = `${order.orderId || ""} ${order.phone || ""} ${
        order.customerName || ""
      }`.toLowerCase();
      if (search && !haystack.includes(search.toLowerCase())) return false;
      const publishedDate = formatDateKey(order.publishedDate);
      if (startDate && publishedDate < startDate) return false;
      if (endDate && publishedDate > endDate) return false;
      if (area !== "All" && (order.area || "Unknown") !== area) return false;
      if (deliveryType !== "All" && (order.deliveryType || "Unknown") !== deliveryType) {
        return false;
      }
      return true;
    });
  }, [reportBaseOrders, appliedReportFilters]);

  const filteredClosedOrders = useMemo(
    () => filteredReportOrders.filter((order) => order.status === "closed"),
    [filteredReportOrders]
  );

  const filteredCancelledOrders = useMemo(
    () => filteredReportOrders.filter((order) => order.status === "cancelled"),
    [filteredReportOrders]
  );

  const closedOrdersByArea = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredClosedOrders.forEach((order) => {
      const area = order.area || "Unknown";
      counts[area] = (counts[area] || 0) + 1;
    });
    return counts;
  }, [filteredClosedOrders]);

  const completedOrdersTotal = useMemo(
    () =>
      filteredClosedOrders.reduce((sum, order) => sum + (order.total || 0), 0),
    [filteredClosedOrders]
  );

  const reportKpis = useMemo(() => {
    const deliveryOrders = filteredClosedOrders.filter(
      (order) => order.deliveryType === "delivery"
    );
    const pickupOrders = filteredClosedOrders.filter(
      (order) => order.deliveryType === "pickup"
    );
    const uniqueCustomers = new Set(
      filteredClosedOrders.map((order) => normalizePhone(order.phone || "")).filter(Boolean)
    ).size;
    const totalItems = filteredClosedOrders.reduce(
      (sum, order) =>
        sum + (order.items || []).reduce((itemSum, item) => itemSum + item.qty, 0),
      0
    );
    const codOrders = filteredClosedOrders.filter((order) => isCashOnDeliveryOrder(order));
    const codCollected = codOrders.reduce(
      (sum, order) => sum + getPaymentAmountPaid(order),
      0
    );
    const refundPending = filteredCancelledOrders.filter(
      (order) => order.paymentStatus === "refund_pending"
    ).length;

    return {
      completedOrders: filteredClosedOrders.length,
      cancelledOrders: filteredCancelledOrders.length,
      totalSales: completedOrdersTotal,
      avgOrderValue:
        filteredClosedOrders.length > 0
          ? Math.round((completedOrdersTotal / filteredClosedOrders.length) * 100) / 100
          : 0,
      avgItemsPerOrder:
        filteredClosedOrders.length > 0
          ? Math.round((totalItems / filteredClosedOrders.length) * 100) / 100
          : 0,
      deliveryOrders: deliveryOrders.length,
      pickupOrders: pickupOrders.length,
      codOrders: codOrders.length,
      codCollected,
      refundPending,
      uniqueCustomers,
      topArea:
        Object.entries(closedOrdersByArea).sort((a, b) => b[1] - a[1])[0]?.[0] || "-",
    };
  }, [
    filteredClosedOrders,
    filteredCancelledOrders,
    completedOrdersTotal,
    closedOrdersByArea,
  ]);

  const salesTrendRows = useMemo(() => {
    const buckets: Record<string, { label: string; sales: number; orders: number }> = {};
    const trendType = appliedReportFilters.trend;

    filteredClosedOrders.forEach((order) => {
      const dateKey = formatDateKey(order.createdAt || order.publishedDate);
      if (!dateKey) return;
      const date = new Date(dateKey);
      if (Number.isNaN(date.getTime())) return;

      let key = dateKey;
      let label = formatDateLabel(dateKey);

      if (trendType === "monthly") {
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        key = monthKey;
        label = date.toLocaleDateString("en-US", {
          month: "short",
          year: "numeric",
        });
      } else {
        const start = new Date(date);
        const day = start.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        start.setDate(start.getDate() + diff);
        const mondayKey = start.toISOString().slice(0, 10);
        key = mondayKey;
        label = `Week of ${formatDateLabel(mondayKey)}`;
      }

      if (!buckets[key]) {
        buckets[key] = { label, sales: 0, orders: 0 };
      }
      buckets[key].sales += order.total || 0;
      buckets[key].orders += 1;
    });

    return Object.entries(buckets)
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(-8);
  }, [filteredClosedOrders, appliedReportFilters.trend]);

  const maxTrendSales = useMemo(
    () => Math.max(...salesTrendRows.map((row) => row.sales), 0),
    [salesTrendRows]
  );

  const currentPublishedMenu = useMemo(() => publishedMenus[0] || null, [publishedMenus]);

  const currentPublishedMenuKey = useMemo(() => {
    if (!currentPublishedMenu) {
      return "";
    }
    return `${formatDateKey(currentPublishedMenu.date)}__${
      currentPublishedMenu.mealType || "Unknown"
    }`;
  }, [currentPublishedMenu]);

  const activePublishedMenusForOwnerOrder = useMemo(
    () =>
      publishedMenus.filter((menu) => !menu.isArchived && !menu.ordersStopped),
    [publishedMenus]
  );

  const selectedOwnerMenu = useMemo(
    () =>
      activePublishedMenusForOwnerOrder.find((menu) => menu.id === ownerOrderMenuId) ||
      null,
    [activePublishedMenusForOwnerOrder, ownerOrderMenuId]
  );

  useEffect(() => {
    if (!selectedOwnerMenu) {
      setOwnerOrderQty({});
      return;
    }
    const nextQty: Record<string, number> = {};
    (selectedOwnerMenu.remaining || selectedOwnerMenu.items || [])
      .filter((item) => item.active !== false)
      .forEach((item) => {
      nextQty[item.itemId] = 0;
      });
    setOwnerOrderQty(nextQty);
  }, [selectedOwnerMenu]);

  const currentMenuOrders = useMemo(() => {
    if (!currentPublishedMenu) {
      return [];
    }
    return orders.filter(
      (order) =>
        `${formatDateKey(order.publishedDate)}__${order.mealType || "Unknown"}` ===
        currentPublishedMenuKey
    );
  }, [orders, currentPublishedMenu, currentPublishedMenuKey]);

  const currentOperationalOrders = useMemo(
    () =>
      currentMenuOrders.filter((order) => {
        if (order.deliveryType === "pickup") {
          return true;
        }
        if (order.orderSource === "owner") {
          return true;
        }
        return order.paymentStatus === "paid" || order.paymentStatus === "cash_on_delivery";
      }),
    [currentMenuOrders]
  );

  const currentOrdersSummary = useMemo(
    () => buildOrdersSummary(currentOperationalOrders),
    [currentOperationalOrders]
  );

  const currentCancelledOrders = useMemo(
    () => currentMenuOrders.filter((order) => order.status === "cancelled"),
    [currentMenuOrders]
  );

  const currentCancelledOrderRows = useMemo(
    () => buildCancelledOrderRows(currentCancelledOrders),
    [currentCancelledOrders]
  );

  const filteredPaymentOrders = useMemo(() => {
    return currentMenuOrders
      .filter((order) => isPaymentStatusOrder(order))
      .filter((order) => {
        const dateKey = formatDateKey(order.createdAt || order.publishedDate);
        if (
          pickupPaymentFilters.startDate &&
          dateKey < pickupPaymentFilters.startDate
        ) {
          return false;
        }
        if (
          pickupPaymentFilters.endDate &&
          dateKey > pickupPaymentFilters.endDate
        ) {
          return false;
        }
        if (!pickupPaymentFilters.search.trim()) {
          return true;
        }
        const haystack = `${order.orderId || ""} ${order.customerName || ""} ${
          order.phone || ""
        }`.toLowerCase();
        return haystack.includes(pickupPaymentFilters.search.toLowerCase());
      })
      .sort((a, b) => getCreatedAtMs(b.createdAt) - getCreatedAtMs(a.createdAt));
  }, [currentMenuOrders, pickupPaymentFilters]);

  const activeAreaRows = useMemo(() => buildAreaRows(currentOrdersSummary), [currentOrdersSummary]);

  const activeItemRows = useMemo(() => buildItemRows(currentOrdersSummary), [currentOrdersSummary]);

  const activeItemPackingMatrix = useMemo(
    () => buildPackingMatrix(currentOrdersSummary),
    [currentOrdersSummary]
  );

  const activeAgentRows = useMemo(
    () =>
      Object.entries(currentOrdersSummary.byAgent)
        .map(([agent, count]) => ({
          key: agent,
          agent,
          count,
        }))
        .sort((a, b) => b.count - a.count || a.agent.localeCompare(b.agent)),
    [currentOrdersSummary]
  );

  const activeAgentDetailRows = useMemo(
    () => buildAgentDetailRows(currentOperationalOrders),
    [currentOperationalOrders]
  );

  const activeDeliveryTypeRows = useMemo(
    () => buildDeliveryTypeRows(currentOrdersSummary),
    [currentOrdersSummary]
  );

  const deliveredByAgent = useMemo(() => {
    const counts: Record<string, { total: number; byArea: Record<string, number> }> =
      {};
    filteredClosedOrders.forEach((order) => {
      const agent = order.assignedAgentName || "Unassigned";
      if (!counts[agent]) {
        counts[agent] = { total: 0, byArea: {} };
      }
      counts[agent].total += 1;
      const area = order.area || "Unknown";
      counts[agent].byArea[area] = (counts[agent].byArea[area] || 0) + 1;
    });
    return counts;
  }, [filteredClosedOrders]);

  const filteredActiveOrders = useMemo(() => {
    const search = activeOrderSearch.toLowerCase();
    return currentOperationalOrders
      .filter((order) => {
        if (
          activeOrderDeliveryFilter !== "All" &&
          (order.deliveryType || "Unknown") !== activeOrderDeliveryFilter
        ) {
          return false;
        }
        if (
          activeOrderAreaFilter !== "All" &&
          (order.area || "Unknown") !== activeOrderAreaFilter
        ) {
          return false;
        }
        if (
          activeOrderStatusFilter !== "All" &&
          getOrderStatusLabel(order) !== activeOrderStatusFilter
        ) {
          return false;
        }
        if (!search) return true;
        const haystack = `${order.orderId || ""} ${order.phone || ""} ${
          order.customerName || ""
        } ${order.address || ""} ${(order.items || [])
          .map((item) => item.name)
          .join(" ")}`.toLowerCase();
        return haystack.includes(search);
      })
      .sort((a, b) => getCreatedAtMs(b.createdAt) - getCreatedAtMs(a.createdAt));
  }, [
    currentOperationalOrders,
    activeOrderSearch,
    activeOrderAreaFilter,
    activeOrderDeliveryFilter,
    activeOrderStatusFilter,
  ]);

  const pendingPlacedNotificationOrders = useMemo(
    () =>
      filteredActiveOrders.filter(
        (order) =>
          Boolean(getWhatsAppPhone(order.phone)) &&
          !placedNotificationSentIds.includes(order.id)
      ),
    [filteredActiveOrders, placedNotificationSentIds]
  );

  const exportActiveOrdersCsv = () => {
    if (!filteredActiveOrders.length) {
      window.alert("No active orders to export.");
      return;
    }

    const csvEscape = (value: unknown) => {
      const text = String(value ?? "").replace(/"/g, '""');
      return `"${text}"`;
    };

    const rows = filteredActiveOrders.map((order) => ({
      orderId: `#${order.orderId || order.id}`,
      customer: order.customerName || "Customer",
      phone: order.phone || "",
      mealType: order.mealType || currentPublishedMenu?.mealType || "",
      deliveryType:
        order.deliveryType === "pickup"
          ? "Self Pickup"
          : isCashOnDeliveryOrder(order)
            ? "Cash On Delivery"
            : "Home Delivery",
      area: order.area || "",
      subArea: order.subArea || "",
      address: order.address || "",
      location: formatLocationInput(order.location),
      items: (order.items || []).map((item) => `${item.name} x${item.qty}`).join(", "),
      deliveryAgent:
        order.deliveryType === "delivery" ? order.assignedAgentName || "Unassigned" : "Pickup",
      payment: getPaymentMethodLabel(order),
      status: getOrderStatusLabel(order),
      totalValue: order.total || 0,
    }));

    const headers = [
      "Order ID",
      "Customer",
      "Phone",
      "Meal Type",
      "Delivery Type",
      "Area",
      "Sub Area",
      "Address",
      "Location",
      "Items",
      "Delivery Agent",
      "Payment",
      "Status",
      "Total Value",
    ];

    const csvLines = [
      headers.map(csvEscape).join(","),
      ...rows.map((row) =>
        [
          row.orderId,
          row.customer,
          row.phone,
          row.mealType,
          row.deliveryType,
          row.area,
          row.subArea,
          row.address,
          row.location,
          row.items,
          row.deliveryAgent,
          row.payment,
          row.status,
          `Rs. ${row.totalValue}`,
        ]
          .map(csvEscape)
          .join(",")
      ),
    ];

    const blob = new Blob([`\uFEFF${csvLines.join("\r\n")}`], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const dateLabel = currentPublishedMenu ? formatDateKey(currentPublishedMenu.date) : "active";
    const mealLabel = (currentPublishedMenu?.mealType || "orders").replace(/\s+/g, "-");
    link.href = url;
    link.download = `active-orders-${dateLabel}-${mealLabel}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const pastPublishedMenuOptions = useMemo(() => {
    const duplicateCounts = publishedMenus.reduce<Record<string, number>>((acc, menu) => {
      const signature = `${formatDateKey(menu.date)}__${menu.mealType || "Unknown"}`;
      acc[signature] = (acc[signature] || 0) + 1;
      return acc;
    }, {});

    return publishedMenus
      .filter(
        (menu) =>
          `${formatDateKey(menu.date)}__${menu.mealType || "Unknown"}` !== currentPublishedMenuKey
      )
      .map((menu) => {
        const dateKey = formatDateKey(menu.date);
        const mealType = menu.mealType || "Unknown";
        const signature = `${dateKey}__${mealType}`;
        return {
          key: menu.id,
          date: dateKey,
          mealType,
          menuId: menu.id,
          label:
            duplicateCounts[signature] > 1
              ? `${formatDateLabel(dateKey)} - ${mealType} (${formatDateTimeLabel(
                  menu.createdAt
                )})`
              : `${formatDateLabel(dateKey)} - ${mealType}`,
        };
      })
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          getCreatedAtMs(
            publishedMenus.find((menu) => menu.id === b.menuId)?.createdAt
          ) -
            getCreatedAtMs(
              publishedMenus.find((menu) => menu.id === a.menuId)?.createdAt
            ) ||
          a.mealType.localeCompare(b.mealType)
      );
  }, [publishedMenus, currentPublishedMenuKey]);

  useEffect(() => {
    if (!pastPublishedMenuOptions.length) {
      setSelectedPastMenuKey("");
      return;
    }
    if (!pastPublishedMenuOptions.some((option) => option.key === selectedPastMenuKey)) {
      setSelectedPastMenuKey(pastPublishedMenuOptions[0].key);
    }
  }, [pastPublishedMenuOptions, selectedPastMenuKey]);

  const selectedPastMenuOption = useMemo(
    () => pastPublishedMenuOptions.find((option) => option.key === selectedPastMenuKey) || null,
    [pastPublishedMenuOptions, selectedPastMenuKey]
  );

  const pastMenuOrders = useMemo(() => {
    if (!selectedPastMenuOption) {
      return [];
    }
    return orders.filter((order) => {
      if (order.publishedMenuId) {
        return order.publishedMenuId === selectedPastMenuOption.menuId;
      }
      return (
        formatDateKey(order.publishedDate) === selectedPastMenuOption.date &&
        (order.mealType || "Unknown") === selectedPastMenuOption.mealType
      );
    });
  }, [orders, selectedPastMenuOption]);

  const pastOperationalOrders = useMemo(
    () =>
      pastMenuOrders.filter((order) => {
        if (order.deliveryType === "pickup") {
          return true;
        }
        if (order.orderSource === "owner") {
          return true;
        }
        return order.paymentStatus === "paid" || order.paymentStatus === "cash_on_delivery";
      }),
    [pastMenuOrders]
  );

  const pastOrdersSummary = useMemo(
    () => buildOrdersSummary(pastOperationalOrders),
    [pastOperationalOrders]
  );

  const pastCancelledOrders = useMemo(
    () => pastMenuOrders.filter((order) => order.status === "cancelled"),
    [pastMenuOrders]
  );

  const pastCancelledOrderRows = useMemo(
    () => buildCancelledOrderRows(pastCancelledOrders),
    [pastCancelledOrders]
  );

  const pastAreaRows = useMemo(() => buildAreaRows(pastOrdersSummary), [pastOrdersSummary]);
  const pastItemRows = useMemo(() => buildItemRows(pastOrdersSummary), [pastOrdersSummary]);
  const pastItemPackingMatrix = useMemo(
    () => buildPackingMatrix(pastOrdersSummary),
    [pastOrdersSummary]
  );
  const pastDeliveryTypeRows = useMemo(
    () => buildDeliveryTypeRows(pastOrdersSummary),
    [pastOrdersSummary]
  );
  const pastAgentDetailRows = useMemo(
    () => buildAgentDetailRows(pastOperationalOrders),
    [pastOperationalOrders]
  );

  const filteredPastOrders = useMemo(() => {
    const search = pastOrderSearch.toLowerCase();
    return pastOperationalOrders
      .filter((order) => {
        if (
          pastOrderDeliveryFilter !== "All" &&
          (order.deliveryType || "Unknown") !== pastOrderDeliveryFilter
        ) {
          return false;
        }
        if (pastOrderAreaFilter !== "All" && (order.area || "Unknown") !== pastOrderAreaFilter) {
          return false;
        }
        if (pastOrderStatusFilter !== "All" && getOrderStatusLabel(order) !== pastOrderStatusFilter) {
          return false;
        }
        if (!search) return true;
        const haystack = `${order.orderId || ""} ${order.phone || ""} ${
          order.customerName || ""
        } ${order.address || ""} ${(order.items || [])
          .map((item) => item.name)
          .join(" ")} ${order.mealType || ""}`.toLowerCase();
        return haystack.includes(search);
      })
      .sort((a, b) => getCreatedAtMs(b.createdAt) - getCreatedAtMs(a.createdAt));
  }, [
    pastOperationalOrders,
    pastOrderSearch,
    pastOrderAreaFilter,
    pastOrderDeliveryFilter,
    pastOrderStatusFilter,
  ]);

  const pendingPastPlacedNotificationOrders = useMemo(
    () =>
      filteredPastOrders.filter(
        (order) =>
          Boolean(getWhatsAppPhone(order.phone)) &&
          !placedNotificationSentIds.includes(order.id)
      ),
    [filteredPastOrders, placedNotificationSentIds]
  );

  return (
    <main className="container owner-shell">
      {mode === "loading" && <div className="card">Loading...</div>}
      {mode === "setup" && (
        <div className="card stack">
          <h2>Owner Setup Required</h2>
          <p>
            No owner accounts found. Please create owner accounts in Firestore
            under <code>admin_users</code>.
          </p>
        </div>
      )}
      {mode === "login" && (
        <div className="card stack" style={{ maxWidth: 520 }}>
          <h2>Owner Portal</h2>
          <p>Login with your owner phone number and password.</p>
          <div className="field">
            <label>Username</label>
            <input
              className="input"
              value={loginForm.username}
              onChange={(e) =>
                setLoginForm({ ...loginForm, username: e.target.value })
              }
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              className="input"
              type="password"
              value={loginForm.password}
              onChange={(e) =>
                setLoginForm({ ...loginForm, password: e.target.value })
              }
            />
          </div>
          {loginError && <p style={{ color: "crimson" }}>{loginError}</p>}
          <button className="btn" onClick={handleOwnerLogin}>
            Login
          </button>
        </div>
      )}
      {mode === "dashboard" && (
        <div className="stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="row" style={{ gap: 12 }}>
              <button
                className="btn secondary owner-nav-toggle"
                onClick={() => setShowNav(true)}
              >
                ☰
              </button>
              <h1>Owner Dashboard</h1>
            </div>
          </div>
          <div className="row owner-header-actions">
            <button
              className="btn secondary"
              onClick={() => setShowPasswordForm((prev) => !prev)}
            >
              Change Password
            </button>
            <button className="btn secondary" onClick={handleOwnerLogout}>
              Logout
            </button>
          </div>
          {showPasswordForm && (
            <div className="card stack" style={{ maxWidth: 520 }}>
              <h3>Change Password</h3>
              <div className="field">
                <label>Current Password</label>
                <input
                  className="input"
                  type="password"
                  value={passwordForm.current}
                  onChange={(e) =>
                    setPasswordForm({
                      ...passwordForm,
                      current: e.target.value,
                    })
                  }
                />
              </div>
              <div className="field">
                <label>New Password</label>
                <input
                  className="input"
                  type="password"
                  value={passwordForm.next}
                  onChange={(e) =>
                    setPasswordForm({
                      ...passwordForm,
                      next: e.target.value,
                    })
                  }
                />
              </div>
              {passwordError && (
                <p style={{ color: "crimson" }}>{passwordError}</p>
              )}
              {passwordSuccess && (
                <p style={{ color: "green" }}>{passwordSuccess}</p>
              )}
              <div className="row">
                <button className="btn" onClick={handleChangePassword}>
                  Update Password
                </button>
                <button
                  className="btn secondary"
                  onClick={() => setShowPasswordForm(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          <div className="row owner-nav">
            {[
              { id: "menu", label: "Menu" },
              { id: "publish", label: "Publish Menu" },
              { id: "createOrder", label: "Create Order" },
              { id: "dashboard", label: "Report/Dashboard" },
              { id: "history", label: "Orders" },
              { id: "delivery", label: "Delivery Agents" },
              { id: "areas", label: "Manage Areas" },
            ].map((item) => (
              <button
                key={item.id}
                className={`btn ${tab === item.id ? "" : "secondary"}`}
                onClick={() => setTab(item.id as Tab)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {showNav && (
            <div className="owner-nav-drawer" onClick={() => setShowNav(false)}>
              <div
                className="owner-nav-panel"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>Owner Menu</strong>
                </div>
                {[
                { id: "menu", label: "Menu" },
                { id: "publish", label: "Publish Menu" },
                { id: "createOrder", label: "Create Order" },
                { id: "dashboard", label: "Report/Dashboard" },
                { id: "history", label: "Orders" },
                { id: "delivery", label: "Delivery Agents" },
                  { id: "areas", label: "Manage Areas" },
                ].map((item) => (
                  <button
                    key={item.id}
                    className="btn secondary"
                    onClick={() => {
                      setTab(item.id as Tab);
                      setShowNav(false);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === "menu" && (
            <div className="card stack">
              <h2>Menu Management</h2>
              <div className="row">
                <button
                  className="btn"
                  onClick={() => setShowMenuForm((prev) => !prev)}
                >
                  Create/Add New Menu
                </button>
                <input
                  className="input"
                  placeholder="Search menu"
                  value={menuSearch}
                  onChange={(e) => setMenuSearch(e.target.value)}
                />
                <select
                  className="select"
                  value={menuMealFilter}
                  onChange={(e) => setMenuMealFilter(e.target.value)}
                >
                  <option value="All">All meal types</option>
                  {mealTypes.map((meal) => (
                    <option key={meal} value={meal}>
                      {meal}
                    </option>
                  ))}
                </select>
              </div>
              {showMenuForm && (
                <div className="card stack">
                  <div className="row">
                    <input
                      className="input"
                      placeholder="Item name"
                      value={menuForm.name}
                      onChange={(e) =>
                        setMenuForm({ ...menuForm, name: e.target.value })
                      }
                    />
                    <input
                      className="input"
                      placeholder="Price"
                      type="number"
                      value={menuForm.price}
                      onChange={(e) =>
                        setMenuForm({ ...menuForm, price: e.target.value })
                      }
                    />
                    <select
                      className="select"
                      value={menuForm.mealType}
                      onChange={(e) =>
                        setMenuForm({ ...menuForm, mealType: e.target.value })
                      }
                    >
                      {mealTypes.map((meal) => (
                        <option key={meal} value={meal}>
                          {meal}
                        </option>
                      ))}
                    </select>
                  </div>
                  <input
                    className="input"
                    placeholder="Description"
                    value={menuForm.description}
                    onChange={(e) =>
                      setMenuForm({ ...menuForm, description: e.target.value })
                    }
                  />
                  <input
                    className="input"
                    placeholder="Image URL (optional)"
                    value={menuForm.imageUrl}
                    onChange={(e) =>
                      setMenuForm({ ...menuForm, imageUrl: e.target.value })
                    }
                  />
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Or upload image from device</label>
                    <input
                      className="input"
                      type="file"
                      accept="image/*"
                      onChange={(e) =>
                        setMenuImageFile(e.target.files?.[0] ?? null)
                      }
                    />
                    {menuImageFile && (
                      <small>Selected: {menuImageFile.name}</small>
                    )}
                  </div>
                  {(menuForm.imageUrl || menuImageFile) && (
                    <div className="stack" style={{ gap: 8 }}>
                      <small>Preview</small>
                      <img
                        src={
                          menuImageFile
                            ? URL.createObjectURL(menuImageFile)
                            : menuForm.imageUrl
                        }
                        alt="Menu item preview"
                        style={{
                          width: 120,
                          height: 120,
                          objectFit: "cover",
                          borderRadius: 10,
                          border: "1px solid var(--border)",
                        }}
                      />
                      <div className="row">
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => setMenuImageFile(null)}
                          disabled={!menuImageFile}
                        >
                          Remove selected file
                        </button>
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() =>
                            setMenuForm({ ...menuForm, imageUrl: "" })
                          }
                          disabled={!menuForm.imageUrl}
                        >
                          Clear image URL
                        </button>
                      </div>
                    </div>
                  )}
                  <button
                    className="btn"
                    onClick={addMenuItem}
                    disabled={menuImageUploading}
                  >
                    {menuImageUploading ? "Uploading..." : "Add Menu Item"}
                  </button>
                </div>
              )}
              {selectedMenuIds.length > 0 && (
                <button className="btn" onClick={openCheckoutSelected}>
                  Checkout Selected Menu ({selectedMenuIds.length})
                </button>
              )}
              {showPublishForm && (
                <div className="card stack">
                  <h3>Publish Selected Menu</h3>
                  <div className="row">
                    <input
                      className="input"
                      type="date"
                      value={publishForm.date}
                      onChange={(e) =>
                        setPublishForm({ ...publishForm, date: e.target.value })
                      }
                    />
                    <select
                      className="select"
                      value={publishForm.mealType}
                      onChange={(e) =>
                        setPublishForm({
                          ...publishForm,
                          mealType: e.target.value,
                        })
                      }
                    >
                      {mealTypes.map((meal) => (
                        <option key={meal} value={meal}>
                          {meal}
                        </option>
                      ))}
                    </select>
                  </div>
                  {menuItems
                    .filter((item) => selectedMenuIds.includes(item.id))
                    .map((item) => (
                      <div key={item.id} className="row">
                        <div style={{ flex: 1 }}>
                          {item.name} - Rs. {item.price}
                        </div>
                        <input
                          className="input"
                          type="number"
                          min={0}
                          value={publishQty[item.id] || ""}
                          onChange={(e) =>
                            setPublishQty({
                              ...publishQty,
                              [item.id]: Number(e.target.value),
                            })
                          }
                        />
                      </div>
                    ))}
                  <div className="row">
                    <button className="btn" onClick={publishMenu}>
                      Publish Menu
                    </button>
                    <button
                      className="btn secondary"
                      onClick={() => setShowPublishForm(false)}
                    >
                      Cancel
                    </button>
                  </div>
                  {publishError && (
                    <small style={{ color: "crimson" }}>{publishError}</small>
                  )}
                </div>
              )}
              {menuItems
                .filter((item) =>
                  menuMealFilter === "All"
                    ? true
                    : (item.mealType || "Lunch") === menuMealFilter
                )
                .filter((item) =>
                  menuSearch
                    ? `${item.name} ${item.description || ""}`
                        .toLowerCase()
                        .includes(menuSearch.toLowerCase())
                    : true
                )
                .map((item) => (
                <div
                  key={item.id}
                  className="row list-card"
                  style={{ position: "relative", cursor: "pointer" }}
                  onClick={(e) => {
                    const target = e.target as HTMLElement;
                    if (
                      target.closest("button") ||
                      target.closest("input[type='checkbox']")
                    ) {
                      return;
                    }
                    toggleMenuSelection(item.id);
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedMenuIds.includes(item.id)}
                    onChange={() => toggleMenuSelection(item.id)}
                  />
                  <div style={{ flex: 1 }}>
                    {item.imageUrl && (
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        style={{
                          width: 56,
                          height: 56,
                          objectFit: "cover",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          marginBottom: 8,
                          display: "block",
                        }}
                      />
                    )}
                    <strong>{item.name}</strong> - Rs. {item.price}
                    <div>
                      <small>
                        {item.description} • {item.mealType || "Lunch"}
                      </small>
                    </div>
                  </div>
                  <button
                    className="btn secondary"
                    onClick={() =>
                      setOpenMenuActionsId(
                        openMenuActionsId === item.id ? null : item.id
                      )
                    }
                  >
                    ⋮
                  </button>
                  {openMenuActionsId === item.id && (
                    <div
                      className="card stack"
                      style={{
                        position: "absolute",
                        right: 0,
                        top: "100%",
                        zIndex: 10,
                        minWidth: 160,
                      }}
                    >
                      <button
                        className="btn secondary"
                        onClick={() => startEditMenu(item)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn secondary"
                        onClick={() => deleteMenuItem(item.id)}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {editingMenuId && (
                <div className="card stack">
                  <h3>Edit Menu Item</h3>
                  <div className="row">
                    <input
                      className="input"
                      placeholder="Item name"
                      value={editMenuForm.name}
                      onChange={(e) =>
                        setEditMenuForm({
                          ...editMenuForm,
                          name: e.target.value,
                        })
                      }
                    />
                    <input
                      className="input"
                      placeholder="Price"
                      type="number"
                      value={editMenuForm.price}
                      onChange={(e) =>
                        setEditMenuForm({
                          ...editMenuForm,
                          price: e.target.value,
                        })
                      }
                    />
                    <select
                      className="select"
                      value={editMenuForm.mealType}
                      onChange={(e) =>
                        setEditMenuForm({
                          ...editMenuForm,
                          mealType: e.target.value,
                        })
                      }
                    >
                      {mealTypes.map((meal) => (
                        <option key={meal} value={meal}>
                          {meal}
                        </option>
                      ))}
                    </select>
                  </div>
                  <input
                    className="input"
                    placeholder="Description"
                    value={editMenuForm.description}
                    onChange={(e) =>
                      setEditMenuForm({
                        ...editMenuForm,
                        description: e.target.value,
                      })
                    }
                  />
                  <input
                    className="input"
                    placeholder="Image URL (optional)"
                    value={editMenuForm.imageUrl}
                    onChange={(e) =>
                      setEditMenuForm({
                        ...editMenuForm,
                        imageUrl: e.target.value,
                      })
                    }
                  />
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Or upload image from device</label>
                    <input
                      className="input"
                      type="file"
                      accept="image/*"
                      onChange={(e) =>
                        setEditMenuImageFile(e.target.files?.[0] ?? null)
                      }
                    />
                    {editMenuImageFile && (
                      <small>Selected: {editMenuImageFile.name}</small>
                    )}
                  </div>
                  {(editMenuForm.imageUrl || editMenuImageFile) && (
                    <div className="stack" style={{ gap: 8 }}>
                      <small>Preview</small>
                      <img
                        src={
                          editMenuImageFile
                            ? URL.createObjectURL(editMenuImageFile)
                            : editMenuForm.imageUrl
                        }
                        alt="Menu item preview"
                        style={{
                          width: 120,
                          height: 120,
                          objectFit: "cover",
                          borderRadius: 10,
                          border: "1px solid var(--border)",
                        }}
                      />
                      <div className="row">
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => setEditMenuImageFile(null)}
                          disabled={!editMenuImageFile}
                        >
                          Remove selected file
                        </button>
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() =>
                            setEditMenuForm({
                              ...editMenuForm,
                              imageUrl: "",
                            })
                          }
                          disabled={!editMenuForm.imageUrl}
                        >
                          Clear image URL
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="row">
                    <button
                      className="btn"
                      onClick={saveEditMenu}
                      disabled={menuImageUploading}
                    >
                      {menuImageUploading ? "Uploading..." : "Save"}
                    </button>
                    <button className="btn secondary" onClick={cancelEditMenu}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "publish" && (
            <div className="card stack">
              <h2>Published Menu</h2>
              {publishedMenuNotice && (
                <small style={{ color: "green", fontWeight: 600 }}>
                  {publishedMenuNotice}
                </small>
              )}
              {publishedMenus.filter((menu) => !menu.isArchived).length === 0 && (
                <p>No menus published</p>
              )}
              {publishedMenus
                .filter((menu) => !menu.isArchived)
                .map((menu) => (
                  <div key={menu.id} className="list-card menu-card">
                    <div className="menu-card-body">
                      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                          {formatDateLabel(menu.date)} - {menu.mealType} (
                          {(menu.items || []).filter((item) => item.active !== false).length} active
                          )
                        </div>
                        {currentPublishedMenu?.id === menu.id && (
                          <button
                            className="btn secondary btn-compact"
                            onClick={() => {
                              setEditingPublishedMenuDateId(
                                editingPublishedMenuDateId === menu.id ? null : menu.id
                              );
                              setPublishedMenuDateDraft(menu.date || "");
                            }}
                          >
                            Modify date
                          </button>
                        )}
                      </div>
                      {editingPublishedMenuDateId === menu.id && (
                        <div className="row">
                          <input
                            className="input"
                            type="date"
                            value={publishedMenuDateDraft}
                            onChange={(e) => setPublishedMenuDateDraft(e.target.value)}
                          />
                          <button
                            className="btn secondary btn-compact"
                            onClick={() => savePublishedMenuDate(menu)}
                          >
                            Update
                          </button>
                          <button
                            className="btn secondary btn-compact"
                            onClick={() => {
                              setEditingPublishedMenuDateId(null);
                              setPublishedMenuDateDraft("");
                            }}
                          >
                            Close
                          </button>
                        </div>
                      )}
                      <div>
                        {menu.items?.length ? (
                          menu.items.map((item) => (
                            <div key={item.itemId} className="published-menu-item-row">
                              <div className="published-menu-item-copy">
                                <small className="published-menu-item-name">{item.name}</small>
                                <small
                                  style={{
                                    color: item.active === false ? "crimson" : undefined,
                                  }}
                                >
                                  {item.active === false ? "Disabled" : "Enabled"} | Qty {item.qty} | Rs. {item.price}
                                </small>
                              </div>
                              {currentPublishedMenu?.id === menu.id ? (
                                <>
                                  <label className="published-menu-switch">
                                    <input
                                      type="checkbox"
                                      checked={item.active !== false}
                                      onChange={() =>
                                        updatePublishedMenuItem(menu, item.itemId, {
                                          active: item.active === false,
                                        })
                                      }
                                    />
                                    <span className="published-menu-switch-slider" />
                                  </label>
                                  <div className="published-menu-qty-edit">
                                    <input
                                      className="input"
                                      type="number"
                                      min={0}
                                      step={1}
                                      placeholder="Qty"
                                      aria-label={`Quantity for ${item.name}`}
                                      value={String(
                                        editPublishQty[
                                          getPublishedItemDraftKey(menu.id, item.itemId)
                                        ] ?? item.qty
                                      )}
                                      onChange={(e) =>
                                        setEditPublishQty((prev) => ({
                                          ...prev,
                                          [getPublishedItemDraftKey(menu.id, item.itemId)]: Number(
                                            e.target.value || 0
                                          ),
                                        }))
                                      }
                                    />
                                    <input
                                      className="input"
                                      type="number"
                                      min={0}
                                      step={1}
                                      placeholder="Price"
                                      aria-label={`Price for ${item.name}`}
                                      value={String(
                                        editPublishPrice[
                                          getPublishedItemDraftKey(menu.id, item.itemId)
                                        ] ?? item.price
                                      )}
                                      onChange={(e) =>
                                        setEditPublishPrice((prev) => ({
                                          ...prev,
                                          [getPublishedItemDraftKey(menu.id, item.itemId)]: Number(
                                            e.target.value || 0
                                          ),
                                        }))
                                      }
                                    />
                                    <button
                                      className="btn secondary"
                                      onClick={() => savePublishedMenuItemDetails(menu, item)}
                                    >
                                      Update
                                    </button>
                                  </div>
                                </>
                              ) : (
                                <small className="payments-subtext">Locked after newer menu</small>
                              )}
                            </div>
                          ))
                        ) : (
                          <small>No items</small>
                        )}
                      </div>
                      {currentPublishedMenu?.id === menu.id && (
                        <div className="published-menu-add-row">
                          <select
                            className="select"
                            value={publishedMenuAddItem[menu.id]?.itemId || ""}
                            onChange={(e) =>
                              setPublishedMenuAddItem((prev) => ({
                                ...prev,
                                [menu.id]: {
                                  itemId: e.target.value,
                                  qty: prev[menu.id]?.qty || "",
                                },
                              }))
                            }
                          >
                            <option value="">Add existing menu item</option>
                            {menuItems
                              .filter((item) => item.active !== false)
                              .sort(
                                (a, b) =>
                                  a.mealType.localeCompare(b.mealType) ||
                                  a.name.localeCompare(b.name)
                              )
                              .map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name} - {item.mealType} - Rs. {item.price}
                                </option>
                              ))}
                          </select>
                          <input
                            className="input"
                            type="number"
                            min={1}
                            step={1}
                            placeholder="Qty"
                            value={publishedMenuAddItem[menu.id]?.qty || ""}
                            onChange={(e) =>
                              setPublishedMenuAddItem((prev) => ({
                                ...prev,
                                [menu.id]: {
                                  itemId: prev[menu.id]?.itemId || "",
                                  qty: e.target.value,
                                },
                              }))
                            }
                          />
                          <button
                            className="btn secondary"
                            onClick={() => addItemToPublishedMenu(menu)}
                          >
                            Add Item
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          )}

          {tab === "createOrder" && (
            <div className="card stack">
              <h2>Create Order</h2>
              <div className="card stack owner-create-order-shell">
                <div className="owner-create-order-intro">
                  <strong>Adhoc Order Booking</strong>
                  <small>
                    Use this section to add extra live-menu orders for any area. For home
                    delivery, you can pin the order to a specific delivery agent or let the
                    area assignment handle it.
                  </small>
                </div>
              </div>
              <div className="field">
                <label>Active published menu</label>
                <select
                  className="select"
                  value={ownerOrderMenuId}
                  onChange={(e) => setOwnerOrderMenuId(e.target.value)}
                >
                  <option value="">Select published menu</option>
                  {activePublishedMenusForOwnerOrder.map((menu) => (
                    <option key={menu.id} value={menu.id}>
                      {formatDateLabel(menu.date)} - {menu.mealType}
                    </option>
                  ))}
                </select>
              </div>

              {!activePublishedMenusForOwnerOrder.length && (
                <p>No active published menus available.</p>
              )}

              {selectedOwnerMenu && (
                <>
                  <div className="card stack">
                    <strong>
                      {formatDateLabel(selectedOwnerMenu.date)} -{" "}
                      {selectedOwnerMenu.mealType}
                    </strong>
                    {(selectedOwnerMenu.remaining || selectedOwnerMenu.items || [])
                      .filter((item) => item.active !== false)
                      .map(
                      (item) => (
                        <div key={item.itemId} className="row">
                          <div style={{ flex: 1 }}>
                            {item.name} - Rs. {item.price}
                            <small style={{ display: "block" }}>
                              Available: {item.qty}
                            </small>
                          </div>
                          <input
                            className="input"
                            type="number"
                            min={0}
                            max={item.qty}
                            value={ownerOrderQty[item.itemId] || ""}
                            onChange={(e) =>
                              setOwnerOrderQty({
                                ...ownerOrderQty,
                                [item.itemId]: Math.min(
                                  Number(e.target.value || 0),
                                  item.qty
                                ),
                              })
                            }
                          />
                        </div>
                      )
                    )}
                  </div>

                  <div className="card stack">
                    <div className="owner-create-order-intro">
                      <strong>Customer and delivery details</strong>
                      <small>
                        Owner-created delivery orders will be routed to the selected or
                        assigned delivery agent.
                      </small>
                    </div>
                    <div className="row">
                      <input
                        className="input"
                        placeholder="Customer name"
                        value={ownerOrderForm.name}
                        onChange={(e) =>
                          setOwnerOrderForm({
                            ...ownerOrderForm,
                            name: e.target.value,
                          })
                        }
                      />
                      <input
                        className="input"
                        placeholder="Phone number"
                        value={ownerOrderForm.phone}
                        onChange={(e) =>
                          setOwnerOrderForm({
                            ...ownerOrderForm,
                            phone: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="row">
                      <button
                        className={`btn ${
                          ownerOrderForm.deliveryType === "pickup"
                            ? ""
                            : "secondary"
                        }`}
                          onClick={() => {
                            setOwnerOrderForm({
                              ...ownerOrderForm,
                              deliveryType: "pickup",
                              subArea: "",
                              preferredAgentId: "",
                            });
                            setOwnerOrderLocation(null);
                            setOwnerOrderLocLabel("");
                            setOwnerOrderLocError("");
                          }}
                      >
                        Self Pickup
                      </button>
                      <button
                        className={`btn ${
                          ownerOrderForm.deliveryType === "delivery"
                            ? ""
                            : "secondary"
                        }`}
                          onClick={() =>
                            setOwnerOrderForm({
                              ...ownerOrderForm,
                              deliveryType: "delivery",
                            })
                        }
                      >
                        Home Delivery
                      </button>
                    </div>
                    {ownerOrderForm.deliveryType === "delivery" && (
                      <>
                        <input
                          className="input"
                          placeholder="Door no / Apartment / House name"
                          value={ownerOrderForm.addressLine1}
                          onChange={(e) =>
                            setOwnerOrderForm({
                              ...ownerOrderForm,
                              addressLine1: e.target.value,
                            })
                          }
                        />
                        <div className="row">
                          <input
                            className="input"
                            placeholder="Street"
                            value={ownerOrderForm.street}
                            onChange={(e) =>
                              setOwnerOrderForm({
                                ...ownerOrderForm,
                                street: e.target.value,
                              })
                            }
                          />
                          <select
                            className="select"
                            value={ownerOrderForm.area}
                            onChange={(e) =>
                              setOwnerOrderForm({
                                ...ownerOrderForm,
                                area: e.target.value,
                                subArea: "",
                              })
                            }
                          >
                            <option value="">Select area</option>
                            {areaOptions.map((area) => (
                              <option key={area} value={area}>
                                {area}
                              </option>
                            ))}
                          </select>
                          <select
                            className="select"
                            value={ownerOrderForm.subArea}
                            onChange={(e) =>
                              setOwnerOrderForm({
                                ...ownerOrderForm,
                                subArea: e.target.value,
                              })
                            }
                            disabled={!ownerOrderForm.area}
                          >
                            <option value="">
                              {ownerOrderForm.area ? "Select sub area" : "Select area first"}
                            </option>
                            {ownerOrderSubAreaOptions.map((subArea) => (
                              <option key={subArea} value={subArea}>
                                {subArea}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="field" style={{ marginBottom: 0 }}>
                          <label>Preferred delivery agent (optional)</label>
                          <select
                            className="select"
                            value={ownerOrderForm.preferredAgentId}
                            onChange={(e) =>
                              setOwnerOrderForm({
                                ...ownerOrderForm,
                                preferredAgentId: e.target.value,
                              })
                            }
                          >
                            <option value="">Auto assign by area</option>
                            {deliveryAgents
                              .filter((agent) => agent.active)
                              .map((agent) => (
                                <option key={agent.id} value={agent.id}>
                                  {agent.name}
                                </option>
                              ))}
                          </select>
                        </div>
                        {ownerOrderLocLabel && (
                          <small className="payments-subtext">{ownerOrderLocLabel}</small>
                        )}
                        {ownerOrderLocation && (
                          <small className="payments-subtext">
                            {ownerOrderLocation.lat.toFixed(5)},{" "}
                            {ownerOrderLocation.lng.toFixed(5)}
                          </small>
                        )}
                        {ownerOrderLocError && (
                          <small style={{ color: "crimson" }}>{ownerOrderLocError}</small>
                        )}
                        {process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY && (
                          <div className="card stack customer-map-card" style={{ marginTop: 12 }}>
                            <div
                              className="row"
                              style={{ justifyContent: "space-between" }}
                            >
                              <strong>Select exact location on map</strong>
                            </div>
                            <LoadScript
                              googleMapsApiKey={
                                process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
                              }
                              libraries={["places"]}
                            >
                              <Autocomplete
                                onLoad={onOwnerOrderAutocompleteLoad}
                                onPlaceChanged={onOwnerOrderPlaceChanged}
                              >
                                <div className="row" style={{ marginBottom: 12 }}>
                                  <input
                                    className="input"
                                    placeholder="Search apartment / landmark"
                                    style={{ flex: 1 }}
                                  />
                                  <button
                                    type="button"
                                    className="btn secondary"
                                    onClick={useOwnerCurrentLocation}
                                  >
                                    Use current location
                                  </button>
                                </div>
                              </Autocomplete>
                              <GoogleMap
                                mapContainerStyle={mapContainerStyle}
                                center={ownerOrderLocation ?? defaultCenter}
                                zoom={ownerOrderLocation ? 16 : 13}
                                onClick={(e) => {
                                  if (!e.latLng) return;
                                  setOwnerOrderLocation({
                                    lat: e.latLng.lat(),
                                    lng: e.latLng.lng(),
                                  });
                                  setOwnerOrderLocError("");
                                  setOwnerOrderLocLabel("Location selected on map");
                                }}
                              >
                                {ownerOrderLocation && (
                                  <Marker position={ownerOrderLocation} />
                                )}
                              </GoogleMap>
                            </LoadScript>
                          </div>
                        )}
                      </>
                    )}

                    {ownerOrderError && (
                      <small style={{ color: "crimson" }}>{ownerOrderError}</small>
                    )}
                    {ownerOrderSuccess && (
                      <small style={{ color: "green" }}>{ownerOrderSuccess}</small>
                    )}

                    <button
                      className="btn"
                      onClick={createOwnerOrder}
                      disabled={ownerOrderSubmitting}
                    >
                      {ownerOrderSubmitting ? "Creating..." : "Create Order"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "dashboard" && (
            <div className="card stack">
              <h2>Report/Dashboard</h2>
              <div className="owner-filters-grid">
                <input
                  className="input"
                  placeholder="Search by Order ID / Phone / Customer"
                  value={reportFilters.search}
                  onChange={(e) =>
                    setReportFilters({
                      ...reportFilters,
                      search: e.target.value,
                    })
                  }
                />
                <input
                  className="input"
                  type="date"
                  value={reportFilters.startDate}
                  onChange={(e) =>
                    setReportFilters({
                      ...reportFilters,
                      startDate: e.target.value,
                    })
                  }
                />
                <input
                  className="input"
                  type="date"
                  value={reportFilters.endDate}
                  onChange={(e) =>
                    setReportFilters({
                      ...reportFilters,
                      endDate: e.target.value,
                    })
                  }
                />
                <select
                  className="select"
                  value={reportFilters.area}
                  onChange={(e) =>
                    setReportFilters({
                      ...reportFilters,
                      area: e.target.value,
                    })
                  }
                >
                  <option value="All">All areas</option>
                  {areaOptions.map((area) => (
                    <option key={area} value={area}>
                      {area}
                    </option>
                  ))}
                </select>
                <select
                  className="select"
                  value={reportFilters.deliveryType}
                  onChange={(e) =>
                    setReportFilters({
                      ...reportFilters,
                      deliveryType: e.target.value,
                    })
                  }
                >
                  <option value="All">All delivery types</option>
                  <option value="delivery">Home Delivery</option>
                  <option value="pickup">Self Pickup</option>
                </select>
                <select
                  className="select"
                  value={reportFilters.trend}
                  onChange={(e) =>
                    setReportFilters({
                      ...reportFilters,
                      trend: e.target.value,
                    })
                  }
                >
                  <option value="weekly">Weekly trend</option>
                  <option value="monthly">Monthly trend</option>
                </select>
                <button className="btn" onClick={runReport}>
                  Run
                </button>
              </div>

              <div className="owner-summary-metrics">
                <div className="card">
                  <small className="payments-subtext">Completed Orders</small>
                  <strong>{reportKpis.completedOrders}</strong>
                </div>
                <div className="card">
                  <small className="payments-subtext">Total Sales</small>
                  <strong>Rs. {reportKpis.totalSales}</strong>
                </div>
                <div className="card">
                  <small className="payments-subtext">Average Order Value</small>
                  <strong>Rs. {reportKpis.avgOrderValue}</strong>
                </div>
                <div className="card">
                  <small className="payments-subtext">Avg Items / Order</small>
                  <strong>{reportKpis.avgItemsPerOrder}</strong>
                </div>
                <div className="card">
                  <small className="payments-subtext">Home Delivery Orders</small>
                  <strong>{reportKpis.deliveryOrders}</strong>
                </div>
                <div className="card">
                  <small className="payments-subtext">Self Pickup Orders</small>
                  <strong>{reportKpis.pickupOrders}</strong>
                </div>
                <div className="card">
                  <small className="payments-subtext">COD Orders</small>
                  <strong>{reportKpis.codOrders}</strong>
                </div>
                <div className="card">
                  <small className="payments-subtext">COD Collected</small>
                  <strong>Rs. {reportKpis.codCollected}</strong>
                </div>
                <div className="card">
                  <small className="payments-subtext">Cancelled Orders</small>
                  <strong>{reportKpis.cancelledOrders}</strong>
                </div>
                <div className="card">
                  <small className="payments-subtext">Refund Pending</small>
                  <strong>{reportKpis.refundPending}</strong>
                </div>
                <div className="card">
                  <small className="payments-subtext">Unique Customers</small>
                  <strong>{reportKpis.uniqueCustomers}</strong>
                </div>
                <div className="card">
                  <small className="payments-subtext">Top Area</small>
                  <strong>{reportKpis.topArea}</strong>
                </div>
              </div>

              <div className="card stack">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <h3>
                    {appliedReportFilters.trend === "monthly"
                      ? "Monthly Sales Trend"
                      : "Weekly Sales Trend"}
                  </h3>
                  <small className="payments-subtext">Last 8 periods</small>
                </div>
                {salesTrendRows.length === 0 && <p>No sales trend data.</p>}
                {salesTrendRows.length > 0 && (
                  <div className="sales-trend-grid">
                    {salesTrendRows.map((row) => (
                      <div key={row.key} className="sales-trend-card">
                        <div
                          className="sales-trend-bar"
                          style={{
                            height: `${maxTrendSales ? Math.max((row.sales / maxTrendSales) * 180, 18) : 18}px`,
                          }}
                        />
                        <strong>Rs. {row.sales}</strong>
                        <small>{row.orders} orders</small>
                        <span>{row.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="row summary-tables-row">
                <div className="card" style={{ flex: 1 }}>
                  <h3>Completed Orders by Area</h3>
                  <div className="table-scroll">
                    <table className="payments-table payments-table-compact owner-summary-table">
                      <thead>
                        <tr>
                          <th>Area</th>
                          <th>Orders</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.keys(closedOrdersByArea).length === 0 && (
                          <tr>
                            <td colSpan={2}>No orders</td>
                          </tr>
                        )}
                        {Object.entries(closedOrdersByArea).map(([area, count]) => (
                          <tr key={area}>
                            <td>{area}</td>
                            <td>{count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="card" style={{ flex: 1 }}>
                  <h3>Delivered by Agent</h3>
                  <div className="table-scroll">
                    <table className="payments-table payments-table-compact owner-summary-table">
                      <thead>
                        <tr>
                          <th>Agent</th>
                          <th>Orders</th>
                          <th>Areas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.keys(deliveredByAgent).length === 0 && (
                          <tr>
                            <td colSpan={3}>No deliveries</td>
                          </tr>
                        )}
                        {Object.entries(deliveredByAgent).map(([agent, data]) => (
                          <tr key={agent}>
                            <td>{agent}</td>
                            <td>{data.total}</td>
                            <td>
                              {Object.entries(data.byArea)
                                .map(([area, count]) => `${area} (${count})`)
                                .join(", ")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="card">
                <h3>Completed Orders</h3>
                <div className="table-scroll">
                  <table className="payments-table payments-table-compact owner-summary-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Order ID</th>
                        <th>Customer</th>
                          <th>Area</th>
                          <th>Delivery Type</th>
                          <th>Payment</th>
                          <th>Payment Status</th>
                          <th>Items</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredClosedOrders.length === 0 && (
                          <tr>
                            <td colSpan={9}>No completed orders</td>
                          </tr>
                        )}
                      {filteredClosedOrders.map((order) => (
                        <tr key={order.id}>
                          <td>{formatDateLabel(order.createdAt || order.publishedDate)}</td>
                          <td>#{order.orderId || order.id}</td>
                          <td>{order.customerName || "-"}</td>
                          <td>
                            {order.area || "-"}
                            {order.subArea ? (
                              <small className="payments-subtext">{order.subArea}</small>
                            ) : null}
                          </td>
                          <td>
                            {order.deliveryType === "pickup"
                              ? "Self Pickup"
                              : "Home Delivery"}
                          </td>
                          <td>{getPaymentMethodLabel(order)}</td>
                          <td>{getPaymentStatusLabel(order)}</td>
                          <td>
                            {(order.items || [])
                              .map((item) => `${item.name} x${item.qty}`)
                              .join(", ")}
                          </td>
                          <td>Rs. {order.total || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card">
                <h3>Cancelled Orders</h3>
                <div className="table-scroll">
                  <table className="payments-table payments-table-compact owner-summary-table">
                    <thead>
                      <tr>
                        <th>Cancelled On</th>
                        <th>Order ID</th>
                        <th>Customer</th>
                        <th>Remarks</th>
                        <th>Delivery Type</th>
                        <th>Payment</th>
                        <th>Refund Status</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCancelledOrders.length === 0 && (
                        <tr>
                          <td colSpan={8}>No cancelled orders</td>
                        </tr>
                      )}
                      {filteredCancelledOrders.map((order) => (
                        <tr key={order.id}>
                          <td>{formatDateLabel(order.cancelledAt || order.createdAt || order.publishedDate)}</td>
                          <td>#{order.orderId || order.id}</td>
                          <td>{order.customerName || "-"}</td>
                          <td>{order.cancellationRemarks || "-"}</td>
                          <td>
                            {order.deliveryType === "pickup" ? "Self Pickup" : "Home Delivery"}
                          </td>
                          <td>{getPaymentMethodLabel(order)}</td>
                          <td>{order.paymentStatus === "refund_pending" ? "Refund Pending" : order.paymentStatus || "-"}</td>
                          <td>Rs. {order.total || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {tab === "history" && (
            <div className="card stack">
              <h2>Orders</h2>
              <div className="row">
                <button
                  className={`btn ${historyTab === "summary" ? "" : "secondary"}`}
                  onClick={() => setHistoryTab("summary")}
                >
                  Summary
                </button>
                <button
                  className={`btn ${historyTab === "activeOrders" ? "" : "secondary"}`}
                  onClick={() => setHistoryTab("activeOrders")}
                >
                  Active Orders
                </button>
                <button
                  className={`btn ${historyTab === "pastOrders" ? "" : "secondary"}`}
                  onClick={() => setHistoryTab("pastOrders")}
                >
                  Past Orders
                </button>
                <button
                  className={`btn ${historyTab === "paymentStatus" ? "" : "secondary"}`}
                  onClick={() => setHistoryTab("paymentStatus")}
                >
                  Payment Status
                </button>
              </div>

              {historyTab === "summary" && (
                <div className="stack">
                  {!currentPublishedMenu && <p>No published menu available.</p>}
                  {currentPublishedMenu && (
                    <>
                      <div className="card owner-summary-hero stack">
                        <div className="owner-summary-header">
                          <div>
                            <small className="payments-subtext">Current live menu</small>
                            <h3>
                              {formatDateLabel(currentPublishedMenu.date)} -{" "}
                              {currentPublishedMenu.mealType || "Unknown"}
                            </h3>
                          </div>
                          <span className="status-chip">
                            {currentPublishedMenu.isArchived
                              ? "Archived"
                              : currentPublishedMenu.ordersStopped
                                ? "Sold Out"
                                : "Live"}
                          </span>
                        </div>
                        <div className="owner-summary-metrics">
                          <div className="card">
                            <small className="payments-subtext">Total orders</small>
                            <strong>{currentOrdersSummary.totalOrders}</strong>
                          </div>
                          <div className="card">
                            <small className="payments-subtext">Items count</small>
                            <strong>{currentOrdersSummary.totalItems}</strong>
                          </div>
                          <div className="card">
                            <small className="payments-subtext">Total value</small>
                            <strong>Rs. {currentOrdersSummary.totalValue}</strong>
                            <small className="payments-subtext">
                              UPI: Rs. {currentOrdersSummary.upiValue} | COD: Rs. {currentOrdersSummary.codValue} | SP: Rs. {currentOrdersSummary.selfPickupValue}
                            </small>
                          </div>
                          <div className="card">
                            <small className="payments-subtext">COD orders</small>
                            <strong>{currentOrdersSummary.codOrders}</strong>
                          </div>
                          <div className="card">
                            <small className="payments-subtext">Cancelled orders</small>
                            <strong>{currentCancelledOrderRows.length}</strong>
                          </div>
                        </div>
                      </div>

                      <div className="row summary-tables-row">
                        <div className="card" style={{ flex: 1 }}>
                          <h3>Orders by Area</h3>
                          <div className="table-scroll">
                            <table className="payments-table payments-table-compact owner-summary-table">
                              <thead>
                                <tr>
                                  <th>Area</th>
                                  <th>Orders</th>
                                </tr>
                              </thead>
                              <tbody>
                                {activeAreaRows.length === 0 && (
                                  <tr>
                                    <td colSpan={2}>No area data</td>
                                  </tr>
                                )}
                                {activeAreaRows.map((row) => (
                                  <tr key={row.key}>
                                    <td>{row.area}</td>
                                    <td>{row.count}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                        <div className="card" style={{ flex: 1 }}>
                          <h3>Items Count</h3>
                          <div className="table-scroll">
                            <table className="payments-table payments-table-compact owner-summary-table">
                              <thead>
                                <tr>
                                  <th>Item</th>
                                  <th>Qty</th>
                                </tr>
                              </thead>
                              <tbody>
                                {activeItemRows.length === 0 && (
                                  <tr>
                                    <td colSpan={2}>No item data</td>
                                  </tr>
                                )}
                                {activeItemRows.map((row) => (
                                  <tr key={row.key}>
                                    <td>{row.itemName}</td>
                                    <td>{row.count}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                      <div className="card">
                        <h3>Item Packing Pairs</h3>
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
                                    colSpan={
                                      Math.max(activeItemPackingMatrix.packQtyColumns.length + 1, 2)
                                    }
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
                      <div className="card">
                        <h3>Cancelled Orders</h3>
                        <div className="table-scroll">
                          <table className="payments-table payments-table-compact owner-summary-table">
                            <thead>
                              <tr>
                                <th>Cancelled On</th>
                                <th>Order ID</th>
                                <th>Customer</th>
                                <th>Remarks</th>
                                <th>Type</th>
                                <th>Payment</th>
                                <th>Refund Status</th>
                                <th>Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {currentCancelledOrderRows.length === 0 && (
                                <tr>
                                  <td colSpan={8}>No cancelled orders for this menu</td>
                                </tr>
                              )}
                              {currentCancelledOrderRows.map((row) => (
                                <tr key={row.id}>
                                  <td>{formatDateLabel(row.cancelledAt)}</td>
                                  <td>#{row.orderId}</td>
                                  <td>{row.customerName}</td>
                                  <td>{row.remarks}</td>
                                  <td>{row.deliveryType}</td>
                                  <td>{row.paymentMethod}</td>
                                  <td>{row.paymentStatus}</td>
                                  <td>Rs. {row.total}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                      <div className="card">
                        <h3>Orders by Delivery Type</h3>
                        <div className="table-scroll">
                            <table className="payments-table payments-table-compact owner-summary-table">
                            <thead>
                              <tr>
                                <th>Delivery Type</th>
                                <th>Orders</th>
                              </tr>
                            </thead>
                            <tbody>
                              {activeDeliveryTypeRows.length === 0 && (
                                <tr>
                                  <td colSpan={2}>No delivery type data</td>
                                </tr>
                              )}
                              {activeDeliveryTypeRows.map((row) => (
                                <tr key={row.key}>
                                  <td>{row.deliveryType}</td>
                                  <td>{row.count}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                      <div className="card">
                        <h3>Orders by Delivery Agent</h3>
                        <div className="table-scroll">
                            <table className="payments-table payments-table-compact owner-summary-table">
                            <thead>
                              <tr>
                                <th>Delivery Agent</th>
                                <th>Orders</th>
                                <th>Items Count</th>
                                <th>Areas</th>
                                <th>Items</th>
                                <th>Total Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {activeAgentDetailRows.length === 0 && (
                                <tr>
                                  <td colSpan={6}>No delivery agent data</td>
                                </tr>
                              )}
                              {activeAgentDetailRows.map((row) => (
                                <tr key={row.key}>
                                  <td>{row.agent}</td>
                                  <td>{row.orders}</td>
                                  <td>{row.totalItems}</td>
                                  <td>
                                    {Object.keys(row.areas).length === 0
                                      ? "-"
                                      : Object.entries(row.areas)
                                          .map(([area, count]) => `${area} (${count})`)
                                          .join(", ")}
                                  </td>
                                  <td>
                                    {Object.keys(row.itemCounts).length === 0
                                      ? "-"
                                      : Object.entries(row.itemCounts)
                                          .map(([itemName, count]) => `${itemName} x${count}`)
                                          .join(", ")}
                                  </td>
                                  <td>Rs. {row.totalValue}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {historyTab === "activeOrders" && (
                <div className="stack">
                  <div className="card stack">
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <div>
                        <strong>Order Placed WhatsApp</strong>
                        <small className="payments-subtext" style={{ display: "block" }}>
                          Open one prefilled WhatsApp message per order and send it from your
                          WhatsApp Web/app.
                        </small>
                      </div>
                      <div className="row" style={{ gap: 10 }}>
                        <button className="btn secondary" onClick={exportActiveOrdersCsv}>
                          Export to Excel
                        </button>
                        <button
                          className="btn secondary"
                          onClick={() => {
                            if (!pendingPlacedNotificationOrders.length) {
                              window.alert("No pending WhatsApp notifications in the current list.");
                              return;
                            }
                            openPlacedNotification(pendingPlacedNotificationOrders[0]);
                          }}
                        >
                          Open Next
                        </button>
                      </div>
                    </div>
                    <small className="payments-subtext">
                      Pending notifications: {pendingPlacedNotificationOrders.length}
                    </small>
                  </div>
                  <div className="owner-filters-grid">
                    <input
                      className="input"
                      placeholder="Search by order ID / customer / phone / item"
                      value={activeOrderSearch}
                      onChange={(e) => setActiveOrderSearch(e.target.value)}
                    />
                    <select
                      className="select"
                      value={activeOrderDeliveryFilter}
                      onChange={(e) => setActiveOrderDeliveryFilter(e.target.value)}
                    >
                      <option value="All">All delivery types</option>
                      <option value="delivery">Home Delivery</option>
                      <option value="pickup">Self Pickup</option>
                    </select>
                    <select
                      className="select"
                      value={activeOrderAreaFilter}
                      onChange={(e) => setActiveOrderAreaFilter(e.target.value)}
                    >
                      <option value="All">All areas</option>
                      {areaOptions.map((area) => (
                        <option key={area} value={area}>
                          {area}
                        </option>
                      ))}
                    </select>
                    <select
                      className="select"
                      value={activeOrderStatusFilter}
                      onChange={(e) => setActiveOrderStatusFilter(e.target.value)}
                    >
                      <option value="All">All statuses</option>
                      <option value="Active">Active</option>
                      <option value="Delivered">Delivered</option>
                      <option value="Picked Up">Picked Up</option>
                      <option value="Undelivered">Undelivered</option>
                      <option value="Payment Pending">Payment Pending</option>
                    </select>
                  </div>
                  {filteredActiveOrders.length === 0 && <p>No active orders for the live menu.</p>}
                  {filteredActiveOrders.length > 0 && (
                    <div className="table-scroll owner-orders-table-scroll">
                      <table className="payments-table owner-orders-table">
                        <thead>
                            <tr>
                              <th>Order ID</th>
                              <th>Customer</th>
                            <th>Phone</th>
                            <th>Delivery Type</th>
                            <th>Area</th>
                            <th>Address</th>
                            <th>Items</th>
                              <th>Delivery Agent</th>
                              <th>Payment</th>
                              <th>Total Value</th>
                              <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                          {filteredActiveOrders.map((order) => (
                            <Fragment key={order.id}>
                              <tr>
                                <td>#{order.orderId || order.id}</td>
                                <td>{order.customerName || "Customer"}</td>
                                <td>{order.phone || "-"}</td>
                                <td>
                                  {order.deliveryType === "pickup"
                                    ? "Self Pickup"
                                    : "Home Delivery"}
                                </td>
                                <td>
                                  {order.area || "-"}
                                  {order.subArea ? (
                                    <small className="payments-subtext">{order.subArea}</small>
                                  ) : null}
                                </td>
                                <td>
                                  {order.address || "-"}
                                  {order.location && (
                                    <small className="payments-subtext">
                                      {formatLocationInput(order.location)}
                                    </small>
                                  )}
                                </td>
                                <td>
                                  {(order.items || []).map((item) => (
                                    <div key={`${order.id}-${item.name}`}>
                                      {item.name} x{item.qty}
                                    </div>
                                  ))}
                                </td>
                                <td>
                                  {order.deliveryType === "delivery"
                                    ? order.assignedAgentName || "Unassigned"
                                    : "Pickup"}
                                </td>
                                <td>
                                  {getPaymentMethodLabel(order)}
                                </td>
                                <td>Rs. {order.total || 0}</td>
                                <td>
                                  <div
                                    className="stack owner-orders-actions-cell"
                                    style={{ gap: 6 }}
                                    data-owner-order-actions
                                  >
                                    <button
                                      className="btn secondary btn-compact"
                                      onClick={() => openPlacedNotification(order)}
                                      disabled={!getWhatsAppPhone(order.phone)}
                                    >
                                      WhatsApp
                                    </button>
                                    {placedNotificationSentIds.includes(order.id) && (
                                      <small className="payments-subtext">Opened</small>
                                    )}
                                    <button
                                      className="btn secondary btn-compact"
                                      onClick={() =>
                                        setOpenActiveOrderActionsId(
                                          openActiveOrderActionsId === order.id ? null : order.id
                                        )
                                      }
                                    >
                                      Actions
                                    </button>
                                    {openActiveOrderActionsId === order.id && (
                                      <div className="list-card stack" style={{ gap: 6 }}>
                                        <button
                                          className="btn secondary btn-compact"
                                          onClick={() => openActiveOrderEditor(order)}
                                        >
                                          Edit
                                        </button>
                                        {canOwnerCancelOrder(order) && (
                                          <button
                                            className="btn secondary btn-compact"
                                            onClick={() => openOwnerCancelOrder(order)}
                                          >
                                            Cancel
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                              {cancellingOwnerOrderId === order.id && (
                                <tr className="payments-edit-row">
                                  <td colSpan={11}>
                                    <div className="stack" style={{ gap: 10 }}>
                                      <strong>Cancel Order #{order.orderId || order.id}</strong>
                                      <input
                                        className="input"
                                        placeholder="Cancellation remarks / reason"
                                        value={ownerCancelRemarks}
                                        onChange={(e) => setOwnerCancelRemarks(e.target.value)}
                                      />
                                      {ownerCancelError && (
                                        <small className="customer-error-text">{ownerCancelError}</small>
                                      )}
                                      <div className="row">
                                        <button
                                          className="btn"
                                          onClick={() => cancelOrderByOwner(order)}
                                        >
                                          Confirm Cancel
                                        </button>
                                        <button
                                          className="btn secondary"
                                          onClick={() => {
                                            setCancellingOwnerOrderId(null);
                                            setOwnerCancelRemarks("");
                                            setOwnerCancelError("");
                                          }}
                                        >
                                          Close
                                        </button>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                              {editingActiveOrderId === order.id && (
                                <tr className="payments-edit-row">
                                  <td colSpan={11}>
                                    <div className="order-edit-grid">
                                      <input
                                        className="input"
                                        placeholder="Customer name"
                                        value={activeOrderEditForm.customerName}
                                        onChange={(e) =>
                                          setActiveOrderEditForm({
                                            ...activeOrderEditForm,
                                            customerName: e.target.value,
                                          })
                                        }
                                      />
                                      <input
                                        className="input"
                                        placeholder="Phone number"
                                        value={activeOrderEditForm.phone}
                                        onChange={(e) =>
                                          setActiveOrderEditForm({
                                            ...activeOrderEditForm,
                                            phone: e.target.value,
                                          })
                                        }
                                      />
                                      <select
                                        className="select"
                                        value={activeOrderEditForm.deliveryType}
                                        onChange={(e) =>
                                          setActiveOrderEditForm({
                                            ...activeOrderEditForm,
                                            deliveryType: e.target.value,
                                            assignedAgentId:
                                              e.target.value === "delivery"
                                                ? activeOrderEditForm.assignedAgentId
                                                : "",
                                          })
                                        }
                                      >
                                        <option value="pickup">Self Pickup</option>
                                        <option value="delivery">Home Delivery</option>
                                      </select>
                                      <select
                                        className="select"
                                        value={activeOrderEditForm.status}
                                        onChange={(e) =>
                                          setActiveOrderEditForm({
                                            ...activeOrderEditForm,
                                            status: e.target.value,
                                          })
                                        }
                                        disabled={order.status === "payment_pending"}
                                      >
                                        <option value="active">Active</option>
                                        <option value="closed">Closed</option>
                                        <option value="undelivered">Undelivered</option>
                                      </select>
                                      {activeOrderEditForm.deliveryType === "delivery" && (
                                        <>
                                          <input
                                            className="input"
                                            placeholder="Door no / Apartment / House name"
                                            value={activeOrderEditForm.addressLine1}
                                            onChange={(e) =>
                                              setActiveOrderEditForm({
                                                ...activeOrderEditForm,
                                                addressLine1: e.target.value,
                                              })
                                            }
                                          />
                                          <input
                                            className="input"
                                            placeholder="Street"
                                            value={activeOrderEditForm.street}
                                            onChange={(e) =>
                                              setActiveOrderEditForm({
                                                ...activeOrderEditForm,
                                                street: e.target.value,
                                              })
                                            }
                                          />
                                          <select
                                            className="select"
                                            value={activeOrderEditForm.area}
                                            onChange={(e) =>
                                              setActiveOrderEditForm({
                                                ...activeOrderEditForm,
                                                area: e.target.value,
                                                subArea: "",
                                              })
                                            }
                                          >
                                            <option value="">Select area</option>
                                            {areaOptions.map((area) => (
                                              <option key={area} value={area}>
                                                {area}
                                              </option>
                                              ))}
                                          </select>
                                          <select
                                            className="select"
                                            value={activeOrderEditForm.subArea}
                                            onChange={(e) =>
                                              setActiveOrderEditForm({
                                                ...activeOrderEditForm,
                                                subArea: e.target.value,
                                              })
                                            }
                                            disabled={!activeOrderEditForm.area}
                                          >
                                            <option value="">
                                              {activeOrderEditForm.area
                                                ? "Select sub area"
                                                : "Select area first"}
                                            </option>
                                            {activeOrderEditSubAreaOptions.map((subArea) => (
                                              <option key={subArea} value={subArea}>
                                                {subArea}
                                              </option>
                                            ))}
                                          </select>
                                          <select
                                            className="select"
                                            value={activeOrderEditForm.assignedAgentId}
                                            onChange={(e) =>
                                              setActiveOrderEditForm({
                                                ...activeOrderEditForm,
                                                assignedAgentId: e.target.value,
                                              })
                                            }
                                          >
                                            <option value="">Unassigned</option>
                                            {deliveryAgents
                                              .filter((agent) => agent.active)
                                              .map((agent) => (
                                                <option key={agent.id} value={agent.id}>
                                                  {agent.name}
                                                </option>
                                              ))}
                                          </select>
                                          <input
                                            className="input"
                                            placeholder="Exact location / map link / landmark"
                                            value={activeOrderEditForm.location}
                                            onChange={(e) =>
                                              setActiveOrderEditForm({
                                                ...activeOrderEditForm,
                                                location: e.target.value,
                                              })
                                            }
                                          />
                                        </>
                                      )}
                                      {activeOrderEditError && (
                                        <small style={{ color: "crimson" }}>
                                          {activeOrderEditError}
                                        </small>
                                      )}
                                      <div className="payments-edit-actions">
                                        <button
                                          className="btn btn-compact"
                                          onClick={() => saveActiveOrderEdits(order)}
                                        >
                                          Save
                                        </button>
                                        <button
                                          className="btn secondary btn-compact"
                                          onClick={() => {
                                            setEditingActiveOrderId(null);
                                            setActiveOrderEditError("");
                                          }}
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {historyTab === "pastOrders" && (
                <div className="stack">
                  <div className="card stack">
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <div>
                        <strong>Past Menu Workspace</strong>
                        <small className="payments-subtext" style={{ display: "block" }}>
                          Select a previously published menu to manage its unfinished orders.
                        </small>
                      </div>
                      <button
                        className="btn secondary"
                        onClick={() => {
                          if (!pendingPastPlacedNotificationOrders.length) {
                            window.alert("No pending WhatsApp notifications in the current list.");
                            return;
                          }
                          openPlacedNotification(pendingPastPlacedNotificationOrders[0]);
                        }}
                      >
                        Open Next
                      </button>
                    </div>
                    <div className="owner-filters-grid">
                      <select
                        className="select"
                        value={selectedPastMenuKey}
                        onChange={(e) => setSelectedPastMenuKey(e.target.value)}
                      >
                        <option value="">Select published menu</option>
                        {pastPublishedMenuOptions.map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <input
                        className="input"
                        placeholder="Search by order ID / customer / phone / item"
                        value={pastOrderSearch}
                        onChange={(e) => setPastOrderSearch(e.target.value)}
                      />
                      <select
                        className="select"
                        value={pastOrderDeliveryFilter}
                        onChange={(e) => setPastOrderDeliveryFilter(e.target.value)}
                      >
                        <option value="All">All delivery types</option>
                        <option value="delivery">Home Delivery</option>
                        <option value="pickup">Self Pickup</option>
                      </select>
                      <select
                        className="select"
                        value={pastOrderAreaFilter}
                        onChange={(e) => setPastOrderAreaFilter(e.target.value)}
                      >
                        <option value="All">All areas</option>
                        {areaOptions.map((area) => (
                          <option key={area} value={area}>
                            {area}
                          </option>
                        ))}
                      </select>
                      <select
                        className="select"
                        value={pastOrderStatusFilter}
                        onChange={(e) => setPastOrderStatusFilter(e.target.value)}
                      >
                        <option value="All">All statuses</option>
                        <option value="Active">Active</option>
                        <option value="Delivered">Delivered</option>
                        <option value="Picked Up">Picked Up</option>
                        <option value="Undelivered">Undelivered</option>
                        <option value="Payment Pending">Payment Pending</option>
                      </select>
                    </div>
                    <small className="payments-subtext">
                      Pending notifications: {pendingPastPlacedNotificationOrders.length}
                    </small>
                  </div>

                  {!selectedPastMenuOption && <p>No past published menu available.</p>}

                  {selectedPastMenuOption && (
                    <>
                      <div className="card owner-summary-hero stack">
                        <div className="owner-summary-header">
                          <div>
                            <small className="payments-subtext">Selected past menu</small>
                            <h3>
                              {formatDateLabel(selectedPastMenuOption.date)} - {selectedPastMenuOption.mealType}
                            </h3>
                          </div>
                          <span className="status-chip">Past</span>
                        </div>
                        <div className="owner-summary-metrics">
                          <div className="card">
                            <small className="payments-subtext">Total orders</small>
                            <strong>{pastOrdersSummary.totalOrders}</strong>
                          </div>
                          <div className="card">
                            <small className="payments-subtext">Items count</small>
                            <strong>{pastOrdersSummary.totalItems}</strong>
                          </div>
                          <div className="card">
                            <small className="payments-subtext">Total value</small>
                            <strong>Rs. {pastOrdersSummary.totalValue}</strong>
                            <small className="payments-subtext">
                              UPI: Rs. {pastOrdersSummary.upiValue} | COD: Rs. {pastOrdersSummary.codValue} | SP: Rs. {pastOrdersSummary.selfPickupValue}
                            </small>
                          </div>
                          <div className="card">
                            <small className="payments-subtext">COD orders</small>
                            <strong>{pastOrdersSummary.codOrders}</strong>
                          </div>
                          <div className="card">
                            <small className="payments-subtext">Cancelled orders</small>
                            <strong>{pastCancelledOrderRows.length}</strong>
                          </div>
                        </div>
                      </div>

                      <div className="row summary-tables-row">
                        <div className="card" style={{ flex: 1 }}>
                          <h3>Orders by Area</h3>
                          <div className="table-scroll">
                            <table className="payments-table payments-table-compact owner-summary-table">
                              <thead>
                                <tr>
                                  <th>Area</th>
                                  <th>Orders</th>
                                </tr>
                              </thead>
                              <tbody>
                                {pastAreaRows.length === 0 && (
                                  <tr>
                                    <td colSpan={2}>No area data</td>
                                  </tr>
                                )}
                                {pastAreaRows.map((row) => (
                                  <tr key={row.key}>
                                    <td>{row.area}</td>
                                    <td>{row.count}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                        <div className="card" style={{ flex: 1 }}>
                          <h3>Items Count</h3>
                          <div className="table-scroll">
                            <table className="payments-table payments-table-compact owner-summary-table">
                              <thead>
                                <tr>
                                  <th>Item</th>
                                  <th>Qty</th>
                                </tr>
                              </thead>
                              <tbody>
                                {pastItemRows.length === 0 && (
                                  <tr>
                                    <td colSpan={2}>No item data</td>
                                  </tr>
                                )}
                                {pastItemRows.map((row) => (
                                  <tr key={row.key}>
                                    <td>{row.itemName}</td>
                                    <td>{row.count}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>

                      <div className="card">
                        <h3>Item Packing Pairs</h3>
                        <div className="table-scroll">
                          <table className="payments-table payments-table-compact owner-summary-packing-table">
                            <thead>
                              <tr>
                                <th>Item</th>
                                {pastItemPackingMatrix.packQtyColumns.map((packQty) => (
                                  <th key={packQty}>{packQty} Pack</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {pastItemPackingMatrix.rows.length === 0 && (
                                <tr>
                                  <td colSpan={Math.max(pastItemPackingMatrix.packQtyColumns.length + 1, 2)}>
                                    No packing data
                                  </td>
                                </tr>
                              )}
                              {pastItemPackingMatrix.rows.map((row) => (
                                <tr key={row.key}>
                                  <td>{row.itemName}</td>
                                  {pastItemPackingMatrix.packQtyColumns.map((packQty) => (
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

                      <div className="card">
                        <h3>Cancelled Orders</h3>
                        <div className="table-scroll">
                          <table className="payments-table payments-table-compact owner-summary-table">
                            <thead>
                              <tr>
                                <th>Cancelled On</th>
                                <th>Order ID</th>
                                <th>Customer</th>
                                <th>Remarks</th>
                                <th>Type</th>
                                <th>Payment</th>
                                <th>Refund Status</th>
                                <th>Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pastCancelledOrderRows.length === 0 && (
                                <tr>
                                  <td colSpan={8}>No cancelled orders for this menu</td>
                                </tr>
                              )}
                              {pastCancelledOrderRows.map((row) => (
                                <tr key={row.id}>
                                  <td>{formatDateLabel(row.cancelledAt)}</td>
                                  <td>#{row.orderId}</td>
                                  <td>{row.customerName}</td>
                                  <td>{row.remarks}</td>
                                  <td>{row.deliveryType}</td>
                                  <td>{row.paymentMethod}</td>
                                  <td>{row.paymentStatus}</td>
                                  <td>Rs. {row.total}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div className="card">
                        <h3>Orders by Delivery Type</h3>
                        <div className="table-scroll">
                          <table className="payments-table payments-table-compact owner-summary-table">
                            <thead>
                              <tr>
                                <th>Delivery Type</th>
                                <th>Orders</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pastDeliveryTypeRows.length === 0 && (
                                <tr>
                                  <td colSpan={2}>No delivery type data</td>
                                </tr>
                              )}
                              {pastDeliveryTypeRows.map((row) => (
                                <tr key={row.key}>
                                  <td>{row.deliveryType}</td>
                                  <td>{row.count}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div className="card">
                        <h3>Orders by Delivery Agent</h3>
                        <div className="table-scroll">
                          <table className="payments-table payments-table-compact owner-summary-table">
                            <thead>
                              <tr>
                                <th>Delivery Agent</th>
                                <th>Orders</th>
                                <th>Items Count</th>
                                <th>Areas</th>
                                <th>Items</th>
                                <th>Total Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pastAgentDetailRows.length === 0 && (
                                <tr>
                                  <td colSpan={6}>No delivery agent data</td>
                                </tr>
                              )}
                              {pastAgentDetailRows.map((row) => (
                                <tr key={row.key}>
                                  <td>{row.agent}</td>
                                  <td>{row.orders}</td>
                                  <td>{row.totalItems}</td>
                                  <td>
                                    {Object.keys(row.areas).length === 0
                                      ? "-"
                                      : Object.entries(row.areas)
                                          .map(([area, count]) => `${area} (${count})`)
                                          .join(", ")}
                                  </td>
                                  <td>
                                    {Object.keys(row.itemCounts).length === 0
                                      ? "-"
                                      : Object.entries(row.itemCounts)
                                          .map(([itemName, count]) => `${itemName} x${count}`)
                                          .join(", ")}
                                  </td>
                                  <td>Rs. {row.totalValue}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </>
                  )}

                  {selectedPastMenuOption && filteredPastOrders.length === 0 && <p>No orders found for the selected menu and filters.</p>}
                  {selectedPastMenuOption && filteredPastOrders.length > 0 && (
                    <div className="table-scroll owner-orders-table-scroll">
                      <table className="payments-table owner-orders-table">
                        <thead>
                          <tr>
                            <th>Order ID</th>
                            <th>Customer</th>
                            <th>Phone</th>
                            <th>Meal</th>
                            <th>Delivery Type</th>
                            <th>Area</th>
                            <th>Address</th>
                            <th>Items</th>
                            <th>Delivery Agent</th>
                            <th>Payment</th>
                            <th>Status</th>
                            <th>Total Value</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredPastOrders.map((order) => (
                            <Fragment key={`past-${order.id}`}>
                              <tr>
                                <td>
                                  #{order.orderId || order.id}
                                  <small className="payments-subtext">
                                    {formatDateLabel(order.createdAt || order.publishedDate)}
                                  </small>
                                </td>
                                <td>{order.customerName || "Customer"}</td>
                                <td>{order.phone || "-"}</td>
                                <td>{order.mealType || "-"}</td>
                                <td>
                                  {order.deliveryType === "pickup" ? "Self Pickup" : "Home Delivery"}
                                </td>
                                <td>
                                  {order.area || "-"}
                                  {order.subArea ? (
                                    <small className="payments-subtext">{order.subArea}</small>
                                  ) : null}
                                </td>
                                <td>
                                  {order.address || "-"}
                                  {order.location && (
                                    <small className="payments-subtext">
                                      {formatLocationInput(order.location)}
                                    </small>
                                  )}
                                </td>
                                <td>
                                  {(order.items || []).map((item) => (
                                    <div key={`past-${order.id}-${item.name}`}>
                                      {item.name} x{item.qty}
                                    </div>
                                  ))}
                                </td>
                                <td>
                                  {order.deliveryType === "delivery"
                                    ? order.assignedAgentName || "Unassigned"
                                    : "Pickup"}
                                </td>
                                <td>{getPaymentMethodLabel(order)}</td>
                                <td>{getOrderStatusLabel(order)}</td>
                                <td>Rs. {order.total || 0}</td>
                                <td>
                                  <div
                                    className="stack owner-orders-actions-cell"
                                    style={{ gap: 6 }}
                                    data-owner-order-actions
                                  >
                                    <button
                                      className="btn secondary btn-compact"
                                      onClick={() => openPlacedNotification(order)}
                                      disabled={!getWhatsAppPhone(order.phone)}
                                    >
                                      WhatsApp
                                    </button>
                                    {placedNotificationSentIds.includes(order.id) && (
                                      <small className="payments-subtext">Opened</small>
                                    )}
                                    <button
                                      className="btn secondary btn-compact"
                                      onClick={() =>
                                        setOpenActiveOrderActionsId(
                                          openActiveOrderActionsId === order.id ? null : order.id
                                        )
                                      }
                                    >
                                      Actions
                                    </button>
                                    {openActiveOrderActionsId === order.id && (
                                      <div className="list-card stack" style={{ gap: 6 }}>
                                        <button
                                          className="btn secondary btn-compact"
                                          onClick={() => openActiveOrderEditor(order)}
                                        >
                                          Edit
                                        </button>
                                        {canOwnerCancelOrder(order) && (
                                          <button
                                            className="btn secondary btn-compact"
                                            onClick={() => openOwnerCancelOrder(order)}
                                          >
                                            Cancel
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                              {cancellingOwnerOrderId === order.id && (
                                <tr className="payments-edit-row">
                                  <td colSpan={13}>
                                    <div className="stack" style={{ gap: 10 }}>
                                      <strong>Cancel Order #{order.orderId || order.id}</strong>
                                      <input
                                        className="input"
                                        placeholder="Cancellation remarks / reason"
                                        value={ownerCancelRemarks}
                                        onChange={(e) => setOwnerCancelRemarks(e.target.value)}
                                      />
                                      {ownerCancelError && (
                                        <small className="customer-error-text">{ownerCancelError}</small>
                                      )}
                                      <div className="row">
                                        <button className="btn" onClick={() => cancelOrderByOwner(order)}>
                                          Confirm Cancel
                                        </button>
                                        <button
                                          className="btn secondary"
                                          onClick={() => {
                                            setCancellingOwnerOrderId(null);
                                            setOwnerCancelRemarks("");
                                            setOwnerCancelError("");
                                          }}
                                        >
                                          Close
                                        </button>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                              {editingActiveOrderId === order.id && (
                                <tr className="payments-edit-row">
                                  <td colSpan={13}>
                                    <div className="order-edit-grid">
                                      <input
                                        className="input"
                                        placeholder="Customer name"
                                        value={activeOrderEditForm.customerName}
                                        onChange={(e) =>
                                          setActiveOrderEditForm({
                                            ...activeOrderEditForm,
                                            customerName: e.target.value,
                                          })
                                        }
                                      />
                                      <input
                                        className="input"
                                        placeholder="Phone number"
                                        value={activeOrderEditForm.phone}
                                        onChange={(e) =>
                                          setActiveOrderEditForm({
                                            ...activeOrderEditForm,
                                            phone: e.target.value,
                                          })
                                        }
                                      />
                                      <select
                                        className="select"
                                        value={activeOrderEditForm.deliveryType}
                                        onChange={(e) =>
                                          setActiveOrderEditForm({
                                            ...activeOrderEditForm,
                                            deliveryType: e.target.value,
                                            assignedAgentId:
                                              e.target.value === "delivery"
                                                ? activeOrderEditForm.assignedAgentId
                                                : "",
                                          })
                                        }
                                      >
                                        <option value="pickup">Self Pickup</option>
                                        <option value="delivery">Home Delivery</option>
                                      </select>
                                      <select
                                        className="select"
                                        value={activeOrderEditForm.status}
                                        onChange={(e) =>
                                          setActiveOrderEditForm({
                                            ...activeOrderEditForm,
                                            status: e.target.value,
                                          })
                                        }
                                        disabled={order.status === "payment_pending"}
                                      >
                                        <option value="active">Active</option>
                                        <option value="closed">Closed</option>
                                        <option value="undelivered">Undelivered</option>
                                      </select>
                                      {activeOrderEditForm.deliveryType === "delivery" && (
                                        <>
                                          <input
                                            className="input"
                                            placeholder="Door no / Apartment / House name"
                                            value={activeOrderEditForm.addressLine1}
                                            onChange={(e) =>
                                              setActiveOrderEditForm({
                                                ...activeOrderEditForm,
                                                addressLine1: e.target.value,
                                              })
                                            }
                                          />
                                          <input
                                            className="input"
                                            placeholder="Street"
                                            value={activeOrderEditForm.street}
                                            onChange={(e) =>
                                              setActiveOrderEditForm({
                                                ...activeOrderEditForm,
                                                street: e.target.value,
                                              })
                                            }
                                          />
                                          <select
                                            className="select"
                                            value={activeOrderEditForm.area}
                                            onChange={(e) =>
                                              setActiveOrderEditForm({
                                                ...activeOrderEditForm,
                                                area: e.target.value,
                                                subArea: "",
                                              })
                                            }
                                          >
                                            <option value="">Select area</option>
                                            {areaOptions.map((area) => (
                                              <option key={area} value={area}>
                                                {area}
                                              </option>
                                            ))}
                                          </select>
                                          <select
                                            className="select"
                                            value={activeOrderEditForm.subArea}
                                            onChange={(e) =>
                                              setActiveOrderEditForm({
                                                ...activeOrderEditForm,
                                                subArea: e.target.value,
                                              })
                                            }
                                            disabled={!activeOrderEditForm.area}
                                          >
                                            <option value="">
                                              {activeOrderEditForm.area
                                                ? "Select sub area"
                                                : "Select area first"}
                                            </option>
                                            {activeOrderEditSubAreaOptions.map((subArea) => (
                                              <option key={subArea} value={subArea}>
                                                {subArea}
                                              </option>
                                            ))}
                                          </select>
                                          <select
                                            className="select"
                                            value={activeOrderEditForm.assignedAgentId}
                                            onChange={(e) =>
                                              setActiveOrderEditForm({
                                                ...activeOrderEditForm,
                                                assignedAgentId: e.target.value,
                                              })
                                            }
                                          >
                                            <option value="">Unassigned</option>
                                            {deliveryAgents
                                              .filter((agent) => agent.active)
                                              .map((agent) => (
                                                <option key={agent.id} value={agent.id}>
                                                  {agent.name}
                                                </option>
                                              ))}
                                          </select>
                                          <input
                                            className="input"
                                            placeholder="Exact location / map link / landmark"
                                            value={activeOrderEditForm.location}
                                            onChange={(e) =>
                                              setActiveOrderEditForm({
                                                ...activeOrderEditForm,
                                                location: e.target.value,
                                              })
                                            }
                                          />
                                        </>
                                      )}
                                      {activeOrderEditError && (
                                        <small style={{ color: "crimson" }}>{activeOrderEditError}</small>
                                      )}
                                      <div className="payments-edit-actions">
                                        <button
                                          className="btn btn-compact"
                                          onClick={() => saveActiveOrderEdits(order)}
                                        >
                                          Save
                                        </button>
                                        <button
                                          className="btn secondary btn-compact"
                                          onClick={() => {
                                            setEditingActiveOrderId(null);
                                            setActiveOrderEditError("");
                                          }}
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {historyTab === "paymentStatus" && (
                <div className="stack">
                  <div className="row">
                    <input
                      className="input"
                      placeholder="Search by Order ID / Phone / Name"
                      value={pickupPaymentFilters.search}
                      onChange={(e) =>
                        setPickupPaymentFilters({
                          ...pickupPaymentFilters,
                          search: e.target.value,
                        })
                      }
                    />
                    <input
                      className="input"
                      type="date"
                      value={pickupPaymentFilters.startDate}
                      onChange={(e) =>
                        setPickupPaymentFilters({
                          ...pickupPaymentFilters,
                          startDate: e.target.value,
                        })
                      }
                    />
                    <input
                      className="input"
                      type="date"
                      value={pickupPaymentFilters.endDate}
                      onChange={(e) =>
                        setPickupPaymentFilters({
                          ...pickupPaymentFilters,
                          endDate: e.target.value,
                        })
                      }
                    />
                  </div>

                  {filteredPaymentOrders.length === 0 && <p>No payment-status orders found.</p>}

                  {filteredPaymentOrders.length > 0 && (
                    <div className="table-scroll">
                      <table className="payments-table">
                        <thead>
                          <tr>
                            <th>Booking Date</th>
                            <th>Order ID</th>
                            <th>Customer</th>
                            <th>Phone</th>
                            <th>Type</th>
                            <th>Items</th>
                            <th>Total</th>
                            <th>Paid</th>
                            <th>Balance</th>
                            <th>Order Status</th>
                            <th>Status</th>
                            <th>Notes</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredPaymentOrders.map((order) => (
                            <Fragment key={order.id}>
                              <tr>
                                <td>
                                  {formatDateLabel(order.createdAt || order.publishedDate)}
                                  <small className="payments-subtext">
                                    {formatDateLabel(order.publishedDate)} -{" "}
                                    {order.mealType || "Unknown"}
                                  </small>
                                </td>
                                <td>#{order.orderId || order.id}</td>
                                <td>{order.customerName || "Customer"}</td>
                                <td>{order.phone || "-"}</td>
                                <td>
                                  {isOwnerManualPaymentOrder(order)
                                    ? "Manual Collection"
                                    : order.deliveryType === "pickup"
                                    ? "Pay at Outlet"
                                    : "Cash on Delivery"}
                                </td>
                                <td>
                                  {(order.items || []).map((item) => (
                                    <div key={`${order.id}-${item.name}`}>
                                      {item.name} x{item.qty}
                                    </div>
                                  ))}
                                </td>
                                <td>Rs. {order.total || 0}</td>
                                <td>Rs. {getPaymentAmountPaid(order)}</td>
                                <td>
                                  Rs. {getPaymentBalance(order)}
                                </td>
                                <td>{getOrderStatusLabel(order)}</td>
                                <td>
                                  <span className="status-chip">
                                    {getPaymentStatusLabel(order) === "paid"
                                      ? "Paid"
                                      : getPaymentStatusLabel(order)}
                                  </span>
                                </td>
                                <td>{getPaymentNotes(order) || "-"}</td>
                                <td>
                                  <button
                                    className="btn secondary btn-compact"
                                    onClick={() => {
                                      setEditingPickupPaymentId(order.id);
                                      setPickupPaymentForm({
                                        amount: "",
                                        notes: getPaymentNotes(order),
                                      });
                                    }}
                                  >
                                    Update
                                  </button>
                                </td>
                              </tr>
                              {editingPickupPaymentId === order.id && (
                                <tr className="payments-edit-row">
                                  <td colSpan={13}>
                                    <div className="payments-edit-grid">
                                      <input
                                        className="input"
                                        type="number"
                                        min={0}
                                        placeholder="Amount received"
                                        value={pickupPaymentForm.amount}
                                        onChange={(e) =>
                                          setPickupPaymentForm({
                                            ...pickupPaymentForm,
                                            amount: e.target.value,
                                          })
                                        }
                                      />
                                      <input
                                        className="input"
                                        placeholder="Notes"
                                        value={pickupPaymentForm.notes}
                                        onChange={(e) =>
                                          setPickupPaymentForm({
                                            ...pickupPaymentForm,
                                            notes: e.target.value,
                                          })
                                        }
                                      />
                                      <div className="payments-edit-actions">
                                        <button
                                          className="btn btn-compact"
                                          onClick={() => saveOrderPaymentStatus(order, false)}
                                        >
                                          Save Payment
                                        </button>
                                        <button
                                          className="btn secondary btn-compact"
                                          onClick={() => saveOrderPaymentStatus(order, true)}
                                        >
                                          Mark Fully Paid
                                        </button>
                                        <button
                                          className="btn secondary btn-compact"
                                          onClick={() => {
                                            setEditingPickupPaymentId(null);
                                            setPickupPaymentForm({ amount: "", notes: "" });
                                          }}
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === "delivery" && (
            <div className="card stack">
              <h2>Delivery Agents</h2>
              <div className="row">
                <button
                  className={`btn ${deliveryTab === "agents" ? "" : "secondary"}`}
                  onClick={() => setDeliveryTab("agents")}
                >
                  Agents
                </button>
                <button
                  className={`btn ${
                    deliveryTab === "assignments" ? "" : "secondary"
                  }`}
                  onClick={() => setDeliveryTab("assignments")}
                >
                  Assignments
                </button>
              </div>
              {deliveryTab === "agents" && (
                <>
              <button
                className="btn"
                onClick={() => setShowAgentForm((prev) => !prev)}
              >
                Create New Delivery Agent
              </button>
              {showAgentForm && (
                <div className="card stack">
                  <div className="row">
                    <input
                      className="input"
                      placeholder="Name"
                      value={agentForm.name}
                      onChange={(e) =>
                        setAgentForm({ ...agentForm, name: e.target.value })
                      }
                    />
                    <input
                      className="input"
                      placeholder="Phone"
                      value={agentForm.phone}
                      onChange={(e) =>
                        setAgentForm({ ...agentForm, phone: e.target.value })
                      }
                    />
                    <input
                      className="input"
                      placeholder="Password"
                      type="password"
                      value={agentForm.password}
                      onChange={(e) =>
                        setAgentForm({ ...agentForm, password: e.target.value })
                      }
                    />
                  </div>
                  <div className="row">
                    <button className="btn" onClick={addDeliveryAgent}>
                      Save Agent
                    </button>
                    <button
                      className="btn secondary"
                      onClick={() => setShowAgentForm(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {deliveryAgents.map((agent) => (
                <div key={agent.id} className="card list-card" style={{ position: "relative" }}>
                    <div className="row">
                      <div style={{ flex: 1 }}>
                        <strong>{agent.name}</strong> | {agent.phone}
                    </div>
                    <button
                      className="btn secondary"
                      onClick={() =>
                        updateDeliveryAgent(agent.id, { active: !agent.active })
                      }
                    >
                      {agent.active ? "Disable" : "Enable"}
                    </button>
                    <button
                      className="btn secondary"
                      onClick={() =>
                        setOpenAgentActionsId(
                          openAgentActionsId === agent.id ? null : agent.id
                        )
                      }
                    >
                      ⋮
                    </button>
                  </div>
                  {openAgentActionsId === agent.id && (
                    <div
                      className="card stack"
                      style={{
                        position: "absolute",
                        right: 0,
                        top: "100%",
                        zIndex: 10,
                        minWidth: 180,
                      }}
                    >
                      <button
                        className="btn secondary"
                        onClick={() => {
                          setEditingAgentId(agent.id);
                          setEditAgentForm({
                            name: agent.name,
                            phone: agent.phone,
                            password: "",
                          });
                          setOpenAgentActionsId(null);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="btn secondary"
                        onClick={() => deleteDeliveryAgent(agent.id)}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                  {editingAgentId === agent.id && (
                    <div className="card stack" style={{ marginTop: 12 }}>
                      <div className="row">
                        <input
                          className="input"
                          placeholder="Name"
                          value={editAgentForm.name}
                          onChange={(e) =>
                            setEditAgentForm({
                              ...editAgentForm,
                              name: e.target.value,
                            })
                          }
                        />
                        <input
                          className="input"
                          placeholder="Phone"
                          value={editAgentForm.phone}
                          onChange={(e) =>
                            setEditAgentForm({
                              ...editAgentForm,
                              phone: e.target.value,
                            })
                          }
                        />
                        <input
                          className="input"
                          placeholder="Reset Password"
                          type="password"
                          value={editAgentForm.password}
                          onChange={(e) =>
                            setEditAgentForm({
                              ...editAgentForm,
                              password: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="row">
                        <button
                          className="btn"
                          onClick={() => saveAgentEdits(agent)}
                        >
                          Save
                        </button>
                        <button
                          className="btn secondary"
                          onClick={() => setEditingAgentId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
                </>
              )}

              {deliveryTab === "assignments" && (
                <div className="card stack">
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <h3>Area Assignments</h3>
                    <div className="row">
                      {deliveryAssignmentMeals.map((meal) => (
                        <button
                          key={meal}
                          className={`btn btn-compact ${assignmentMeal === meal ? "" : "secondary"}`}
                          onClick={() => {
                            setAssignmentMeal(meal);
                            setOpenAssignmentArea(null);
                          }}
                        >
                          {meal}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table className="payments-table payments-table-compact owner-assignment-table">
                      <thead>
                        <tr>
                          <th>New Sub Area</th>
                          <th>Area</th>
                          <th>Assigned Agents</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {unassignedCustomSubAreas.length > 0 ? (
                          unassignedCustomSubAreas.map(({ area, subArea }) => {
                            const assignmentKey = `${area}::${subArea}`;
                            const subAssigned =
                              getSubAreaAgentIdsForMeal(areaAssignmentMap[area] || {}, assignmentMeal, subArea);
                            return (
                              <Fragment key={`${assignmentKey}::pending-table`}>
                                <tr>
                                  <td>
                                    <strong>{subArea}</strong>
                                    <small className="payments-subtext">Customer-added sub area</small>
                                  </td>
                                  <td>{area}</td>
                                  <td>
                                    {subAssigned.length > 0
                                      ? subAssigned
                                          .map((id: string) => agentNameMap[id])
                                          .filter(Boolean)
                                          .join(", ")
                                      : "Pending"}
                                  </td>
                                  <td>
                                    <button
                                      className="btn secondary btn-compact"
                                      onClick={() =>
                                        setOpenAssignmentArea(
                                          openAssignmentArea === assignmentKey ? null : assignmentKey
                                        )
                                      }
                                    >
                                      Assign Agent
                                    </button>
                                  </td>
                                </tr>
                                {openAssignmentArea === assignmentKey && (
                                  <tr>
                                    <td colSpan={4} className="owner-assignment-editor-cell">
                                      <div className="owner-assignment-editor">
                                        <strong>{subArea} - {assignmentMeal}</strong>
                                        {deliveryAgents.length === 0 ? (
                                          <span>No agents yet</span>
                                        ) : (
                                          <div className="owner-assignment-checkboxes">
                                            {deliveryAgents.map((agent) => (
                                              <label key={agent.id} className="row">
                                                <input
                                                  type="checkbox"
                                                  checked={subAssigned.includes(agent.id)}
                                                  onChange={(e) => {
                                                    const checked = e.target.checked;
                                                    const next = checked
                                                      ? Array.from(new Set([...subAssigned, agent.id]))
                                                      : subAssigned.filter((id: string) => id !== agent.id);
                                                    saveSubAreaAssignment(area, subArea, next, assignmentMeal);
                                                  }}
                                                />
                                                <span>{agent.name}</span>
                                              </label>
                                            ))}
                                          </div>
                                        )}
                                        <button
                                          className="btn secondary btn-compact"
                                          onClick={() => setOpenAssignmentArea(null)}
                                        >
                                          Close
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={4}>
                              <small className="payments-subtext">
                                No new sub areas are waiting for assignment.
                              </small>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="table-scroll">
                    <table className="payments-table payments-table-compact owner-assignment-table">
                      <thead>
                        <tr>
                          <th>Area</th>
                          <th>Sub Area</th>
                          <th>Assigned Agents</th>
                          <th>Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {areaOptions.flatMap((area) => {
                          const assigned = getAreaAgentIdsForMeal(areaAssignmentMap[area] || {}, assignmentMeal);
                          const assignedNames = assigned
                            .map((id: string) => agentNameMap[id])
                            .filter(Boolean)
                            .join(", ");
                          const subAreas = subAreaOptionsByArea[area] || [];
                          const rows: React.ReactNode[] = [];

                          rows.push(
                            <Fragment key={`${area}::area-row`}>
                              <tr>
                                <td><strong>{area}</strong></td>
                                <td>-</td>
                                <td>{assignedNames || "No agents mapped"}</td>
                                <td>{assigned.length > 0 ? "Assigned" : "Unassigned"}</td>
                                <td>
                                  <button
                                    className="btn secondary btn-compact"
                                    onClick={() =>
                                      setOpenAssignmentArea(openAssignmentArea === area ? null : area)
                                    }
                                  >
                                    Select Agents
                                  </button>
                                </td>
                              </tr>
                              {openAssignmentArea === area && (
                                <tr>
                                  <td colSpan={5} className="owner-assignment-editor-cell">
                                    <div className="owner-assignment-editor">
                                      <strong>{area}</strong>
                                      {deliveryAgents.length === 0 ? (
                                        <span>No agents yet</span>
                                      ) : (
                                        <div className="owner-assignment-checkboxes">
                                          {deliveryAgents.map((agent) => (
                                            <label key={agent.id} className="row">
                                              <input
                                                type="checkbox"
                                                checked={assigned.includes(agent.id)}
                                                onChange={(e) => {
                                                  const checked = e.target.checked;
                                                  const next = checked
                                                    ? Array.from(new Set([...assigned, agent.id]))
                                                    : assigned.filter((id: string) => id !== agent.id);
                                                  saveAreaAssignment(area, next, assignmentMeal);
                                                }}
                                              />
                                              <span>{agent.name}</span>
                                            </label>
                                          ))}
                                        </div>
                                      )}
                                      <button
                                        className="btn secondary btn-compact"
                                        onClick={() => setOpenAssignmentArea(null)}
                                      >
                                        Close
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );

                          subAreas.forEach((subArea) => {
                            const subAreaKey = `${area}::${subArea}`;
                            const subAssigned =
                              getSubAreaAgentIdsForMeal(areaAssignmentMap[area] || {}, assignmentMeal, subArea);
                            const isCustomSubArea = !isMappedSubArea(area, subArea);
                            const subAssignedNames = subAssigned
                              .map((id: string) => agentNameMap[id])
                              .filter(Boolean)
                              .join(", ");
                            const statusLabel =
                              subAssigned.length > 0
                                ? "Assigned"
                                : isCustomSubArea
                                  ? "Pending"
                                  : "Uses area rule";

                            rows.push(
                              <tr key={subAreaKey}>
                                <td>{area}</td>
                                <td>
                                  {subArea}
                                  {isCustomSubArea && (
                                    <small className="payments-subtext">Custom sub area</small>
                                  )}
                                </td>
                                <td>{subAssignedNames || "-"}</td>
                                <td>
                                  {statusLabel}
                                  {!subAssignedNames && isCustomSubArea && (
                                    <small style={{ display: "block", marginTop: 4, color: "crimson" }}>
                                      Agent assignment pending
                                    </small>
                                  )}
                                </td>
                                <td>
                                  <button
                                    className="btn secondary btn-compact"
                                    onClick={() =>
                                      setOpenAssignmentArea(
                                        openAssignmentArea === subAreaKey ? null : subAreaKey
                                      )
                                    }
                                  >
                                    Select Agents
                                  </button>
                                </td>
                              </tr>
                            );

                            if (openAssignmentArea === subAreaKey) {
                              rows.push(
                                <tr key={`${subAreaKey}::editor`}>
                                  <td colSpan={5} className="owner-assignment-editor-cell">
                                    <div className="owner-assignment-editor">
                                        <strong>{subArea} - {assignmentMeal}</strong>
                                      {deliveryAgents.length === 0 ? (
                                        <span>No agents yet</span>
                                      ) : (
                                        <div className="owner-assignment-checkboxes">
                                          {deliveryAgents.map((agent) => (
                                            <label key={agent.id} className="row">
                                              <input
                                                type="checkbox"
                                                checked={subAssigned.includes(agent.id)}
                                                onChange={(e) => {
                                                  const checked = e.target.checked;
                                                  const next = checked
                                                    ? Array.from(new Set([...subAssigned, agent.id]))
                                                    : subAssigned.filter((id: string) => id !== agent.id);
                                                  saveSubAreaAssignment(area, subArea, next, assignmentMeal);
                                                }}
                                              />
                                              <span>{agent.name}</span>
                                            </label>
                                          ))}
                                        </div>
                                      )}
                                      <button
                                        className="btn secondary btn-compact"
                                        onClick={() => setOpenAssignmentArea(null)}
                                      >
                                        Close
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            }
                          });

                          return rows;
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="list-card stack" style={{ gap: 8, display: "none" }}>
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div className="stack" style={{ gap: 4 }}>
                        <strong>New Sub Areas Awaiting Assignment</strong>
                        <small className="payments-subtext">
                          Customer-added sub areas stay unassigned until an agent is mapped here.
                        </small>
                      </div>
                      <span className="badge">{unassignedCustomSubAreas.length}</span>
                    </div>
                    {unassignedCustomSubAreas.length > 0 ? (
                      <div className="stack" style={{ gap: 6 }}>
                        {unassignedCustomSubAreas.map(({ area, subArea }) => (
                          <div
                            key={`${area}::${subArea}::pending`}
                            className="row"
                            style={{ justifyContent: "space-between", gap: 12 }}
                          >
                            <span>
                              <strong>{subArea}</strong>
                              {" "}
                              <small className="payments-subtext">in {area}</small>
                            </span>
                            <button
                              className="btn secondary btn-compact"
                              onClick={() => setOpenAssignmentArea(`${area}::${subArea}`)}
                            >
                              Assign Agent
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <small className="payments-subtext">
                        No new sub areas are waiting for assignment.
                      </small>
                    )}
                  </div>
                  <div className="table" style={{ display: "none" }}>
                    <div className="row" style={{ fontWeight: 700 }}>
                      <div style={{ flex: 1 }}>Area</div>
                      <div style={{ width: 260 }}>Agents</div>
                    </div>
                    {areaOptions.map((area) => {
                      const assigned = areaAssignmentMap[area]?.agentIds || [];
                      const assignedNames = assigned
                        .map((id) => agentNameMap[id])
                        .filter(Boolean)
                        .join(", ");
                      const subAreas = subAreaOptionsByArea[area] || [];
                      return (
                        <div key={area} className="list-card stack" style={{ position: "relative" }}>
                          <div className="row">
                            <div style={{ flex: 1, fontWeight: 600 }}>{area}</div>
                            <div style={{ width: 260 }}>
                              <div className="row" style={{ justifyContent: "flex-end" }}>
                                <button
                                  className="btn secondary"
                                  onClick={() =>
                                    setOpenAssignmentArea(
                                      openAssignmentArea === area ? null : area
                                    )
                                  }
                                >
                                  Select Agents
                                </button>
                              </div>
                              {assignedNames && (
                                <small style={{ display: "block", marginTop: 6 }}>
                                  {assignedNames}
                                </small>
                              )}
                            </div>
                          </div>
                          {subAreas.length > 0 && (
                            <div className="stack" style={{ gap: 8 }}>
                              {subAreas.map((subArea) => {
                                const subAreaKey = `${area}::${subArea}`;
                                const subAssigned =
                                  areaAssignmentMap[area]?.subAreaAgentIds?.[subArea] || [];
                                const isCustomSubArea = !isMappedSubArea(area, subArea);
                                const subAssignedNames = subAssigned
                                  .map((id) => agentNameMap[id])
                                  .filter(Boolean)
                                  .join(", ");
                                return (
                                  <div key={subAreaKey} className="row" style={{ alignItems: "flex-start" }}>
                                    <div style={{ flex: 1 }}>
                                      <small className="payments-subtext">
                                        {subArea}
                                        {isCustomSubArea && " • custom"}
                                      </small>
                                      {subAssignedNames && (
                                        <small style={{ display: "block", marginTop: 4 }}>
                                          {subAssignedNames}
                                        </small>
                                      )}
                                      {!subAssignedNames && isCustomSubArea && (
                                        <small
                                          style={{ display: "block", marginTop: 4, color: "crimson" }}
                                        >
                                          Agent assignment pending
                                        </small>
                                      )}
                                    </div>
                                    <button
                                      className="btn secondary btn-compact"
                                      onClick={() =>
                                        setOpenAssignmentArea(
                                          openAssignmentArea === subAreaKey ? null : subAreaKey
                                        )
                                      }
                                    >
                                      Select Agents
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {openAssignmentArea === area && (
                            <div
                              className="card stack"
                              style={{
                                position: "absolute",
                                right: 16,
                                top: "100%",
                                zIndex: 10,
                                minWidth: 240,
                              }}
                            >
                              {deliveryAgents.length === 0 && (
                                <span>No agents yet</span>
                              )}
                              {deliveryAgents.map((agent) => (
                                <label key={agent.id} className="row">
                                  <input
                                    type="checkbox"
                                    checked={assigned.includes(agent.id)}
                                    onChange={(e) => {
                                      const checked = e.target.checked;
                                      const next = checked
                                        ? Array.from(new Set([...assigned, agent.id]))
                                        : assigned.filter((id) => id !== agent.id);
                                      saveAreaAssignment(area, next);
                                    }}
                                  />
                                  <span>{agent.name}</span>
                                </label>
                              ))}
                              <button
                                className="btn secondary"
                                onClick={() => setOpenAssignmentArea(null)}
                              >
                                Close
                              </button>
                            </div>
                          )}
                          {subAreas.map((subArea) => {
                            const subAreaKey = `${area}::${subArea}`;
                            const subAssigned = areaAssignmentMap[area]?.subAreaAgentIds?.[subArea] || [];
                            return openAssignmentArea === subAreaKey ? (
                              <div
                                key={`${subAreaKey}-panel`}
                                className="card stack"
                                style={{
                                  position: "absolute",
                                  right: 16,
                                  top: "100%",
                                  zIndex: 10,
                                  minWidth: 240,
                                }}
                              >
                                <strong>{subArea}</strong>
                                {deliveryAgents.length === 0 && <span>No agents yet</span>}
                                {deliveryAgents.map((agent) => (
                                  <label key={agent.id} className="row">
                                    <input
                                      type="checkbox"
                                      checked={subAssigned.includes(agent.id)}
                                      onChange={(e) => {
                                        const checked = e.target.checked;
                                        const next = checked
                                          ? Array.from(new Set([...subAssigned, agent.id]))
                                          : subAssigned.filter((id) => id !== agent.id);
                                        saveSubAreaAssignment(area, subArea, next);
                                      }}
                                    />
                                    <span>{agent.name}</span>
                                  </label>
                                ))}
                                <button
                                  className="btn secondary"
                                  onClick={() => setOpenAssignmentArea(null)}
                                >
                                  Close
                                </button>
                              </div>
                            ) : null;
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "areas" && (
            <div className="card stack">
              <h2>Manage Areas</h2>
              <div className="row">
                <input
                  className="input"
                  placeholder="Area name"
                  value={areaForm}
                  onChange={(e) => setAreaForm(e.target.value)}
                />
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Delivery fee"
                  value={areaFeeForm}
                  onChange={(e) => setAreaFeeForm(e.target.value)}
                  style={{ maxWidth: 150 }}
                />
                <button className="btn" onClick={addServiceArea}>
                  Add Area
                </button>
              </div>
              <input
                className="input"
                placeholder="Search area"
                value={areaSearch}
                onChange={(e) => setAreaSearch(e.target.value)}
              />
              {filteredServiceAreas.length === 0 && <p>No areas found</p>}
              {filteredServiceAreas.map((area) => (
                <div key={area.id} className="list-card stack" style={{ gap: 10 }}>
                  {(() => {
                    const mappedSubAreas = getSubAreasForArea(area.name) || [];
                    const savedCustomSubAreas = (area.subAreas || []).filter(Boolean);
                    return (
                      <Fragment>
                  <div className="row" style={{ alignItems: "center", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{area.name}</div>
                      <small className="payments-subtext">
                        Sub areas: {(subAreaOptionsByArea[area.name] || []).join(", ") || "None"}
                      </small>
                    </div>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step="1"
                      defaultValue={String(Number(area.deliveryFee || 0))}
                      onBlur={(e) =>
                        updateServiceAreaFee(area.id, Number(e.target.value || 0))
                      }
                      style={{ width: 130 }}
                    />
                    <button
                      className="btn secondary"
                      onClick={() => deleteServiceArea(area.id)}
                    >
                      Delete
                    </button>
                  </div>
                  {mappedSubAreas.length > 0 && (
                    <div className="stack" style={{ gap: 6 }}>
                      <small className="payments-subtext">Mapped sub areas</small>
                      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                        {mappedSubAreas.map((subArea) => (
                          <span key={`${area.id}::mapped::${subArea}`} className="badge">
                            {subArea}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="stack" style={{ gap: 6 }}>
                    <small className="payments-subtext">
                      Added sub areas
                    </small>
                    {savedCustomSubAreas.length > 0 ? (
                      <div className="stack" style={{ gap: 8 }}>
                        {savedCustomSubAreas.map((subArea) => {
                          const editKey = `${area.id}::${subArea}`;
                          const isEditing = editingAreaSubAreaKey === editKey;
                          return (
                            <div
                              key={editKey}
                              className="row"
                              style={{ alignItems: "center", gap: 8 }}
                            >
                              {isEditing ? (
                                <>
                                  <input
                                    className="input"
                                    value={areaSubAreaEditDrafts[editKey] || ""}
                                    onChange={(e) =>
                                      setAreaSubAreaEditDrafts((prev) => ({
                                        ...prev,
                                        [editKey]: e.target.value,
                                      }))
                                    }
                                    style={{ flex: 1 }}
                                  />
                                  <button
                                    className="btn secondary btn-compact"
                                    onClick={() => saveServiceSubAreaEdit(area, subArea)}
                                  >
                                    Save
                                  </button>
                                  <button
                                    className="btn secondary btn-compact"
                                    onClick={() => setEditingAreaSubAreaKey(null)}
                                  >
                                    Close
                                  </button>
                                </>
                              ) : (
                                <>
                                  <span style={{ flex: 1 }}>
                                    {subArea}
                                    {!isMappedSubArea(area.name, subArea) && (
                                      <small className="payments-subtext"> {" "}• custom</small>
                                    )}
                                  </span>
                                  <button
                                    className="btn secondary btn-compact"
                                    onClick={() => openServiceSubAreaEdit(area, subArea)}
                                  >
                                    Edit
                                  </button>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <small className="payments-subtext">
                        No owner/customer-added sub areas yet.
                      </small>
                    )}
                  </div>
                  <div className="row">
                    <input
                      className="input"
                      placeholder="Add sub area manually"
                      value={areaSubAreaDrafts[area.id] || ""}
                      onChange={(e) =>
                        setAreaSubAreaDrafts((prev) => ({
                          ...prev,
                          [area.id]: e.target.value,
                        }))
                      }
                      style={{ flex: 1 }}
                    />
                    <button
                      className="btn secondary btn-compact"
                      onClick={() => addServiceSubArea(area)}
                    >
                      Add Sub Area
                    </button>
                  </div>
                      </Fragment>
                    );
                  })()}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </main>
  );
}

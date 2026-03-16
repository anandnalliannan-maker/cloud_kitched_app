"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  addDoc,
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
  loginOwner,
  normalizePhone,
  ownerExists,
  setDeliveryPassword,
} from "@/lib/auth";
import { clearSession, getSession, saveSession } from "@/lib/session";

type Mode = "loading" | "setup" | "login" | "dashboard";
type Tab =
  | "menu"
  | "publish"
  | "dashboard"
  | "history"
  | "delivery"
  | "areas"
  | "pickupPayments"
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
  }[];
  remaining?: {
    itemId: string;
    name: string;
    qty: number;
    price: number;
    description?: string;
    imageUrl?: string;
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
  customerName?: string;
  phone?: string;
  items?: OrderItem[];
  total?: number;
  deliveryType?: string;
  address?: string;
  area?: string;
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
  orderSource?: string;
  location?: string | null;
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
};

type AreaAssignment = {
  id: string;
  agentIds: string[];
  lastIndex?: number;
};

const mealTypes = ["Breakfast", "Lunch", "Snacks", "Dinner"];
const fallbackAreas = ["Madipakkam", "Medavakkam", "Velachery"];

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
  });
  const [appliedReportFilters, setAppliedReportFilters] = useState({
    search: "",
    startDate: "",
    endDate: "",
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
  const [areaForm, setAreaForm] = useState("");
  const [showNav, setShowNav] = useState(false);
  const [historyTab, setHistoryTab] = useState<
    "summary" | "active" | "delivery"
  >("summary");
  const [deliveryTab, setDeliveryTab] = useState<"agents" | "assignments">(
    "agents"
  );
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
  const [editingPublishedMenuId, setEditingPublishedMenuId] = useState<
    string | null
  >(null);
  const [editPublishForm, setEditPublishForm] = useState({
    date: "",
    mealType: "Lunch",
  });
  const [editPublishQty, setEditPublishQty] = useState<Record<string, number>>(
    {}
  );
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
  const [ownerOrderForm, setOwnerOrderForm] = useState({
    name: "",
    phone: "",
    deliveryType: "pickup",
    addressLine1: "",
    street: "",
    area: "",
    location: "",
  });
  const [ownerOrderQty, setOwnerOrderQty] = useState<Record<string, number>>({});

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

  function getCreatedAtMs(value: any) {
    if (!value) return 0;
    if (value?.toDate) return value.toDate().getTime();
    if (typeof value === "object" && "seconds" in value) {
      return value.seconds * 1000;
    }
    if (value instanceof Date) return value.getTime();
    return 0;
  }

  useEffect(() => {
    async function loadOwnerAuth() {
      const session = getSession();
      if (session?.role === "owner") {
        setMode("dashboard");
        return;
      }
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

  async function archivePublishedMenu(menu: PublishedMenu) {
    const confirmed = window.confirm(
      "Archive this published menu? It will be hidden from customers."
    );
    if (!confirmed) return;
    await updateDoc(doc(db, "published_menus", menu.id), {
      isArchived: true,
      archivedAt: serverTimestamp(),
    });
  }

  async function stopOrdersForMenu(menu: PublishedMenu) {
    const confirmed = window.confirm(
      "Stop orders for this menu? Customers will see it as sold out."
    );
    if (!confirmed) return;
    await updateDoc(doc(db, "published_menus", menu.id), {
      ordersStopped: true,
      stoppedAt: serverTimestamp(),
    });
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
      createdAt: serverTimestamp(),
    });
    setAreaForm("");
  }

  async function deleteServiceArea(id: string) {
    const confirmed = window.confirm("Delete this area?");
    if (!confirmed) return;
    await deleteDoc(doc(db, "service_areas", id));
  }

  function runReport() {
    setAppliedReportFilters({ ...reportFilters });
  }

  function startEditPublishedMenu(menu: PublishedMenu) {
    setEditingPublishedMenuId(menu.id);
    setEditPublishForm({
      date: formatDateKey(menu.date),
      mealType: menu.mealType,
    });
    const qty: Record<string, number> = {};
    (menu.items || []).forEach((item) => {
      qty[item.itemId] = item.qty;
    });
    setEditPublishQty(qty);
  }

  async function savePublishedMenu() {
    if (!editingPublishedMenuId) return;
    const menu = publishedMenus.find((m) => m.id === editingPublishedMenuId);
    if (!menu) return;
    const items = (menu.items || []).map((item) => ({
      ...item,
      qty: editPublishQty[item.itemId] ?? item.qty,
    }));
    await updateDoc(doc(db, "published_menus", editingPublishedMenuId), {
      date: editPublishForm.date,
      mealType: editPublishForm.mealType,
      items,
      remaining: items,
    });
    setEditingPublishedMenuId(null);
  }

  function cancelEditPublishedMenu() {
    setEditingPublishedMenuId(null);
  }

  async function saveAreaAssignment(areaName: string, agentIds: string[]) {
    const existing = areaAssignmentMap[areaName];
    const ref = doc(db, "area_assignments", areaName);
    const lastIndex =
      typeof existing?.lastIndex === "number" ? existing.lastIndex : -1;
    await setDoc(
      ref,
      {
        agentIds,
        lastIndex,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    await reassignOrdersForArea(areaName, agentIds, lastIndex);
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
    agentIds: string[],
    lastIndex: number
  ) {
    const relevantOrders = orders
      .filter(
        (order) => (order.area || "Unknown") === areaName && order.status !== "closed"
      )
      .sort((a, b) => getCreatedAtMs(a.createdAt) - getCreatedAtMs(b.createdAt));
    if (!relevantOrders.length) return;
    if (!agentIds.length) {
      await Promise.all(
        relevantOrders.map((order) =>
          updateDoc(doc(db, "orders", order.id), {
            assignedAgentId: "",
            assignedAgentName: "",
          })
        )
      );
      await updateDoc(doc(db, "area_assignments", areaName), { lastIndex: -1 });
      return;
    }
    let index = lastIndex;
    await Promise.all(
      relevantOrders.map((order) => {
        index = (index + 1) % agentIds.length;
        const agentId = agentIds[index];
        return updateDoc(doc(db, "orders", order.id), {
          assignedAgentId: agentId,
          assignedAgentName: agentNameMap[agentId] || "",
        });
      })
    );
    await updateDoc(doc(db, "area_assignments", areaName), { lastIndex: index });
  }

  async function savePickupPayment(order: Order, markAsFullyPaid = false) {
    const additionalAmount = markAsFullyPaid
      ? Math.max((order.total || 0) - (order.pickupAmountPaid || 0), 0)
      : Number(pickupPaymentForm.amount || 0);
    if (!markAsFullyPaid && additionalAmount <= 0) {
      return;
    }
    const nextPaid = Math.min(
      (order.total || 0),
      (order.pickupAmountPaid || 0) + additionalAmount
    );
    const nextBalance = Math.max((order.total || 0) - nextPaid, 0);
    const nextStatus =
      nextBalance === 0 ? "paid" : nextPaid > 0 ? "partial" : "unpaid";
    await updateDoc(doc(db, "orders", order.id), {
      pickupAmountPaid: nextPaid,
      pickupBalance: nextBalance,
      pickupPaymentStatus: nextStatus,
      pickupPaymentNotes: pickupPaymentForm.notes.trim(),
      pickupPaymentUpdatedAt: serverTimestamp(),
      paymentStatus: nextBalance === 0 ? "paid" : order.paymentStatus || "pending",
      status: nextBalance === 0 ? "closed" : order.status || "active",
      ...(nextBalance === 0 ? { pickupPaymentClosedAt: serverTimestamp() } : {}),
    });
    setEditingPickupPaymentId(null);
    setPickupPaymentForm({ amount: "", notes: "" });
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
        !ownerOrderForm.area)
    ) {
      setOwnerOrderError("Enter full delivery address and area.");
      return;
    }

    const selectedItems = (selectedOwnerMenu.remaining || selectedOwnerMenu.items || [])
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
          if (!remainingItem || (remainingItem.qty || 0) < item.qty) {
            throw new Error(`${item.name} is sold out or insufficient.`);
          }
          remainingItem.qty = (remainingItem.qty || 0) - item.qty;
        });

        let assignedAgentId = "";
        let assignedAgentName = "";
        if (ownerOrderForm.deliveryType === "delivery" && ownerOrderForm.area) {
          const assignmentRef = doc(db, "area_assignments", ownerOrderForm.area);
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
              const agentSnap = await tx.get(doc(db, "delivery_agents", agentId));
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
          orderId: displayOrderId,
          status: "active",
          paymentStatus:
            ownerOrderForm.deliveryType === "pickup" ? "pay_at_outlet" : "manual_pending",
          createdAt: serverTimestamp(),
          publishedMenuId: selectedOwnerMenu.id,
          publishedDate: menuData.date || "",
          mealType: menuData.mealType || "",
          customerName: ownerOrderForm.name.trim(),
          phone: ownerOrderForm.phone.trim(),
          deliveryType: ownerOrderForm.deliveryType,
          address:
            ownerOrderForm.deliveryType === "delivery"
              ? `${ownerOrderForm.addressLine1.trim()}, ${ownerOrderForm.street.trim()}`
              : "",
          area: ownerOrderForm.deliveryType === "delivery" ? ownerOrderForm.area : "",
          location:
            ownerOrderForm.deliveryType === "delivery"
              ? ownerOrderForm.location.trim() || null
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
          pickupAmountPaid: 0,
          pickupBalance: ownerOrderForm.deliveryType === "pickup" ? total : 0,
          pickupPaymentStatus:
            ownerOrderForm.deliveryType === "pickup" ? "unpaid" : "",
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
        location: "",
      });
      if (selectedOwnerMenu) {
        const resetQty: Record<string, number> = {};
        (selectedOwnerMenu.remaining || selectedOwnerMenu.items || []).forEach((item) => {
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

  const activeOrders = useMemo(
    () => orders.filter((order) => order.status !== "closed"),
    [orders]
  );
  const closedOrders = useMemo(
    () => orders.filter((order) => order.status === "closed"),
    [orders]
  );

  const filteredClosedOrders = useMemo(() => {
    const { search, startDate, endDate } = appliedReportFilters;
    return closedOrders.filter((order) => {
      const haystack = `${order.orderId || ""} ${order.phone || ""} ${
        order.customerName || ""
      }`.toLowerCase();
      if (search && !haystack.includes(search.toLowerCase())) return false;
      const publishedDate = formatDateKey(order.publishedDate);
      if (startDate && publishedDate < startDate) return false;
      if (endDate && publishedDate > endDate) return false;
      return true;
    });
  }, [closedOrders, appliedReportFilters]);

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

  const activeOrdersSummary = useMemo(() => {
    const grouped: Record<
      string,
      {
        key: string;
        date: string;
        mealType: string;
        totalOrders: number;
        totalItems: number;
        totalValue: number;
        itemCounts: Record<string, number>;
        byArea: Record<string, number>;
        byDelivery: Record<string, number>;
      }
    > = {};

    activeOrders.forEach((order) => {
      const date = formatDateKey(order.publishedDate);
      const mealType = order.mealType || "Unknown";
      const key = `${date}__${mealType}`;
      if (!grouped[key]) {
        grouped[key] = {
          key,
          date,
          mealType,
          totalOrders: 0,
          totalItems: 0,
          totalValue: 0,
          itemCounts: {},
          byArea: {},
          byDelivery: {},
        };
      }
      const group = grouped[key];
      group.totalOrders += 1;
      group.totalItems += (order.items || []).reduce(
        (sum, item) => sum + item.qty,
        0
      );
      group.totalValue += order.total || 0;
      (order.items || []).forEach((item) => {
        group.itemCounts[item.name] =
          (group.itemCounts[item.name] || 0) + item.qty;
      });
      const area = order.area || "Unknown";
      group.byArea[area] = (group.byArea[area] || 0) + 1;
      const delivery = order.deliveryType || "Unknown";
      group.byDelivery[delivery] = (group.byDelivery[delivery] || 0) + 1;
    });

    return Object.values(grouped).sort((a, b) => {
      if (a.date === b.date) return a.mealType.localeCompare(b.mealType);
      return a.date.localeCompare(b.date);
    });
  }, [activeOrders]);

  const activePublishedMenuKeys = useMemo(() => {
    const keys = new Set<string>();
    publishedMenus.forEach((menu) => {
      if (menu.isArchived) return;
      const date = formatDateKey(menu.date);
      const mealType = menu.mealType || "Unknown";
      keys.add(`${date}__${mealType}`);
    });
    return keys;
  }, [publishedMenus]);

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
    (selectedOwnerMenu.remaining || selectedOwnerMenu.items || []).forEach((item) => {
      nextQty[item.itemId] = 0;
    });
    setOwnerOrderQty(nextQty);
  }, [selectedOwnerMenu]);

  const filteredPickupOrders = useMemo(() => {
    return orders
      .filter((order) => order.deliveryType === "pickup")
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
  }, [orders, pickupPaymentFilters]);

  const filteredActiveOrdersSummary = useMemo(
    () =>
      activeOrdersSummary.filter((group) =>
        activePublishedMenuKeys.has(group.key)
      ),
    [activeOrdersSummary, activePublishedMenuKeys]
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

  const deliveryStatusByAgent = useMemo(() => {
    const status: Record<
      string,
      {
        total: number;
        delivered: number;
        pending: number;
        byArea: Record<
          string,
          { delivered: number; pending: number }
        >;
      }
    > = {};
    const relevantOrders = orders.filter((order) =>
      activePublishedMenuKeys.has(
        `${formatDateKey(order.publishedDate)}__${order.mealType || "Unknown"}`
      )
    );
    relevantOrders.forEach((order) => {
      const agent = order.assignedAgentName || "Unassigned";
      const area = order.area || "Unknown";
      if (!status[agent]) {
        status[agent] = {
          total: 0,
          delivered: 0,
          pending: 0,
          byArea: {},
        };
      }
      if (!status[agent].byArea[area]) {
        status[agent].byArea[area] = { delivered: 0, pending: 0 };
      }
      status[agent].total += 1;
      if (order.status === "closed") {
        status[agent].delivered += 1;
        status[agent].byArea[area].delivered += 1;
      } else {
        status[agent].pending += 1;
        status[agent].byArea[area].pending += 1;
      }
    });
    return status;
  }, [orders, activePublishedMenuKeys]);

  const filteredActiveOrders = useMemo(() => {
    const search = activeOrderSearch.toLowerCase();
    return activeOrders.filter((order) => {
      if (
        activeOrderAreaFilter !== "All" &&
        (order.area || "Unknown") !== activeOrderAreaFilter
      ) {
        return false;
      }
      if (!search) return true;
      const haystack = `${order.orderId || ""} ${order.phone || ""} ${
        order.customerName || ""
      }`.toLowerCase();
      return haystack.includes(search);
    });
  }, [activeOrders, activeOrderSearch, activeOrderAreaFilter]);

  return (
    <main className="container">
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
              { id: "pickupPayments", label: "Pickup Payments" },
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
                  { id: "pickupPayments", label: "Pickup Payments" },
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
                          {item.name} - INR {item.price}
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
                    <strong>{item.name}</strong> - INR {item.price}
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
              {publishedMenus.filter((menu) => !menu.isArchived).length === 0 && (
                <p>No menus published</p>
              )}
              {publishedMenus
                .filter((menu) => !menu.isArchived)
                .map((menu) => (
                  <div key={menu.id} className="list-card menu-card">
                    <div className="menu-card-body">
                      <div>
                        {formatDateLabel(menu.date)} - {menu.mealType} (
                        {menu.items?.length ?? 0} items)
                      </div>
                      {menu.ordersStopped && (
                        <small style={{ color: "crimson", fontWeight: 600 }}>
                          Orders Stopped (Sold Out)
                        </small>
                      )}
                      <div>
                        {menu.items?.length ? (
                          menu.items.map((item) => (
                            <small key={item.itemId} style={{ display: "block" }}>
                              {item.name} x{item.qty}
                            </small>
                          ))
                        ) : (
                          <small>No items</small>
                        )}
                      </div>
                    </div>
                    <div className="menu-card-actions">
                      <button
                        className="btn secondary"
                        onClick={() => startEditPublishedMenu(menu)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn secondary"
                        onClick={() => stopOrdersForMenu(menu)}
                        disabled={menu.ordersStopped}
                      >
                        {menu.ordersStopped ? "Orders Stopped" : "Stop Orders"}
                      </button>
                      <button
                        className="btn secondary"
                        onClick={() => archivePublishedMenu(menu)}
                      >
                        Archive
                      </button>
                    </div>
                  </div>
                ))}
              <h3>Archived Menus</h3>
              {publishedMenus.filter((menu) => menu.isArchived).length === 0 && (
                <p>No archived menus</p>
              )}
              {publishedMenus
                .filter((menu) => menu.isArchived)
                .map((menu) => (
                  <div key={menu.id} className="row list-card">
                    <div style={{ flex: 1 }}>
                      <div>
                        {formatDateLabel(menu.date)} - {menu.mealType} (
                        {menu.items?.length ?? 0} items)
                      </div>
                      <div>
                        {menu.items?.length ? (
                          menu.items.map((item) => (
                            <small key={item.itemId} style={{ display: "block" }}>
                              {item.name} x{item.qty}
                            </small>
                          ))
                        ) : (
                          <small>No items</small>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              {editingPublishedMenuId && (
                <div className="card stack">
                  <h3>Edit Published Menu</h3>
                  <div className="row">
                    <input
                      className="input"
                      type="date"
                      value={editPublishForm.date}
                      onChange={(e) =>
                        setEditPublishForm({
                          ...editPublishForm,
                          date: e.target.value,
                        })
                      }
                    />
                    <select
                      className="select"
                      value={editPublishForm.mealType}
                      onChange={(e) =>
                        setEditPublishForm({
                          ...editPublishForm,
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
                  {publishedMenus
                    .find((menu) => menu.id === editingPublishedMenuId)
                    ?.items?.map((item) => (
                      <div key={item.itemId} className="row">
                        <div style={{ flex: 1 }}>
                          {item.name} - INR {item.price}
                        </div>
                        <input
                          className="input"
                          type="number"
                          min={0}
                          value={editPublishQty[item.itemId] ?? item.qty}
                          onChange={(e) =>
                            setEditPublishQty({
                              ...editPublishQty,
                              [item.itemId]: Number(e.target.value),
                            })
                          }
                        />
                      </div>
                    ))}
                  <div className="row">
                    <button className="btn" onClick={savePublishedMenu}>
                      Save
                    </button>
                    <button
                      className="btn secondary"
                      onClick={cancelEditPublishedMenu}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "createOrder" && (
            <div className="card stack">
              <h2>Create Order</h2>
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
                    {(selectedOwnerMenu.remaining || selectedOwnerMenu.items || []).map(
                      (item) => (
                        <div key={item.itemId} className="row">
                          <div style={{ flex: 1 }}>
                            {item.name} - INR {item.price}
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
                        onClick={() =>
                          setOwnerOrderForm({
                            ...ownerOrderForm,
                            deliveryType: "pickup",
                          })
                        }
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
                        </div>
                        <input
                          className="input"
                          placeholder="Exact location / map pin / landmark (optional)"
                          value={ownerOrderForm.location}
                          onChange={(e) =>
                            setOwnerOrderForm({
                              ...ownerOrderForm,
                              location: e.target.value,
                            })
                          }
                        />
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

          {tab === "pickupPayments" && (
            <div className="card stack">
              <h2>Pickup Payments</h2>
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

              {filteredPickupOrders.length === 0 && <p>No pickup orders found.</p>}

              {filteredPickupOrders.length > 0 && (
                <div className="table-scroll">
                  <table className="payments-table">
                    <thead>
                      <tr>
                        <th>Booking Date</th>
                        <th>Order ID</th>
                        <th>Customer</th>
                        <th>Phone</th>
                        <th>Items</th>
                        <th>Total</th>
                        <th>Paid</th>
                        <th>Balance</th>
                        <th>Status</th>
                        <th>Notes</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPickupOrders.map((order) => (
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
                              {(order.items || []).map((item) => (
                                <div key={`${order.id}-${item.name}`}>
                                  {item.name} x{item.qty}
                                </div>
                              ))}
                            </td>
                            <td>INR {order.total || 0}</td>
                            <td>INR {order.pickupAmountPaid || 0}</td>
                            <td>
                              INR{" "}
                              {typeof order.pickupBalance === "number"
                                ? order.pickupBalance
                                : order.total || 0}
                            </td>
                            <td>
                              <span className="status-chip">
                                {order.pickupPaymentStatus === "paid"
                                  ? "Closed"
                                  : order.pickupPaymentStatus || "unpaid"}
                              </span>
                            </td>
                            <td>{order.pickupPaymentNotes || "-"}</td>
                            <td>
                              <button
                                className="btn secondary btn-compact"
                                onClick={() => {
                                  setEditingPickupPaymentId(order.id);
                                  setPickupPaymentForm({
                                    amount: "",
                                    notes: order.pickupPaymentNotes || "",
                                  });
                                }}
                              >
                                Update
                              </button>
                            </td>
                          </tr>
                          {editingPickupPaymentId === order.id && (
                            <tr className="payments-edit-row">
                              <td colSpan={11}>
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
                                      onClick={() => savePickupPayment(order, false)}
                                    >
                                      Save Payment
                                    </button>
                                    <button
                                      className="btn secondary btn-compact"
                                      onClick={() => savePickupPayment(order, true)}
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

          {tab === "dashboard" && (
            <div className="card stack">
              <h2>Report/Dashboard</h2>
              <div className="row">
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
              </div>
              <div className="row">
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
                <button className="btn" onClick={runReport}>
                  Run
                </button>
              </div>
              <div className="row">
                <div className="card" style={{ flex: 1 }}>
                  Completed Orders: {filteredClosedOrders.length}
                </div>
                <div className="card" style={{ flex: 1 }}>
                  Total Value: INR {completedOrdersTotal}
                </div>
              </div>
              <h3>Completed Orders by Area</h3>
              {Object.keys(closedOrdersByArea).length === 0 && (
                <p>No orders</p>
              )}
              {Object.entries(closedOrdersByArea).map(([area, count]) => (
                <div key={area} className="row">
                  <div style={{ flex: 1 }}>{area}</div>
                  <div>{count}</div>
                </div>
              ))}
              <h3>Delivered by Agent</h3>
              {Object.keys(deliveredByAgent).length === 0 && <p>No deliveries</p>}
              {Object.entries(deliveredByAgent).map(([agent, data]) => (
                <div key={agent} className="card stack">
                  <strong>
                    {agent} - {data.total} orders
                  </strong>
                  {Object.entries(data.byArea).map(([area, count]) => (
                    <div key={area} className="row">
                      <div style={{ flex: 1 }}>{area}</div>
                      <div>{count}</div>
                    </div>
                  ))}
                </div>
              ))}
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
                  className={`btn ${historyTab === "active" ? "" : "secondary"}`}
                  onClick={() => setHistoryTab("active")}
                >
                  Active Orders
                </button>
                <button
                  className={`btn ${historyTab === "delivery" ? "" : "secondary"}`}
                  onClick={() => setHistoryTab("delivery")}
                >
                  Delivery Status
                </button>
              </div>

              {historyTab === "summary" && (
                <div className="stack">
                  {filteredActiveOrdersSummary.length === 0 && (
                    <p>No active orders</p>
                  )}
                  {filteredActiveOrdersSummary.map((group) => (
                    <div key={group.key} className="card stack">
                      <strong>
                        {formatDateLabel(group.date)} - {group.mealType}
                      </strong>
                      <div className="row">
                        <div className="card" style={{ flex: 1 }}>
                          Orders Received: {group.totalOrders}
                        </div>
                        <div className="card" style={{ flex: 1 }}>
                          Total Value: INR {group.totalValue}
                        </div>
                      </div>
                      <div className="row">
                        <div className="card" style={{ flex: 1 }}>
                          <strong>Orders by Area</strong>
                          {Object.keys(group.byArea).length === 0 && (
                            <p>No orders</p>
                          )}
                          {Object.entries(group.byArea).map(([area, count]) => (
                            <div key={area} className="row">
                              <div style={{ flex: 1 }}>{area}</div>
                              <div>{count}</div>
                            </div>
                          ))}
                        </div>
                        <div className="card" style={{ flex: 1 }}>
                          <strong>Delivery Type</strong>
                          {Object.keys(group.byDelivery).length === 0 && (
                            <p>No orders</p>
                          )}
                          {Object.entries(group.byDelivery).map(
                            ([delivery, count]) => (
                              <div key={delivery} className="row">
                                <div style={{ flex: 1 }}>{delivery}</div>
                                <div>{count}</div>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                      <div className="card">
                        <strong>Items Count</strong>
                        {Object.keys(group.itemCounts).length === 0 && (
                          <p>No items</p>
                        )}
                        {Object.entries(group.itemCounts).map(
                          ([name, count]) => (
                            <div key={name} className="row">
                              <div style={{ flex: 1 }}>{name}</div>
                              <div>{count}</div>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {historyTab === "active" && (
                <div className="stack">
                  <div className="row">
                    <input
                      className="input"
                      placeholder="Search by Order ID / Phone / Customer"
                      value={activeOrderSearch}
                      onChange={(e) => setActiveOrderSearch(e.target.value)}
                    />
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
                  </div>
                  {filteredActiveOrders.length === 0 && <p>No active orders</p>}
                {filteredActiveOrders.map((order) => (
                    <div key={order.id} className="card list-card">
                      <div>Order: {order.orderId || order.id}</div>
                      <div>
                        {order.customerName || "Customer"} | {order.phone}
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
                </div>
              )}

              {historyTab === "delivery" && (
                <div className="stack">
                  {Object.keys(deliveryStatusByAgent).length === 0 && (
                    <p>No active published orders</p>
                  )}
                  {Object.entries(deliveryStatusByAgent).map(
                    ([agent, data]) => (
                      <div key={agent} className="card stack">
                        <strong>
                          {agent} - Delivered: {data.delivered} | Pending:{" "}
                          {data.pending}
                        </strong>
                        {Object.entries(data.byArea).map(([area, counts]) => (
                          <div key={area} className="row">
                            <div style={{ flex: 1 }}>{area}</div>
                            <div>
                              Delivered: {counts.delivered} | Pending:{" "}
                              {counts.pending}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
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
                  <h3>Area Assignments</h3>
                  <div className="table">
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
                      return (
                        <div key={area} className="row list-card" style={{ position: "relative" }}>
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
                <button className="btn" onClick={addServiceArea}>
                  Add Area
                </button>
              </div>
              {serviceAreas.length === 0 && <p>No areas yet</p>}
              {serviceAreas.map((area) => (
                <div key={area.id} className="row list-card">
                  <div style={{ flex: 1 }}>{area.name}</div>
                  <button
                    className="btn secondary"
                    onClick={() => deleteServiceArea(area.id)}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </main>
  );
}

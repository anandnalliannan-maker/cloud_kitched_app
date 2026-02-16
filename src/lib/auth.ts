import bcrypt from "bcryptjs";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

import { db } from "./firebase";

export type OwnerAccount = {
  username: string;
  passwordHash: string;
  active: boolean;
};

export type DeliveryAccount = {
  username: string;
  passwordHash?: string;
  active?: boolean;
};

export async function ownerExists(): Promise<boolean> {
  const q = query(collection(db, "admin_users"), limit(1));
  const snap = await getDocs(q);
  return !snap.empty;
}

export async function createOwnerAccount(
  username: string,
  password: string
) {
  const ref = doc(db, "admin_users", username);
  const hash = await bcrypt.hash(password, 10);
  await setDoc(
    ref,
    {
      username,
      passwordHash: hash,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function loginOwner(username: string, password: string) {
  const ref = doc(db, "admin_users", username);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Invalid credentials");
  const data = snap.data() as OwnerAccount;
  if (data.active === false) throw new Error("Account inactive");
  const ok = await bcrypt.compare(password, data.passwordHash);
  if (!ok) throw new Error("Invalid credentials");
  return true;
}

export async function changeOwnerPassword(
  username: string,
  newPassword: string
) {
  const ref = doc(db, "admin_users", username);
  const hash = await bcrypt.hash(newPassword, 10);
  await updateDoc(ref, {
    passwordHash: hash,
    updatedAt: serverTimestamp(),
  });
}

export async function loginDelivery(
  username: string,
  password: string
) {
  const normalized = normalizePhone(username);
  const ref = doc(db, "delivery_agents", normalized);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Invalid credentials");
  const data = snap.data() as DeliveryAccount;
  if (data.active === false) throw new Error("Account inactive");
  if (!data.passwordHash) throw new Error("Password not set");
  const ok = await bcrypt.compare(password, data.passwordHash);
  if (!ok) throw new Error("Invalid credentials");
  return true;
}

export async function setDeliveryPassword(
  username: string,
  password: string
) {
  const normalized = normalizePhone(username);
  const ref = doc(db, "delivery_agents", normalized);
  const hash = await bcrypt.hash(password, 10);
  await updateDoc(ref, {
    passwordHash: hash,
    updatedAt: serverTimestamp(),
  });
}

export async function findDeliveryByPhone(phone: string) {
  const normalized = normalizePhone(phone);
  const q = query(
    collection(db, "delivery_agents"),
    where("phone", "==", normalized),
    limit(1)
  );
  const snap = await getDocs(q);
  return snap.empty ? null : snap.docs[0].data();
}

export function normalizePhone(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (raw.startsWith("+")) return raw;
  return raw;
}

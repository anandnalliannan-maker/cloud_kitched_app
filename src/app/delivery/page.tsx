"use client";

import { useEffect, useState } from "react";

import { loginDelivery, normalizePhone } from "@/lib/auth";
import { clearSession, getSession, saveSession } from "@/lib/session";

type Mode = "loading" | "login" | "dashboard";

export default function DeliveryPage() {
  const [mode, setMode] = useState<Mode>("loading");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    username: "",
    password: "",
  });

  useEffect(() => {
    const session = getSession();
    if (session?.role === "delivery") {
      setMode("dashboard");
      return;
    }
    setMode("login");
  }, []);

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
            <p>Logged in as delivery agent.</p>
            <button className="btn secondary" onClick={handleLogout}>
              Logout
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

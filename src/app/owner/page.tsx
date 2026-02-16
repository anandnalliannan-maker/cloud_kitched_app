"use client";

import { useEffect, useState } from "react";

import {
  changeOwnerPassword,
  createOwnerAccount,
  loginOwner,
  ownerExists,
} from "@/lib/auth";
import { clearSession, getSession, saveSession } from "@/lib/session";

type Mode = "loading" | "setup" | "login" | "dashboard";

export default function OwnerPage() {
  const [mode, setMode] = useState<Mode>("loading");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    username: "",
    password: "",
    newPassword: "",
  });

  useEffect(() => {
    const session = getSession();
    if (session?.role === "owner") {
      setMode("dashboard");
      return;
    }
    ownerExists()
      .then((exists) => setMode(exists ? "login" : "setup"))
      .catch((err) => {
        setError(err.message || "Failed to load");
        setMode("login");
      });
  }, []);

  async function handleSetup() {
    setError("");
    if (!form.username || !form.password) {
      setError("Enter username and password");
      return;
    }
    await createOwnerAccount(form.username, form.password);
    saveSession({ role: "owner", username: form.username });
    setMode("dashboard");
  }

  async function handleLogin() {
    setError("");
    if (!form.username || !form.password) {
      setError("Enter username and password");
      return;
    }
    await loginOwner(form.username, form.password);
    saveSession({ role: "owner", username: form.username });
    setMode("dashboard");
  }

  async function handleChangePassword() {
    setError("");
    if (!form.newPassword) {
      setError("Enter new password");
      return;
    }
    const session = getSession();
    if (!session) {
      setMode("login");
      return;
    }
    await changeOwnerPassword(session.username, form.newPassword);
    setForm({ ...form, newPassword: "" });
  }

  function handleLogout() {
    clearSession();
    setMode("login");
  }

  return (
    <main className="container">
      <div className="card stack">
        <h1>Owner Portal</h1>
        {mode === "loading" && <p>Loading...</p>}

        {mode === "setup" && (
          <div className="stack">
            <p>Set initial owner credentials.</p>
            <div className="field">
              <label>Username</label>
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
            <button className="btn" onClick={handleSetup}>
              Create Owner
            </button>
          </div>
        )}

        {mode === "login" && (
          <div className="stack">
            <p>Login with your owner username and password.</p>
            <div className="field">
              <label>Username</label>
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
            <p>Logged in as owner.</p>
            <div className="field">
              <label>Change Password</label>
              <input
                className="input"
                type="password"
                value={form.newPassword}
                onChange={(e) =>
                  setForm({ ...form, newPassword: e.target.value })
                }
              />
            </div>
            {error && <p style={{ color: "crimson" }}>{error}</p>}
            <div className="row">
              <button className="btn" onClick={handleChangePassword}>
                Update Password
              </button>
              <button className="btn secondary" onClick={handleLogout}>
                Logout
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

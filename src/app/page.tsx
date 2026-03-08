"use client";

import { useState } from "react";

export default function Home() {
  const [showNav, setShowNav] = useState(false);

  const menuLinks = [
    { label: "Customer", href: "/customer" },
    { label: "Owner/Admin", href: "/owner" },
    { label: "Delivery Agent", href: "/delivery" },
  ];

  const infoLinks = [
    { label: "About Us", href: "/about-us" },
    { label: "Contact Us", href: "/contact-us" },
    { label: "Terms and Conditions", href: "/terms-and-conditions" },
    { label: "Privacy Policy", href: "/privacy-policy" },
    {
      label: "Refund and Cancellation Policy",
      href: "/refund-and-cancellation-policy",
    },
  ];

  return (
    <main className="container">
      {showNav && (
        <div className="owner-nav-drawer" onClick={() => setShowNav(false)}>
          <div
            className="owner-nav-panel home-nav-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>Menu</strong>
            </div>
            <div className="stack">
              {menuLinks.map((link) => (
                <a
                  key={link.href}
                  className="btn secondary"
                  href={link.href}
                  onClick={() => setShowNav(false)}
                >
                  {link.label}
                </a>
              ))}
            </div>
            <hr style={{ border: 0, borderTop: "1px solid var(--border)" }} />
            <div className="stack">
              {infoLinks.map((link) => (
                <a
                  key={link.href}
                  className="drawer-link"
                  href={link.href}
                  onClick={() => setShowNav(false)}
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="card stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h1>MS Kitchen</h1>
          <button
            type="button"
            className="btn secondary owner-nav-toggle"
            style={{ display: "inline-flex" }}
            onClick={() => setShowNav(true)}
            aria-label="Open menu"
          >
            Menu
          </button>
        </div>
        <p>Choose your portal.</p>
        <div className="row">
          <a className="btn" href="/customer">
            Customer
          </a>
          <a className="btn secondary" href="/owner">
            Owner/Admin
          </a>
          <a className="btn secondary" href="/delivery">
            Delivery Agent
          </a>
        </div>
        <div className="row home-link-row">
          <a href="/about-us">About Us</a>
          <a href="/contact-us">Contact Us</a>
          <a href="/terms-and-conditions">Terms and Conditions</a>
          <a href="/privacy-policy">Privacy Policy</a>
          <a href="/refund-and-cancellation-policy">Refund and Cancellation</a>
        </div>
      </div>
    </main>
  );
}



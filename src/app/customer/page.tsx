"use client";

import { useMemo, useRef, useState } from "react";
import {
  Autocomplete,
  GoogleMap,
  LoadScript,
  Marker,
} from "@react-google-maps/api";

type CartItem = {
  id: string;
  name: string;
  price: number;
  qty: number;
};

const mapContainerStyle = { width: "100%", height: "320px" };
const defaultCenter = { lat: 12.9716, lng: 80.2214 };

export default function CustomerPage() {
  const [items, setItems] = useState<(CartItem & { description: string })[]>([
    { id: "1", name: "Chapathi", price: 10, qty: 0, description: "Soft roti" },
    { id: "2", name: "Sambar", price: 40, qty: 0, description: "Spiced dal" },
  ]);
  const menuDateLabel = "11-Feb-2026"; // TODO: load from owner-published menu
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

  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

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

  return (
    <main className="container">
      <div className="stack">
        <h1>MS Kitchen Menu</h1>

        {step === "menu" && (
          <div className="card stack">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2>Menu</h2>
              <span style={{ color: "var(--muted)", fontWeight: 600 }}>
                {menuDateLabel}
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
                </div>
                <div className="row">
                  <button
                    className="btn secondary"
                    onClick={() => updateQty(item.id, -1)}
                  >
                    -
                  </button>
                  <div>{item.qty}</div>
                  <button className="btn" onClick={() => updateQty(item.id, 1)}>
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
                    <option value="Madipakkam">Madipakkam</option>
                    <option value="Medavakkam">Medavakkam</option>
                    <option value="Velachery">Velachery</option>
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
                onClick={() => setStep("payment")}
              >
                Proceed and Pay
              </button>
            </div>
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
            <p>Order ID will be created after payment confirmation.</p>
          </div>
        )}
      </div>
    </main>
  );
}

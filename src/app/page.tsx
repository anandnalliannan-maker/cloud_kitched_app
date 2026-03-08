export default function Home() {
  return (
    <main className="container">
      <div className="card stack">
        <h1>MS Kitchen</h1>
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
        <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
          <a href="/about-us">About Us</a>
          <a href="/contact-us">Contact Us</a>
          <a href="/terms-and-conditions">Terms and Conditions</a>
          <a href="/privacy-policy">Privacy Policy</a>
          <a href="/refund-and-cancellation-policy">
            Refund and Cancellation Policy
          </a>
        </div>
      </div>
    </main>
  );
}

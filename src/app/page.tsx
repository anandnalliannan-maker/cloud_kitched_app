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
      </div>
    </main>
  );
}

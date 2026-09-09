function App() {
  return (
    <div className="app">
      <header className="navbar">
        <h2>⚡ EVolve</h2>

        <nav>
          <a href="#">Stations</a>
          <a href="#">Bookings</a>
          <a href="#">Login</a>
        </nav>
      </header>

      <main>
        <section className="hero">
          <div>
            <p className="tagline">SMART EV CHARGING</p>

            <h1>Charge smarter.<br />Travel further.</h1>

            <p className="description">
              Find available EV chargers, book your slot,
              and manage your charging journey from one place.
            </p>

            <button>Find Charging Stations</button>
          </div>
        </section>

        <section className="status">
          <h2>Live Charging Status</h2>

          <div className="status-grid">
            <div className="status-card">
              <h3>Available Chargers</h3>
              <strong>18</strong>
              <p>Ready to use</p>
            </div>

            <div className="status-card">
              <h3>Currently Charging</h3>
              <strong>7</strong>
              <p>In active sessions</p>
            </div>

            <div className="status-card">
              <h3>Total Stations</h3>
              <strong>12</strong>
              <p>Connected stations</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
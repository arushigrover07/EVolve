function App() {
  return (
    <div>
      <header>
        <h2>⚡ EVolve</h2>

        <nav>
          <a href="#">Stations</a>
          <a href="#">Bookings</a>
          <a href="#">Login</a>
        </nav>
      </header>

      <main>
        <section>
          <h1>Smart EV Charging</h1>

          <p>
            Find a charging station, check charger availability,
            and manage your charging sessions in one place.
          </p>

          <button>Find Charging Stations</button>
        </section>

        <section>
          <h2>Live Charging Status</h2>

          <div>
            <h3>Available Chargers</h3>
            <p>18</p>
          </div>

          <div>
            <h3>Currently Charging</h3>
            <p>7</p>
          </div>

          <div>
            <h3>Total Stations</h3>
            <p>12</p>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
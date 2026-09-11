import React, { useState } from 'react';
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import StatusSection from './components/StatusSection';
import StationsSection from './components/StationsSection';
import Footer from './components/Footer';
import BookingModal from './components/BookingModal';

function App() {
  const [selectedStation, setSelectedStation] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleScrollToStations = () => {
    const element = document.getElementById('stations');
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="app-layout">
      {/* 1. Navigation Bar */}
      <Navbar onFindChargerClick={handleScrollToStations} />

      {/* 2. Main Content Area */}
      <main>
        {/* Hero Section */}
        <Hero onExploreClick={handleScrollToStations} />

        {/* Live Network Status Section & CSS Visualization */}
        <StatusSection />

        {/* Nearby Charging Stations & Interactive Search/Filter */}
        <StationsSection key={refreshKey} onBookClick={(station) => setSelectedStation(station)} />
      </main>

      {/* 3. Footer */}
      <Footer />

      {/* 4. Slot Booking Modal Dialog */}
      {selectedStation && (
        <BookingModal
          station={selectedStation}
          onClose={() => setSelectedStation(null)}
          onBookingSuccess={() => {
            setRefreshKey((prev) => prev + 1);
          }}
        />
      )}
    </div>
  );
}

export default App;
import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import StatusSection from './components/StatusSection';
import StationsSection from './components/StationsSection';
import BookingsSection from './components/BookingsSection';
import Footer from './components/Footer';
import BookingModal from './components/BookingModal';
import LoginModal from './components/LoginModal';

function App() {
  const [selectedStation, setSelectedStation] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState({
    id: 1,
    name: 'Demo Operator',
    email: 'operator@evolve.cloud'
  });

  const handleScrollToStations = () => {
    const element = document.getElementById('stations');
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash;
      if (hash === '#bookings') {
        const el = document.getElementById('bookings');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth' });
        }
      } else if (hash === '#login') {
        setIsLoginOpen(true);
      }
    };

    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  return (
    <div className="app-layout">
      {/* 1. Navigation Bar */}
      <Navbar
        onFindChargerClick={handleScrollToStations}
        onLoginClick={() => setIsLoginOpen(true)}
        currentUser={currentUser}
        onLogout={() => setCurrentUser(null)}
      />

      {/* 2. Main Content Area */}
      <main>
        {/* Hero Section */}
        <Hero onExploreClick={handleScrollToStations} />

        {/* Live Network Status Section & CSS Visualization */}
        <StatusSection />

        {/* Nearby Charging Stations & Interactive Search/Filter */}
        <StationsSection key={refreshKey} onBookClick={(station) => setSelectedStation(station)} />

        {/* User Bookings & Reservations Section */}
        <BookingsSection key={`bookings-${refreshKey}`} onBookNewClick={handleScrollToStations} />
      </main>

      {/* 3. Footer */}
      <Footer onLoginClick={() => setIsLoginOpen(true)} />

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

      {/* 5. Operator Login Modal Dialog */}
      <LoginModal
        isOpen={isLoginOpen}
        onClose={() => setIsLoginOpen(false)}
        onLoginSuccess={(user) => setCurrentUser(user)}
      />
    </div>
  );
}

export default App;
import React from 'react';
import StatusCard from './StatusCard';
import NetworkVisualization from './NetworkVisualization';

function StatusSection() {
  return (
    <section id="network" className="status-section">
      <div className="section-container">
        {/* Section Header */}
        <div className="section-header">
          <div>
            <span className="section-eyebrow">NETWORK OVERVIEW</span>
            <h2 className="section-title">Live Network Status</h2>
          </div>
          <p className="section-description">
            Operational status and real-time charging capacity metrics across connected EVolve stations.
          </p>
        </div>

        {/* 4 Primary Status Cards */}
        <div className="status-grid">
          <StatusCard
            title="Available Chargers"
            value="18"
            unit="/ 25"
            statusText="72% Available"
            statusType="success"
            subtitle="Ready for immediate plug & charge"
            icon="🔌"
          />

          <StatusCard
            title="Currently Charging"
            value="7"
            unit=" EVs"
            statusText="Active Sessions"
            statusType="info"
            subtitle="High-power sessions in progress"
            icon="⚡"
          />

          <StatusCard
            title="Connected Stations"
            value="12"
            unit=" Hubs"
            statusText="100% Online"
            statusType="success"
            subtitle="Monitored by EVolve Cloud"
            icon="📡"
          />

          <StatusCard
            title="Network Utilization"
            value="78"
            unit="%"
            statusText="Optimal Efficiency"
            statusType="warning"
            subtitle="Grid load within safe thresholds"
            icon="📊"
          />
        </div>

        {/* CSS Network Utilization Visualizer */}
        <NetworkVisualization />
      </div>
    </section>
  );
}

export default StatusSection;

import React from 'react';

function NetworkVisualization() {
  // Sample hourly demand profile data (CSS-only bar visualization)
  const hourlyDemand = [
    { time: '06:00', load: 35, label: '35%' },
    { time: '09:00', load: 75, label: '75%' },
    { time: '12:00', load: 88, label: '88%' },
    { time: '15:00', load: 62, label: '62%' },
    { time: '18:00', load: 92, label: '92%' },
    { time: '21:00', load: 45, label: '45%' },
  ];

  return (
    <div className="network-viz-container">
      <div className="network-viz-header">
        <div>
          <h3>Network Capacity & Demand Distribution</h3>
          <p>Real-time load balancing and peak usage trends across connected stations</p>
        </div>
        <div className="viz-legend">
          <span className="legend-item"><span className="dot peak"></span> Peak Demand</span>
          <span className="legend-item"><span className="dot normal"></span> Normal Load</span>
        </div>
      </div>

      <div className="network-viz-grid">
        {/* Hourly Peak Load Distribution (CSS Column Bars) */}
        <div className="viz-box">
          <h4 className="viz-box-title">Hourly Grid Demand Profile</h4>
          <div className="css-chart-bars">
            {hourlyDemand.map((item, idx) => (
              <div key={idx} className="bar-column">
                <div className="bar-wrapper">
                  <div 
                    className={`bar-fill ${item.load > 80 ? 'peak-fill' : ''}`}
                    style={{ height: `${item.load}%` }}
                  >
                    <span className="bar-tooltip">{item.label}</span>
                  </div>
                </div>
                <span className="bar-time">{item.time}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Connector Type Distribution Meter */}
        <div className="viz-box">
          <h4 className="viz-box-title">Charger Category Distribution</h4>
          
          <div className="meter-group">
            <div className="meter-info">
              <span>CCS2 Fast DC (150 kW - 240 kW)</span>
              <strong>65% Capacity Used</strong>
            </div>
            <div className="meter-track">
              <div className="meter-fill dc-fill" style={{ width: '65%' }}></div>
            </div>
          </div>

          <div className="meter-group">
            <div className="meter-info">
              <span>Type 2 AC (22 kW)</span>
              <strong>40% Capacity Used</strong>
            </div>
            <div className="meter-track">
              <div className="meter-fill ac-fill" style={{ width: '40%' }}></div>
            </div>
          </div>

          <div className="meter-group">
            <div className="meter-info">
              <span>CHAdeMO DC (60 kW)</span>
              <strong>25% Capacity Used</strong>
            </div>
            <div className="meter-track">
              <div className="meter-fill chademo-fill" style={{ width: '25%' }}></div>
            </div>
          </div>

          <div className="grid-status-footer">
            <span className="status-indicator-icon">🟢</span>
            <span>Cloud Infrastructure status: <strong>Optimal Grid Frequency & Load Balanced</strong></span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default NetworkVisualization;

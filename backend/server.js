const express = require("express");
const cors = require("cors");
const db = require("./db");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message: "EVolve backend is running!"
  });
});

app.get("/api/stations", (req, res) => {
  const stations = [
    {
      id: 1,
      name: "EVolve Central Station",
      location: "Vellore",
      availableChargers: 4,
      totalChargers: 6
    },
    {
      id: 2,
      name: "Green Charge Hub",
      location: "Chennai",
      availableChargers: 2,
      totalChargers: 5
    },
    {
      id: 3,
      name: "EcoCharge Point",
      location: "Bangalore",
      availableChargers: 5,
      totalChargers: 8
    }
  ];

  res.json(stations);
});

const PORT = 5000;

app.listen(PORT, () => {
  console.log(`EVolve backend running on port ${PORT}`);
});
const fs = require("fs");
const path = require("path");

// Load .env file if environment variables are not already present
if (!process.env.OCM_API_KEY && fs.existsSync(path.join(__dirname, ".env"))) {
  const envContent = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
  for (const line of envContent.split(/\r?\n/)) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2] ? match[2].trim().replace(/^['"]|['"]$/g, "") : "";
    }
  }
}

const db = require("./db");

// Process error handlers to catch unhandled errors and prevent silent termination
process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT EXCEPTION]", err && err.stack ? err.stack : err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[UNHANDLED REJECTION]", reason && reason.stack ? reason.stack : reason);
  process.exit(1);
});


const apiKey = process.env.OCM_API_KEY;
if (!apiKey) {
  console.error("Error: OCM_API_KEY is missing from environment variables or .env file.");
  process.exit(1);
}

const isRealImport =
  process.env.EXECUTE_IMPORT === "true" ||
  process.env.REAL_IMPORT === "true" ||
  process.argv.includes("--import");

// Validate MAX_RECORDS
const rawMaxRecords = process.env.MAX_RECORDS;
let MAX_RECORDS = null;

if (rawMaxRecords !== undefined && rawMaxRecords !== "") {
  const parsed = parseInt(rawMaxRecords, 10);
  if (!isNaN(parsed) && parsed > 0) {
    MAX_RECORDS = parsed;
  }
}

if (isRealImport) {
  if (!MAX_RECORDS) {
    console.error(
      "Error: REAL IMPORT mode requires an explicit positive finite MAX_RECORDS value (e.g. MAX_RECORDS=1949)."
    );
    console.error("Unlimited import (MAX_RECORDS=0/all/unlimited) is not permitted.");
    process.exit(1);
  }
} else {
  if (!MAX_RECORDS) {
    MAX_RECORDS = 500;
  }
}

function isValidCoordinate(lat, lon) {
  return (
    typeof lat === "number" &&
    typeof lon === "number" &&
    !isNaN(lat) &&
    !isNaN(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

function formatLocation(addressInfo) {
  if (!addressInfo) return "India";
  const parts = [
    addressInfo.Town,
    addressInfo.StateOrProvince,
    addressInfo.AddressLine1
  ].filter((p) => p && typeof p === "string" && p.trim().length > 0);

  return parts.length > 0 ? parts.join(", ") : "India";
}

function mapStationStatus(statusType) {
  if (!statusType) return "ACTIVE";
  if (statusType.IsOperational === false) return "INACTIVE";
  const title = (statusType.Title || "").toLowerCase();
  if (title.includes("non-operational") || title.includes("decommissioned") || title.includes("planned")) {
    return "INACTIVE";
  }
  return "ACTIVE";
}

function transformRecord(station) {
  const addressInfo = station.AddressInfo || {};
  const ocmId = station.ID;
  const name = addressInfo.Title ? addressInfo.Title.trim() : "Unknown Station";
  const location = formatLocation(addressInfo);
  const latitude = Number(addressInfo.Latitude);
  const longitude = Number(addressInfo.Longitude);
  const status = mapStationStatus(station.StatusType);

  const rawConnections = Array.isArray(station.Connections) ? station.Connections : [];
  const chargers = [];

  for (const conn of rawConnections) {
    const chargerType = conn.ConnectionType?.Title ? conn.ConnectionType.Title.trim() : "Standard EV Charger";
    const powerKw = conn.PowerKW ? Number(conn.PowerKW) : 7.4;
    const quantity = conn.Quantity ? Math.max(1, parseInt(conn.Quantity, 10)) : 1;
    const connId = conn.ID || null;

    for (let p = 1; p <= quantity; p++) {
      chargers.push({
        ocm_connection_id: connId,
        ocm_port_index: p,
        charger_type: chargerType,
        power_kw: isNaN(powerKw) ? 7.4 : powerKw,
        status: "AVAILABLE"
      });
    }
  }

  if (chargers.length === 0) {
    chargers.push({
      ocm_connection_id: null,
      ocm_port_index: 1,
      charger_type: "Standard EV Charger",
      power_kw: 7.4,
      status: "AVAILABLE"
    });
  }

  return {
    ocm_id: ocmId,
    name,
    location,
    latitude,
    longitude,
    status,
    chargers
  };
}

async function runImporter() {
  console.log(`[OCM IMPORTER] Starting in ${isRealImport ? "REAL IMPORT" : "DRY RUN"} mode...`);
  console.log(`[CONFIG] Request Limit MAX_RECORDS: ${MAX_RECORDS}`);

  console.log(`[OCM API] Requesting ${MAX_RECORDS} records from OpenChargeMap API (countrycode=IN)...`);
  const url = `https://api.openchargemap.io/v3/poi/?output=json&countrycode=IN&maxresults=${MAX_RECORDS}&key=${apiKey}`;

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  } catch (fetchErr) {
    if (fetchErr.name === "AbortError" || fetchErr.name === "TimeoutError") {
      console.error("[OCM API TIMEOUT] Request timed out after 15 seconds.");
    } else {
      console.error(`[OCM API FETCH ERROR] Request failed: ${fetchErr.message}`);
    }
    throw fetchErr;
  }

  console.log(`[OCM API] Response received (HTTP ${response.status}).`);

  if (!response.ok) {
    throw new Error(`OpenChargeMap API request failed with HTTP ${response.status}`);
  }

  const rawData = await response.json();
  if (!Array.isArray(rawData)) {
    throw new Error("OpenChargeMap API response is not a valid JSON array.");
  }

  console.log(`[OCM API] Successfully fetched ${rawData.length} raw records.`);

  const seenOcmIds = new Set();
  const uniqueRawRecords = [];
  let duplicatesRemoved = 0;

  for (const record of rawData) {
    if (record.ID) {
      if (seenOcmIds.has(record.ID)) {
        duplicatesRemoved++;
      } else {
        seenOcmIds.add(record.ID);
        uniqueRawRecords.push(record);
      }
    }
  }

  let usableCount = 0;
  let skippedCount = 0;
  let totalChargersCount = 0;
  const transformedList = [];
  const sampleRecords = [];

  for (const raw of uniqueRawRecords) {
    const addressInfo = raw.AddressInfo;
    if (!raw.ID || !addressInfo || !isValidCoordinate(addressInfo.Latitude, addressInfo.Longitude)) {
      skippedCount++;
      continue;
    }

    const transformed = transformRecord(raw);
    transformedList.push(transformed);
    usableCount++;
    totalChargersCount += transformed.chargers.length;

    if (sampleRecords.length < 2) {
      sampleRecords.push(transformed);
    }
  }

  if (!isRealImport) {
    let existingStationsMap = new Map();
    let existingChargersSet = new Set();

    try {
      const dbStations = await db.query("SELECT id, ocm_id FROM stations WHERE ocm_id IS NOT NULL");
      for (const row of dbStations.rows) {
        existingStationsMap.set(row.ocm_id, row.id);
      }

      const dbChargers = await db.query("SELECT station_id, ocm_connection_id, ocm_port_index FROM chargers WHERE ocm_connection_id IS NOT NULL");
      for (const row of dbChargers.rows) {
        existingChargersSet.add(`${row.station_id}:${row.ocm_connection_id}:${row.ocm_port_index}`);
      }
    } catch (err) {
      // Ignore DB read warning in dry run
    }

    let stationsToInsert = 0;
    let stationsToUpdate = 0;
    let chargersToInsert = 0;
    let chargersToUpdate = 0;

    for (const item of transformedList) {
      const existingStationId = existingStationsMap.get(item.ocm_id);
      if (existingStationId) {
        stationsToUpdate++;
      } else {
        stationsToInsert++;
      }

      for (const charger of item.chargers) {
        if (charger.ocm_connection_id && existingStationId) {
          const key = `${existingStationId}:${charger.ocm_connection_id}:${charger.ocm_port_index}`;
          if (existingChargersSet.has(key)) {
            chargersToUpdate++;
          } else {
            chargersToInsert++;
          }
        } else {
          chargersToInsert++;
        }
      }
    }

    console.log("\n================ IMPORTER SUMMARY ================");
    console.log(`Mode: DRY RUN`);
    console.log(`Raw records returned from OCM: ${rawData.length}`);
    console.log(`Unique OCM station IDs: ${seenOcmIds.size}`);
    console.log(`Duplicates removed: ${duplicatesRemoved}`);
    console.log(`Usable stations processed: ${usableCount}`);
    console.log(`Skipped/invalid records: ${skippedCount}`);
    console.log(`Total chargers detected: ${totalChargersCount}`);
    console.log("\n--- Station Summary ---");
    console.log(`  New stations to INSERT: ${stationsToInsert}`);
    console.log(`  Existing stations to UPDATE: ${stationsToUpdate}`);
    console.log("\n--- Charger Summary (SAFE UPSERT - NO DELETIONS) ---");
    console.log(`  New chargers to INSERT: ${chargersToInsert}`);
    console.log(`  Existing chargers to UPDATE: ${chargersToUpdate}`);
    console.log("\n--- Sample Transformed Records (First 2) ---");
    console.log(JSON.stringify(sampleRecords, null, 2));
    console.log("=================================================");
    console.log("\nDRY RUN complete. Zero database writes performed.");
    console.log("To run real import, specify explicit MAX_RECORDS:");
    console.log("  REAL_IMPORT=true MAX_RECORDS=1949 node import-ocm.js");

    await db.end().catch(() => {});
    process.exit(0);
  }

  // REAL IMPORT MODE
  console.log(`\n[REAL IMPORT] Processing ${usableCount} stations and ${totalChargersCount} chargers into PostgreSQL...`);
  let insertedStations = 0;
  let updatedStations = 0;
  let insertedChargers = 0;
  let updatedChargers = 0;

  for (let i = 0; i < transformedList.length; i++) {
    const item = transformedList[i];
    let client = null;
    try {
      client = await db.connect();
      if (i === 0) console.log("[DIAG 1] database client acquired");

      await client.query("BEGIN");
      if (i === 0) console.log("[DIAG 2] BEGIN sent");

      if (i === 0) console.log("[DIAG 3] station upsert started");
      const stationRes = await client.query(
        `INSERT INTO stations (name, location, status, latitude, longitude, ocm_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (ocm_id) DO UPDATE SET
           name = EXCLUDED.name,
           location = EXCLUDED.location,
           status = EXCLUDED.status,
           latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude
         RETURNING id, (xmax = 0) AS is_inserted`,
        [item.name, item.location, item.status, item.latitude, item.longitude, item.ocm_id]
      );

      const stationId = stationRes.rows[0].id;
      if (i === 0) console.log(`[DIAG 4] station upsert completed (station ID: ${stationId})`);
      if (stationRes.rows[0].is_inserted) {
        insertedStations++;
      } else {
        updatedStations++;
      }

      if (i === 0) console.log("[DIAG 5] charger processing started");
      for (let c = 0; c < item.chargers.length; c++) {
        const charger = item.chargers[c];
        if (charger.ocm_connection_id) {
          if (i === 0 && c === 0) console.log("[DIAG 6] first charger upsert started");
          const chargerRes = await client.query(
            `INSERT INTO chargers (station_id, charger_type, power_kw, status, ocm_connection_id, ocm_port_index)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (station_id, ocm_connection_id, ocm_port_index) WHERE ocm_connection_id IS NOT NULL
             DO UPDATE SET
               charger_type = EXCLUDED.charger_type,
               power_kw = EXCLUDED.power_kw
             RETURNING id, (xmax = 0) AS is_inserted`,
            [stationId, charger.charger_type, charger.power_kw, charger.status, charger.ocm_connection_id, charger.ocm_port_index]
          );
          if (i === 0 && c === 0) console.log("[DIAG 7] first charger upsert completed");

          if (chargerRes.rows[0].is_inserted) {
            insertedChargers++;
          } else {
            updatedChargers++;
          }
        } else {
          if (i === 0 && c === 0) console.log("[DIAG 6] first charger upsert started");
          await client.query(
            `INSERT INTO chargers (station_id, charger_type, power_kw, status)
             VALUES ($1, $2, $3, $4)`,
            [stationId, charger.charger_type, charger.power_kw, charger.status]
          );
          if (i === 0 && c === 0) console.log("[DIAG 7] first charger upsert completed");
          insertedChargers++;
        }
      }

      if (i === 0) console.log("[DIAG 8] COMMIT sent");
      await client.query("COMMIT");
      if (i === 0) console.log("[DIAG 9] COMMIT completed");
    } catch (err) {
      if (client) {
        await client.query("ROLLBACK").catch(() => {});
      }
      console.error(`[REAL IMPORT DB ERROR] Failed on station OCM ID ${item.ocm_id}:`, err.stack || err);
    } finally {
      if (client) {
        client.release();
        if (i === 0) console.log("[DIAG 10] client release");
      }
    }
    if (i === 0) console.log("[DIAG 11] first station transaction completed");

    if ((i + 1) % 100 === 0 || i === transformedList.length - 1) {
      console.log(`[REAL IMPORT PROGRESS] ${i + 1}/${transformedList.length} stations processed...`);
    }
  }

  console.log(`\n[REAL IMPORT COMPLETE] Stations: ${insertedStations} inserted, ${updatedStations} updated. Chargers: ${insertedChargers} inserted, ${updatedChargers} updated.`);
  await db.end().catch(() => {});
  process.exit(0);
}

runImporter().catch((error) => {
  console.error("[FATAL IMPORTER ERROR]", error.stack || error.message);
  process.exit(1);
});

const apiKey = process.env.OCM_API_KEY;

if (!apiKey) {
    console.log("OCM_API_KEY is missing from .env");
    process.exit(1);
}

async function previewStations() {
    const url =
        `https://api.openchargemap.io/v3/poi/?output=json&countrycode=IN&maxresults=10&key=${apiKey}`;

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`OpenChargeMap request failed: ${response.status}`);
    }

    const stations = await response.json();

    const preview = stations.map((station) => ({
        name: station.AddressInfo?.Title,
        location: station.AddressInfo?.Town ||
                  station.AddressInfo?.StateOrProvince,
        latitude: station.AddressInfo?.Latitude,
        longitude: station.AddressInfo?.Longitude,
        status: station.StatusType?.Title,
        chargers: station.Connections?.map((charger) => ({
            type: charger.ConnectionType?.Title,
            power_kw: charger.PowerKW,
            quantity: charger.Quantity
        }))
    }));

    console.log(JSON.stringify(preview, null, 2));
}

previewStations().catch((error) => {
    console.error(error.message);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { runInNewContext } = require("node:vm");

// Evaluate the actual config module with synthetic Vite/browser globals only.
// No Vite environment-file loading, network activity or real deployment settings.
const source = readFileSync(resolve(__dirname, "../../frontend/src/config.js"), "utf8")
  .replace("import.meta.env.VITE_API_URL", "viteApiUrl")
  .replace("export const API_BASE_URL", "const API_BASE_URL") + "\nAPI_BASE_URL;";

for (const [name, viteApiUrl, hostname, expected] of [
  ["Compose uses the browser origin", "/", "localhost", ""],
  ["Compose stays same-origin on a remote Docker host", "/", "demo.invalid", ""],
  ["local development fallback is unchanged", undefined, "localhost", "http://localhost:5000"],
  ["empty deployed configuration retains the Render fallback", "", "example.onrender.com", "https://evolve-qvy1.onrender.com"],
  ["unset deployed configuration retains the Render fallback", undefined, "example.onrender.com", "https://evolve-qvy1.onrender.com"],
  ["explicit deployed API override is preserved", "https://api.example.invalid", "example.onrender.com", "https://api.example.invalid"]
]) {
  test(`frontend API routing: ${name}`, () => {
    const actual = runInNewContext(source, { viteApiUrl, window: { location: { hostname } } });
    assert.equal(actual, expected);
    if (viteApiUrl === "/") assert.equal(`${actual}/api/instance`, "/api/instance");
  });
}

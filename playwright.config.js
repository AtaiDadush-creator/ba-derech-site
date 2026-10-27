// Playwright runs every spec against the built site (dist/) at phone, tablet and desktop sizes, in Chromium and WebKit (Safari).
import { defineConfig, devices } from "@playwright/test";

const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  globalTimeout: 15 * 60_000,
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:4173",
    locale: "he-IL",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/serve.mjs",
    url: "http://localhost:4173",
    reuseExistingServer: !ci,
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "tablet-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } } },
    { name: "phone-chromium-390", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
    { name: "phone-chromium-320", use: { ...devices["Pixel 7"], viewport: { width: 320, height: 640 } } },
    { name: "iphone-webkit", use: { ...devices["iPhone 13"] } },
    { name: "iphone-webkit-dark", use: { ...devices["iPhone 13"], colorScheme: "dark" } },
  ],
});

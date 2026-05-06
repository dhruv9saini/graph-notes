import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.graphnotes.app",
  appName: "Graph Notes",
  webDir: "dist",
  bundledWebRuntime: false,
  server: {
    androidScheme: "http",
    cleartext: true,
  },
};

export default config;

import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.dani.soundrace",
  appName: "Sound Race",
  webDir: "dist",
  server: {
    // Allow loading tracks from external CDN for the cache system.
    androidScheme: "https",
  },
};

export default config;

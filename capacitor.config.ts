import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.libreia.chat",
  appName: "LibreIA Chat",
  webDir: "dist",
  // The APK is a client only. Runtime state, Groq and trading execution live
  // behind the Cloudflare HTTPS API.
  server: { androidScheme: "http", cleartext: true },
  plugins: { CapacitorHttp: { enabled: true } },
};

export default config;

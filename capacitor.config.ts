import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.libreia.chat",
  appName: "LibreIA Chat",
  webDir: "dist",
  // The APK is a client only. Runtime state, Groq and trading execution live
  // behind the Cloudflare HTTPS API.
  // androidScheme se queda en "http" (cambiarlo movería el origen y se perderían los chats guardados);
  // el tráfico real va siempre por HTTPS, así que no hace falta permitir texto en claro.
  server: { androidScheme: "http", cleartext: false },
  // Nada de depurar el WebView en la APK publicada (daría acceso a sesión y chats con un cable USB).
  android: { webContentsDebuggingEnabled: false, allowMixedContent: false },
  plugins: { CapacitorHttp: { enabled: true } },
};

export default config;

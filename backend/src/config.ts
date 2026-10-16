import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: parseInt(process.env.PORT || "4000", 10),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  // Optional: push notifications are simply disabled (routes/pushService
  // no-op) on a deployment that hasn't set these yet.
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
  vapidSubject: process.env.VAPID_SUBJECT || "mailto:admin@vienna-thirstday.local",
  // Weather (Open-Meteo, no API key). Defaults to central Vienna; set to the
  // pitch's own coordinates for a more local forecast. WEATHER_ENABLED=false
  // turns the feature off (tests, or an air-gapped deployment).
  weatherEnabled: process.env.WEATHER_ENABLED !== "false",
  weatherLatitude: parseFloat(process.env.WEATHER_LATITUDE || "48.2082"),
  weatherLongitude: parseFloat(process.env.WEATHER_LONGITUDE || "16.3738"),
};

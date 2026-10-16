import type { GamedayWeather, WeatherCondition } from "../api/types";

const ICON: Record<WeatherCondition, string> = {
  sunny: "☀️",
  cloudy: "☁️",
  foggy: "🌫️",
  drizzle: "🌦️",
  rainy: "🌧️",
  snowy: "❄️",
  stormy: "⛈️",
};

const LABEL: Record<WeatherCondition, string> = {
  sunny: "Sunny",
  cloudy: "Cloudy",
  foggy: "Foggy",
  drizzle: "Drizzle",
  rainy: "Rainy",
  snowy: "Snowy",
  stormy: "Stormy",
};

const deg = (n: number) => `${Math.round(n)}°C`;

/** Weather on the matchday page. A forecast is labelled as such - it can still change - an observed one as what it was like. */
export function WeatherCard({ weather }: { weather: GamedayWeather | null }) {
  if (!weather) return null;
  const forecast = weather.kind === "FORECAST";
  const details: string[] = [];
  if (weather.feelsLikeC !== null && Math.abs(weather.feelsLikeC - weather.temperatureC) >= 2) details.push(`feels like ${deg(weather.feelsLikeC)}`);
  details.push(
    weather.isWindy
      ? `windy – ${Math.round(weather.windSpeedKmh)} km/h${weather.windGustsKmh ? `, gusts ${Math.round(weather.windGustsKmh)}` : ""}`
      : `${Math.round(weather.windSpeedKmh)} km/h wind`
  );
  if (weather.precipitationMm > 0) details.push(`${weather.precipitationMm} mm ${weather.condition === "snowy" ? "snow/precipitation" : "rain"}`);
  if (forecast && weather.precipitationProbability !== null) details.push(`${weather.precipitationProbability}% chance of rain`);

  return (
    <div className="card" style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
      <div style={{ fontSize: 36, lineHeight: 1 }} aria-hidden="true">
        {ICON[weather.condition]}
      </div>
      <div>
        <div style={{ fontWeight: 600 }}>
          {LABEL[weather.condition]}, {deg(weather.temperatureC)}
          <span className="badge" style={{ marginLeft: 8 }}>
            {forecast ? "Forecast" : "Actual"}
          </span>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 2 }}>{details.join(" · ")}</div>
        {forecast && <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>Can still change before kickoff.</div>}
      </div>
    </div>
  );
}

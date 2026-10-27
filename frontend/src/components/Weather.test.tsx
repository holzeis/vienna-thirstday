import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GamedayWeather } from "../api/types";
import { WeatherCard } from "./Weather";

const base: GamedayWeather = {
  kind: "FORECAST",
  condition: "sunny",
  temperatureC: 17.6,
  feelsLikeC: 17,
  windSpeedKmh: 8.4,
  windGustsKmh: 15,
  isWindy: false,
  precipitationMm: 0,
  precipitationProbability: 15,
  fetchedAt: "2026-10-27T10:00:00Z",
};

describe("WeatherCard", () => {
  it("renders nothing without weather", () => {
    const { container } = render(<WeatherCard weather={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("labels a forecast as such, with the chance of rain and a can-change note", () => {
    render(<WeatherCard weather={base} />);
    expect(screen.getByText(/Sunny, 18°C/)).toBeInTheDocument();
    expect(screen.getByText("Forecast")).toBeInTheDocument();
    expect(screen.getByText(/15% chance of rain/)).toBeInTheDocument();
    expect(screen.getByText(/Can still change before kickoff/)).toBeInTheDocument();
  });

  it("labels observed weather as actual, without forecast-only details", () => {
    render(<WeatherCard weather={{ ...base, kind: "OBSERVED" }} />);
    expect(screen.getByText("Actual")).toBeInTheDocument();
    expect(screen.queryByText(/chance of rain/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Can still change/)).not.toBeInTheDocument();
  });

  it("only mentions feels-like when it differs by at least 2 degrees", () => {
    const { rerender } = render(<WeatherCard weather={base} />);
    expect(screen.queryByText(/feels like/)).not.toBeInTheDocument();
    rerender(<WeatherCard weather={{ ...base, feelsLikeC: 12 }} />);
    expect(screen.getByText(/feels like 12°C/)).toBeInTheDocument();
  });

  it("calls out wind with gusts, and precipitation", () => {
    render(<WeatherCard weather={{ ...base, condition: "rainy", isWindy: true, precipitationMm: 2.5 }} />);
    expect(screen.getByText(/windy – 8 km\/h, gusts 15/)).toBeInTheDocument();
    expect(screen.getByText(/2.5 mm rain/)).toBeInTheDocument();
  });
});

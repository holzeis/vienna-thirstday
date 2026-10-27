import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CurrentFormBadges } from "./CurrentFormBadges";
import { ElectorBadge } from "./ElectorBadge";
import { NewcomerBadge } from "./NewcomerBadge";
import { PreviousSeasonTitleBadge } from "./PreviousSeasonTitleBadge";

describe("CurrentFormBadges", () => {
  const none = { veteran: false, undefeated: false, unlucky: false, ghost: false };

  it("renders nothing when no flag is set", () => {
    const { container } = render(<CurrentFormBadges currentForm={none} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders exactly the badges whose flag is set", () => {
    render(<CurrentFormBadges currentForm={{ ...none, undefeated: true, ghost: true }} />);
    expect(screen.getByTitle(/Undefeated/)).toBeInTheDocument();
    expect(screen.getByTitle(/Ghost/)).toBeInTheDocument();
    expect(screen.queryByTitle(/Veteran/)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Unlucky/)).not.toBeInTheDocument();
  });
});

describe("ElectorBadge", () => {
  it("renders nothing for a non-elector", () => {
    const { container } = render(<ElectorBadge rank={null} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("says who picks first and who picks second", () => {
    const { rerender } = render(<ElectorBadge rank={1} />);
    expect(screen.getByTitle("Elector - picks first")).toBeInTheDocument();
    rerender(<ElectorBadge rank={2} />);
    expect(screen.getByTitle("Elector - picks second")).toBeInTheDocument();
  });
});

describe("NewcomerBadge", () => {
  it("only renders for a newcomer", () => {
    const { container, rerender } = render(<NewcomerBadge isNewcomer={false} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<NewcomerBadge isNewcomer />);
    expect(screen.getByTitle(/Newcomer/)).toBeInTheDocument();
  });
});

describe("PreviousSeasonTitleBadge", () => {
  it("names the season on the champion and vice-champion badges", () => {
    const { rerender } = render(<PreviousSeasonTitleBadge title="champion" season={2025} />);
    expect(screen.getByTitle("Champion, 2025 season")).toBeInTheDocument();
    rerender(<PreviousSeasonTitleBadge title="viceChampion" season={2025} />);
    expect(screen.getByTitle("Vice champion, 2025 season")).toBeInTheDocument();
  });
  it("renders nothing without a title", () => {
    const { container } = render(<PreviousSeasonTitleBadge title={null} season={2025} />);
    expect(container).toBeEmptyDOMElement();
  });
});

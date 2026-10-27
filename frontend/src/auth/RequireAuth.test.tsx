import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../api/types";
import { RequireAdmin, RequireAuth } from "./RequireAuth";

let authState: { user: User | null; loading: boolean };
vi.mock("./AuthContext", () => ({ useAuth: () => authState }));

const user = (isAdmin: boolean) => ({ id: 1, isAdmin }) as User;

function renderAt(guard: "auth" | "admin") {
  const Guard = guard === "auth" ? RequireAuth : RequireAdmin;
  return render(
    <MemoryRouter initialEntries={["/secret"]}>
      <Routes>
        <Route path="/login" element={<div>login page</div>} />
        <Route path="/" element={<div>home page</div>} />
        <Route path="/secret" element={<Guard><div>secret content</div></Guard>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  authState = { user: null, loading: false };
});

describe("RequireAuth", () => {
  it("redirects anonymous visitors to /login", () => {
    renderAt("auth");
    expect(screen.getByText("login page")).toBeInTheDocument();
  });
  it("shows the content to a logged-in user", () => {
    authState = { user: user(false), loading: false };
    renderAt("auth");
    expect(screen.getByText("secret content")).toBeInTheDocument();
  });
  it("neither redirects nor shows content while the session is loading", () => {
    authState = { user: null, loading: true };
    renderAt("auth");
    expect(screen.queryByText("login page")).not.toBeInTheDocument();
    expect(screen.queryByText("secret content")).not.toBeInTheDocument();
  });
});

describe("RequireAdmin", () => {
  it("redirects anonymous visitors to /login", () => {
    renderAt("admin");
    expect(screen.getByText("login page")).toBeInTheDocument();
  });
  it("sends a non-admin user home", () => {
    authState = { user: user(false), loading: false };
    renderAt("admin");
    expect(screen.getByText("home page")).toBeInTheDocument();
  });
  it("shows the content to an admin", () => {
    authState = { user: user(true), loading: false };
    renderAt("admin");
    expect(screen.getByText("secret content")).toBeInTheDocument();
  });
});

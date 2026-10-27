import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../api/client";
import { Login } from "./Login";

const login = vi.fn();
vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ login }) }));

function renderLogin(state?: { message: string }) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/login", state }]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<div>home page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function submit(name: string, password: string) {
  fireEvent.change(screen.getByLabelText("Name or email"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Log in" }));
}

beforeEach(() => {
  login.mockReset();
});

describe("Login", () => {
  it("logs in with the entered credentials and goes home", async () => {
    login.mockResolvedValue(undefined);
    renderLogin();
    submit("Robert", "secret123");
    await waitFor(() => expect(screen.getByText("home page")).toBeInTheDocument());
    expect(login).toHaveBeenCalledWith("Robert", "secret123");
  });

  it("shows the server's message when the login is rejected, and stays on the page", async () => {
    login.mockRejectedValue(new ApiClientError(401, "Invalid credentials"));
    renderLogin();
    submit("Robert", "wrong");
    expect(await screen.findByText("Invalid credentials")).toBeInTheDocument();
    expect(screen.queryByText("home page")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log in" })).toBeEnabled();
  });

  it("falls back to a generic message for non-API errors", async () => {
    login.mockRejectedValue(new Error("boom"));
    renderLogin();
    submit("Robert", "x");
    expect(await screen.findByText("Login failed")).toBeInTheDocument();
  });

  it("disables the button while the request is in flight", async () => {
    let resolve!: () => void;
    login.mockReturnValue(new Promise<void>((r) => (resolve = r)));
    renderLogin();
    submit("Robert", "x");
    expect(await screen.findByRole("button", { name: "Logging in..." })).toBeDisabled();
    resolve();
    await waitFor(() => expect(screen.getByText("home page")).toBeInTheDocument());
  });

  it("shows a message passed along by the previous page, such as after a password reset", () => {
    renderLogin({ message: "Password updated" });
    expect(screen.getByText("Password updated")).toBeInTheDocument();
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, getAuthToken, setAuthToken } from "../api/client";
import * as endpoints from "../api/endpoints";
import { ResetPassword } from "./ResetPassword";

vi.mock("../api/endpoints");

const refresh = vi.fn();
vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ refresh }) }));

function renderPage(path = "/reset/abc") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/reset/:token" element={<ResetPassword />} />
        <Route path="/reset" element={<ResetPassword />} />
        <Route path="/" element={<div>home page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function fill(password: string, confirm = password) {
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: confirm } });
}

beforeEach(() => {
  vi.resetAllMocks();
  setAuthToken(null);
  vi.mocked(endpoints.getPasswordResetStatus).mockResolvedValue({ valid: true });
});

describe("ResetPassword", () => {
  it("only shows the form once the link has been validated", async () => {
    renderPage();
    expect(await screen.findByText("Set a new password")).toBeInTheDocument();
    expect(endpoints.getPasswordResetStatus).toHaveBeenCalledWith("abc");
  });

  it("explains why a link is unusable", async () => {
    vi.mocked(endpoints.getPasswordResetStatus).mockRejectedValue(new ApiClientError(410, "This link has expired"));
    renderPage();
    expect(await screen.findByText("Reset link not available")).toBeInTheDocument();
    expect(screen.getByText("This link has expired")).toBeInTheDocument();
  });

  it("rejects a link without a token without asking the server", () => {
    renderPage("/reset");
    expect(screen.getByText("This reset link is missing its token.")).toBeInTheDocument();
    expect(endpoints.getPasswordResetStatus).not.toHaveBeenCalled();
  });

  it("sets the password, signs the user in and goes home", async () => {
    vi.mocked(endpoints.resetPassword).mockResolvedValue({ token: "session", user: {} as never });
    renderPage();
    await screen.findByText("Set a new password");
    fill("newpassword1");
    fireEvent.click(screen.getByRole("button", { name: "Set new password" }));

    expect(await screen.findByText("home page")).toBeInTheDocument();
    expect(endpoints.resetPassword).toHaveBeenCalledWith("abc", "newpassword1");
    expect(getAuthToken()).toBe("session");
    expect(refresh).toHaveBeenCalled();
  });

  it("refuses mismatched passwords without calling the server", async () => {
    renderPage();
    await screen.findByText("Set a new password");
    fill("newpassword1", "newpassword2");
    fireEvent.click(screen.getByRole("button", { name: "Set new password" }));
    expect(await screen.findByText("Passwords don't match")).toBeInTheDocument();
    expect(endpoints.resetPassword).not.toHaveBeenCalled();
  });

  it("shows the server's error, e.g. a link used in the meantime", async () => {
    vi.mocked(endpoints.resetPassword).mockRejectedValue(new ApiClientError(410, "Link already used"));
    renderPage();
    await screen.findByText("Set a new password");
    fill("newpassword1");
    fireEvent.click(screen.getByRole("button", { name: "Set new password" }));
    expect(await screen.findByText("Link already used")).toBeInTheDocument();
    expect(getAuthToken()).toBeNull();
  });
});

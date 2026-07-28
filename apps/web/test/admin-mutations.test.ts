import { ApiClientError } from "@unimatrix/api-client";
import { describe, expect, it } from "vitest";

import { describeAffected, describeAdminError } from "@/features/admin/mutations";

describe("describeAdminError", () => {
  it("names the session as the problem for a 401 and the role for a 403", () => {
    // These two are the failures an admin will actually hit, and the API's own
    // message for them is about HTTP rather than about what to do next.
    expect(describeAdminError(new ApiClientError("Unauthorized", { status: 401 }))).toMatch(
      /session has expired/u,
    );
    expect(describeAdminError(new ApiClientError("Forbidden", { status: 403 }))).toMatch(
      /admin access/u,
    );
  });

  it("prefers the API's message for a validation failure", () => {
    // A slug collision and an over-long body are both 400s; "that failed"
    // would leave the admin guessing which.
    const error = new ApiClientError("A blog entry with that slug already exists.", {
      status: 400,
    });

    expect(describeAdminError(error)).toBe("A blog entry with that slug already exists.");
  });

  it("falls back to the status when the API sent no message", () => {
    expect(describeAdminError(new ApiClientError("", { status: 500 }))).toBe(
      "The request failed (500).",
    );
  });

  it("describes a transport failure as one", () => {
    expect(describeAdminError(new TypeError("Failed to fetch"))).toMatch(/could not be sent/u);
    expect(describeAdminError("not an error at all")).toMatch(/could not be sent/u);
  });
});

describe("describeAffected", () => {
  it("agrees in number so '1 posts' never appears", () => {
    expect(describeAffected(1, "published")).toBe("1 post published.");
    expect(describeAffected(3, "published")).toBe("3 posts published.");
  });

  it("words each publication state as the verb that was applied", () => {
    expect(describeAffected(2, "draft")).toBe("2 posts moved to drafts.");
    expect(describeAffected(2, "archived")).toBe("2 posts archived.");
  });

  it("reports zero rather than claiming success", () => {
    // The API answers with what it actually touched, and a selection whose
    // rows were already in the target state affects none of them.
    expect(describeAffected(0, "published")).toBe("0 posts published.");
  });
});

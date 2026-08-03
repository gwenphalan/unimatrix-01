import { render, screen } from "@testing-library/react";
import { RiArticleLine } from "@remixicon/react";
import { describe, expect, it } from "vitest";

import { NotBuiltPlaceholder } from "../src/features/sections/not-built-placeholder.js";

describe("NotBuiltPlaceholder", () => {
  it("names the section in its not-built-yet message", () => {
    render(<NotBuiltPlaceholder icon={RiArticleLine} label="Content" />);

    expect(screen.getByText("Content has not been built yet.")).toBeInTheDocument();
  });
});

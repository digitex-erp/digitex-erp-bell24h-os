// Vitest setup: adds jest-dom's DOM matchers (toBeInTheDocument, etc.) and
// resets the testing-library DOM between tests. No other global mocking
// lives here -- each test file mocks its own network boundary explicitly.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

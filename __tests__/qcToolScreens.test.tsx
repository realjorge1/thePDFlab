/**
 * Component tests for the QC calculator screens:
 *  - input validation blocks Calculate (no results, inline error),
 *  - Recording Results → Quantifying Errors handoff via route params,
 *  - the `null` critical-N "not attainable" empty state.
 *
 * Rendered without the app shell; theme, router, clipboard and the saved-run
 * store are mocked so the tests stay hermetic and fully offline.
 */
import { CriticalNTool } from "@/components/qc/tools/CriticalNTool";
import { RRRecordTool } from "@/components/qc/tools/RRRecordTool";
import { SixSigmaTool } from "@/components/qc/tools/SixSigmaTool";
import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";

// jest.mock calls are hoisted above the imports; `mockPush` is only
// dereferenced when useRouter() is called during render, so this is safe.
const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn().mockResolvedValue(true),
}));

jest.mock("@/services/qcCalcHistoryService", () => ({
  getSavedRuns: jest.fn().mockResolvedValue([]),
  saveRun: jest.fn(),
  deleteRun: jest.fn(),
}));

// Gozlin Insights deps — mocked so the screens stay hermetic and offline.
jest.mock("@/context/SubscriptionContext", () => ({
  useSubscription: () => ({ isPremium: false, isLoading: false }),
}));

jest.mock("@/services/ai/ai.service", () => ({
  sendChat: jest.fn().mockResolvedValue({ content: "" }),
}));

jest.mock("@/utils/sanitizeAiText", () => ({
  deepStripMarkdown: (s: string) => s,
}));

jest.mock("@/services/ThemeProvider", () => ({
  useTheme: () => ({
    mode: "light" as const,
    colors: {
      primary: "#4F46E5",
      primaryDark: "#4338CA",
      primaryLight: "#818CF8",
      secondary: "#8B5CF6",
      accent: "#06B6D4",
      background: "#F8FAFC",
      backgroundSecondary: "#F1F5F9",
      card: "#FFFFFF",
      surface: "#FFFFFF",
      text: "#0F172A",
      textSecondary: "#64748B",
      textTertiary: "#94A3B8",
      textInverse: "#FFFFFF",
      border: "#E2E8F0",
      borderLight: "#F1F5F9",
      success: "#10B981",
      error: "#EF4444",
      warning: "#F59E0B",
      info: "#3B82F6",
      tabBar: "#FFFFFF",
      tabBarBorder: "#E2E8F0",
      tabActive: "#4F46E5",
      tabInactive: "#64748B",
      settingsBg: "#F1F5F9",
      sectionHeader: "#64748B",
      rowBg: "#FFFFFF",
      separator: "#E2E8F0",
      comingSoonBadge: "#EEF2FF",
      comingSoonText: "#6366F1",
    },
  }),
}));

beforeEach(() => {
  mockPush.mockClear();
});

describe("SixSigmaTool — validation blocks Calculate", () => {
  test("shows inline errors and no results for invalid input", async () => {
    render(<SixSigmaTool />);
    await screen.findByText("Nothing saved yet.");

    fireEvent.changeText(
      screen.getByLabelText("Total allowable error (TEa)"),
      "10",
    );
    fireEvent.changeText(screen.getByLabelText("Bias"), "2");
    fireEvent.changeText(
      screen.getByLabelText("Coefficient of variation (CV)"),
      "0",
    );
    fireEvent.press(screen.getByText("Calculate"));

    expect(screen.getByText("CV must be greater than 0.")).toBeTruthy();
    expect(screen.queryByText("Sigma metric")).toBeNull();
  });

  test("calculates once the inputs are valid", async () => {
    render(<SixSigmaTool />);
    await screen.findByText("Nothing saved yet.");

    fireEvent.changeText(
      screen.getByLabelText("Total allowable error (TEa)"),
      "10",
    );
    fireEvent.changeText(screen.getByLabelText("Bias"), "2");
    fireEvent.changeText(
      screen.getByLabelText("Coefficient of variation (CV)"),
      "1.5",
    );
    fireEvent.press(screen.getByText("Calculate"));

    expect(screen.getByText("Sigma metric")).toBeTruthy();
    expect(screen.getByText("5.33")).toBeTruthy();
    expect(screen.getByText(/Excellent/)).toBeTruthy();
  });
});

describe("CriticalNTool — null critical-N empty state", () => {
  test("shows 'Not attainable' when observed SD ≥ allowable SD", async () => {
    render(<CriticalNTool />);
    await screen.findByText("Nothing saved yet.");

    fireEvent.changeText(screen.getByLabelText("Observed SD"), "3");
    fireEvent.changeText(screen.getByLabelText("Allowable SD"), "3");
    fireEvent.press(screen.getByText("Calculate"));

    // The panel shows the "Not attainable" verdict and a dash for the value.
    expect(screen.getByText("Not attainable")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
  });

  test("shows the critical N when attainable", async () => {
    render(<CriticalNTool />);
    await screen.findByText("Nothing saved yet.");

    fireEvent.changeText(screen.getByLabelText("Observed SD"), "2");
    fireEvent.changeText(screen.getByLabelText("Allowable SD"), "3");
    fireEvent.press(screen.getByText("Calculate"));

    expect(screen.getByText("Critical N")).toBeTruthy();
    expect(screen.getByText("10")).toBeTruthy();
  });
});

describe("RRRecordTool — handoff to Quantifying Errors", () => {
  test("sends {assigned, measured} pairs via route params", async () => {
    render(<RRRecordTool />);
    await screen.findByText("Nothing saved yet.");

    fireEvent.changeText(
      screen.getByLabelText("Assigned value (level 1)"),
      "10",
    );
    fireEvent.changeText(
      screen.getByLabelText("Replicates (level 1)"),
      "10.1, 9.9",
    );
    fireEvent.changeText(
      screen.getByLabelText("Assigned value (level 2)"),
      "100",
    );
    fireEvent.changeText(
      screen.getByLabelText("Replicates (level 2)"),
      "99, 101",
    );
    fireEvent.changeText(
      screen.getByLabelText("Assigned value (level 3)"),
      "200",
    );
    fireEvent.changeText(
      screen.getByLabelText("Replicates (level 3)"),
      "201 199",
    );
    fireEvent.press(screen.getByText("Calculate"));
    fireEvent.press(screen.getByText("Send to Quantifying Errors"));

    expect(mockPush).toHaveBeenCalledTimes(1);
    const arg = mockPush.mock.calls[0][0] as {
      pathname: string;
      params: { tool: string; pairs: string };
    };
    expect(arg.pathname).toBe("/qc-calculators/[tool]");
    expect(arg.params.tool).toBe("rr-quantify");
    const pairs = JSON.parse(arg.params.pairs) as {
      assigned: number;
      measured: number;
    }[];
    expect(pairs).toHaveLength(3);
    expect(pairs[0].assigned).toBe(10);
    expect(pairs[0].measured).toBeCloseTo(10, 6);
    expect(pairs[1].measured).toBeCloseTo(100, 6);
    expect(pairs[2].measured).toBeCloseTo(200, 6);
  });
});

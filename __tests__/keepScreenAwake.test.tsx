/**
 * keepScreenAwake.test.tsx
 * The wake lock must follow the toggle and, above all, must never outlive the
 * viewer that asked for it — a lock left behind keeps the user's screen on for
 * the rest of the session.
 */

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// ThreeDotsMenu pulls its design tokens through the document-manager barrel,
// which reaches react-native-pdf and its native event emitters. The menu never
// renders a PDF, so a stub is enough to keep the barrel importable under Jest.
jest.mock("react-native-pdf", () => "Pdf");

const mockActivate = jest.fn((tag?: string) => Promise.resolve(tag));
const mockDeactivate = jest.fn((tag?: string) => Promise.resolve(tag));
const mockIsAvailable = jest.fn(() => Promise.resolve(true));

jest.mock("expo-keep-awake", () => ({
  activateKeepAwakeAsync: (tag?: string) => mockActivate(tag),
  deactivateKeepAwake: (tag?: string) => mockDeactivate(tag),
  isAvailableAsync: () => mockIsAvailable(),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import { Dimensions, StyleSheet } from "react-native";

import { ThreeDotsMenu } from "@/components/DocumentViewer/ThreeDotsMenu";
import { useKeepScreenAwake } from "@/hooks/useKeepScreenAwake";
import { LightTheme } from "@/services/document-manager/constants/design-system";

const STORAGE_KEY = "@inscribed/keep_screen_awake";

beforeEach(async () => {
  jest.clearAllMocks();
  mockIsAvailable.mockImplementation(() => Promise.resolve(true));
  await AsyncStorage.clear();
});

describe("useKeepScreenAwake", () => {
  it("starts off and holds no lock", async () => {
    const { result } = renderHook(() => useKeepScreenAwake());
    await waitFor(() => expect(mockIsAvailable).toHaveBeenCalled());

    expect(result.current.enabled).toBe(false);
    expect(mockActivate).not.toHaveBeenCalled();
  });

  it("takes the lock when toggled on and releases it when toggled off", async () => {
    const { result } = renderHook(() => useKeepScreenAwake());
    await waitFor(() => expect(mockIsAvailable).toHaveBeenCalled());

    await act(async () => result.current.toggle());
    expect(result.current.enabled).toBe(true);
    expect(mockActivate).toHaveBeenCalledTimes(1);

    await act(async () => result.current.toggle());
    expect(result.current.enabled).toBe(false);
    expect(mockDeactivate).toHaveBeenCalledTimes(1);
  });

  it("releases the lock when the viewer unmounts", async () => {
    const { result, unmount } = renderHook(() => useKeepScreenAwake());
    await waitFor(() => expect(mockIsAvailable).toHaveBeenCalled());

    await act(async () => result.current.toggle());
    expect(mockActivate).toHaveBeenCalledTimes(1);
    expect(mockDeactivate).not.toHaveBeenCalled();

    unmount();
    expect(mockDeactivate).toHaveBeenCalledTimes(1);
  });

  it("persists the choice and restores it in the next document", async () => {
    const first = renderHook(() => useKeepScreenAwake());
    await waitFor(() => expect(mockIsAvailable).toHaveBeenCalled());
    await act(async () => first.result.current.toggle());
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe("true");
    first.unmount();

    mockActivate.mockClear();
    const second = renderHook(() => useKeepScreenAwake());
    await waitFor(() => expect(second.result.current.enabled).toBe(true));
    expect(mockActivate).toHaveBeenCalledTimes(1);
  });

  it("reports the platform as unsupported and never activates there", async () => {
    mockIsAvailable.mockImplementation(() => Promise.resolve(false));
    const { result } = renderHook(() => useKeepScreenAwake());
    await waitFor(() => expect(result.current.supported).toBe(false));

    await act(async () => result.current.toggle());
    expect(mockActivate).not.toHaveBeenCalled();
  });
});

describe("ThreeDotsMenu — Keep Awake row", () => {
  const baseProps = {
    visible: true,
    onClose: jest.fn(),
    theme: LightTheme,
    onShare: jest.fn(),
    onSearchText: jest.fn(),
    onReadAloud: jest.fn(),
    onChatWithFile: jest.fn(),
    onEditFile: jest.fn(),
    onDelete: jest.fn(),
    onStar: jest.fn(),
    isStarred: false,
    fileType: "pdf" as const,
  };

  it("is absent when the platform cannot keep the screen awake", () => {
    render(<ThreeDotsMenu {...baseProps} />);
    expect(screen.queryByText("Keep Awake")).toBeNull();
  });

  it("keeps the whole menu on screen at its longest", () => {
    // Every row the PDF viewer can show, which is the tallest the menu gets.
    render(
      <ThreeDotsMenu
        {...baseProps}
        onAnalyze={jest.fn()}
        onLockFile={jest.fn()}
        onSavePage={jest.fn()}
        onToggleKeepAwake={jest.fn()}
      />,
    );

    // Nothing was dropped to make it fit.
    expect(screen.getAllByRole("button")).toHaveLength(10);
    expect(screen.getByRole("switch")).toBeTruthy();

    // And the card cannot spill past the bottom of the screen.
    const card = screen.getByTestId("three-dots-menu-card");
    const { maxHeight } = StyleSheet.flatten(card.props.style);
    expect(maxHeight).toBeLessThan(Dimensions.get("window").height);
  });

  it("reports its state as a switch", () => {
    const { rerender } = render(
      <ThreeDotsMenu {...baseProps} onToggleKeepAwake={jest.fn()} isKeepAwake={false} />,
    );
    const row = screen.getByRole("switch", { name: "Keep Awake" });
    expect(row.props.accessibilityState.checked).toBe(false);

    rerender(
      <ThreeDotsMenu {...baseProps} onToggleKeepAwake={jest.fn()} isKeepAwake />,
    );
    expect(
      screen.getByRole("switch", { name: "Keep Awake" }).props
        .accessibilityState.checked,
    ).toBe(true);
  });
});

// ============================================
// Haptics — globally disabled
// --------------------------------------------
// The app keeps every animation, but all vibration / haptic feedback is
// switched off here. This module mirrors the slice of the `expo-haptics` API
// the app uses, except every function is a no-op. Call sites keep importing
// "Haptics" and calling impactAsync / notificationAsync / selectionAsync
// exactly as before — nothing vibrates.
//
// To re-enable vibration app-wide, point these imports back at "expo-haptics".
// ============================================

export enum ImpactFeedbackStyle {
  Light = "light",
  Medium = "medium",
  Heavy = "heavy",
  Soft = "soft",
  Rigid = "rigid",
}

export enum NotificationFeedbackType {
  Success = "success",
  Warning = "warning",
  Error = "error",
}

// All feedback calls resolve immediately and do nothing.
export function impactAsync(_style?: ImpactFeedbackStyle): Promise<void> {
  return Promise.resolve();
}

export function notificationAsync(
  _type?: NotificationFeedbackType,
): Promise<void> {
  return Promise.resolve();
}

export function selectionAsync(): Promise<void> {
  return Promise.resolve();
}

// Synchronous variants, kept as harmless no-ops for any call site that uses them.
export function impact(_style?: ImpactFeedbackStyle): void {}
export function notification(_type?: NotificationFeedbackType): void {}
export function selection(): void {}

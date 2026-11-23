export const DESKTOP_SIDEBAR_KEY = "riskorbit.sidebar-collapsed";
export const MOBILE_MENU_KEY = "riskorbit.mobile-menu-open";
export const COLLAPSED_SIDEBAR_WIDTH = "64px";

type SidebarPreference = typeof DESKTOP_SIDEBAR_KEY | typeof MOBILE_MENU_KEY;

export function readSidebarPreference(key: SidebarPreference): boolean {
  try {
    return window.localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

export function writeSidebarPreference(key: SidebarPreference, value: boolean): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // The menu still works when browser storage is unavailable.
  }
}

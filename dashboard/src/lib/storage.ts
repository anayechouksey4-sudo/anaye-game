import AsyncStorage from '@react-native-async-storage/async-storage';

const LINK_KEY = 'squadhq/link/v1';

export interface LinkPrefs {
  url: string | null;
  /** False after the user pressed Disconnect; true after a Connect. */
  autoConnect: boolean;
}

const EMPTY: LinkPrefs = { url: null, autoConnect: true };

/** Never throws: storage can be unavailable (private browsing, quota, corrupted value). */
export async function loadLinkPrefs(): Promise<LinkPrefs> {
  try {
    const raw = await AsyncStorage.getItem(LINK_KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY;
    const { url, autoConnect } = parsed as Record<string, unknown>;
    return {
      url: typeof url === 'string' && url.length > 0 && url.length < 300 ? url : null,
      autoConnect: typeof autoConnect === 'boolean' ? autoConnect : true,
    };
  } catch {
    return EMPTY;
  }
}

export async function saveLinkPrefs(prefs: LinkPrefs): Promise<void> {
  try {
    await AsyncStorage.setItem(LINK_KEY, JSON.stringify(prefs));
  } catch {
    // Not fatal: the app still works, it just will not remember the address.
  }
}

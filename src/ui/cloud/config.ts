// Firebase web config from the build's env vars. No Firebase import here, so the main chunk can ask "is cloud
// save set up?" without loading the SDK. Missing values mean cloud features stay hidden.

export interface CloudConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

function read(): CloudConfig | null {
  const env = import.meta.env;
  const c = {
    apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
    projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
    appId: env.VITE_FIREBASE_APP_ID as string | undefined,
  };
  return c.apiKey && c.authDomain && c.projectId && c.appId ? (c as CloudConfig) : null;
}

export const cloudConfig: CloudConfig | null = read();

/** Set while signed in, so the next page load knows to load Firebase and restore the session. */
export const SIGNED_IN_KEY = 'knitbit.cloud.signedIn';

export function rememberedSignIn(): boolean {
  try {
    return localStorage.getItem(SIGNED_IN_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberSignIn(on: boolean): void {
  try {
    if (on) localStorage.setItem(SIGNED_IN_KEY, '1');
    else localStorage.removeItem(SIGNED_IN_KEY);
  } catch {
    /* ignore: the next load just shows the Sign in button */
  }
}

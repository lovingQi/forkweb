export function getOpenApiKey(): string {
  return (process.env.FORKWEB_OPEN_API_KEY || '').trim();
}

export function isOpenApiEnabled(): boolean {
  return getOpenApiKey().length > 0;
}

export function getOpenApiUsername(): string {
  return (process.env.FORKWEB_OPEN_API_USERNAME || 'aftersales-ai').trim() || 'aftersales-ai';
}

export function getCallbackUrl(): string {
  return (process.env.FORKWEB_CALLBACK_URL || '').trim();
}

export function getCallbackSecret(): string {
  return (process.env.FORKWEB_CALLBACK_SECRET || '').trim();
}

export function getPublicBaseUrl(): string | null {
  const raw = (process.env.REPLAY_SERVER_BASE_URL || '').trim();
  return raw ? raw.replace(/\/+$/, '') : null;
}

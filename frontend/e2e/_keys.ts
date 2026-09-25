import { expect, type Page } from "@playwright/test";

/** The `.env` variable each seeded provider's key comes from (the driver scripts source `.env`). */
const ENV_OF: Record<string, string> = {
  deepseek: "DEEPSEEK_API_KEY",
  openai: "OPENAI_API_KEY",
};

/**
 * Store this account's own key for each provider, read from the spec's env. New accounts start with
 * no keys, and both the composer's readiness check and the backend's launch pre-flight need a key
 * for every model a team uses — so seed BEFORE creating the team (its nodes default to a held
 * provider's models).
 */
export async function seedProviderKeys(page: Page, providers: string[]): Promise<void> {
  for (const provider of providers) {
    const envName = ENV_OF[provider] ?? "";
    const key = envName ? process.env[envName] : undefined;
    expect(Boolean(key), `${envName || provider} present in the spec env`).toBeTruthy();
    const res = await page.request.post("/api/providers", { data: { provider, api_key: key } });
    expect(res.ok(), `seed the ${provider} key -> ${res.status()}`).toBeTruthy();
  }
}

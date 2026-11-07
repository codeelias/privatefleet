/**
 * Regression for the bodyless-DELETE 400 (2026-11-07): the client must not
 * declare content-type: application/json when there is no body, because the
 * API rejects empty JSON bodies with an instant 400.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureAuth, HttpError, api } from "./client";

const fetchMock = vi.fn();

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
  configureAuth(null);
});

describe("api client header discipline", () => {
  it("omits the JSON content type for bodyless requests", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(okResponse({ ok: true }));

    await api.deleteGeofence("11111111-1111-4111-8111-111111111111");

    const [path, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { headers?: Record<string, string> },
    ];
    expect(path).toBe("/v1/geofences/11111111-1111-4111-8111-111111111111");
    expect(init.headers).toBeDefined();
    expect(init.headers!["content-type"]).toBeUndefined();
  });

  it("still declares JSON for requests that carry a body", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(okResponse({}));

    await api.createTrackingToken("11111111-1111-4111-8111-111111111111");

    const calls = fetchMock.mock.calls as unknown as Array<
      [string, { headers?: Record<string, string> }]
    >;
    const post = calls.find(([p]) => p === "/v1/tracking-tokens");
    expect(post?.[1].headers?.["content-type"]).toBe("application/json");
  });

  it("surfaces the API uiMessage as the error message", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        code: "X",
        uiMessage: "The request was not understood. Refresh and try again.",
      }),
    } as unknown as Response);

    const err = await api
      .deleteGeofence("11111111-1111-4111-8111-111111111111")
      .catch((e: unknown) => e as HttpError);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).message).toBe(
      "The request was not understood. Refresh and try again.",
    );
  });
});

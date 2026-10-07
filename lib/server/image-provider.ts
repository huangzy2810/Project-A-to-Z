// Server-only provider: imported only by the API route and provider tests.
import OpenAI from "openai";
import { EnvHttpProxyAgent, fetch as proxyFetch } from "undici";
export const IMAGE_MODEL = "gpt-image-1.5";
export interface ImageProvider {
  generate(
    prompt: string,
    references: File[],
    signal: AbortSignal,
  ): Promise<{ bytes: Uint8Array; model: string }>;
}
export class ImageGenerationError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
let dispatcher: EnvHttpProxyAgent | undefined;
export function imageApiKey() {
  return process.env.IMAGE_API_KEY || process.env.OPENAI_API_KEY;
}
const networkCodes = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);
function diagnosticCode(error: unknown): string {
  let cause = error;
  for (let i = 0; i < 5 && cause && typeof cause === "object"; i++) {
    const detail = cause as { code?: unknown; cause?: unknown };
    if (typeof detail.code === "string" && networkCodes.has(detail.code))
      return detail.code;
    cause = detail.cause;
  }
  if (error instanceof OpenAI.APIError && error.status)
    return `OPENAI_HTTP_${error.status}`;
  return "IMAGE_TRANSPORT_ERROR";
}
export function createOpenAIProvider(
  apiKey: string,
  transport?: typeof globalThis.fetch,
): ImageProvider {
  const useProxy = Boolean(
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy,
  );
  if (useProxy && !transport) dispatcher ??= new EnvHttpProxyAgent();
  const client = new OpenAI({
    apiKey,
    timeout: 180_000,
    maxRetries: 0,
    fetch:
      transport ||
      (!useProxy
        ? globalThis.fetch
        : (((
            input: Parameters<typeof globalThis.fetch>[0],
            init?: Parameters<typeof globalThis.fetch>[1],
          ) =>
            proxyFetch(
              input as string,
              { ...init, dispatcher } as Parameters<typeof proxyFetch>[1],
            )) as unknown as typeof globalThis.fetch)),
  });
  return {
    async generate(prompt, references, signal) {
      try {
        const options = {
          model: IMAGE_MODEL,
          prompt,
          n: 1 as const,
          size: "1024x1024" as const,
          quality: "high" as const,
          output_format: "png" as const,
        };
        const result = references.length
          ? await client.images.edit(
              { ...options, image: references, input_fidelity: "high" },
              { signal },
            )
          : await client.images.generate(options, { signal });
        const encoded = result.data?.[0]?.b64_json;
        if (
          !encoded ||
          encoded.length > 24 * 1024 * 1024 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
        )
          throw new ImageGenerationError(
            502,
            "The image service returned an unreadable illustration. Your previous images are safe.",
          );
        const bytes = Buffer.from(encoded, "base64");
        if (
          !bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        )
          throw new ImageGenerationError(
            502,
            "The image service returned an unsupported image. Please try again.",
          );
        return { bytes, model: IMAGE_MODEL };
      } catch (error) {
        if (error instanceof ImageGenerationError) throw error;
        const code = diagnosticCode(error);
        // Log only fixed diagnostic codes/statuses, never upstream messages, keys, headers or photos.
        console.error("[image-generation]", {
          code,
          status: error instanceof OpenAI.APIError ? error.status : undefined,
        });
        const failure = (status: number, message: string) =>
          new ImageGenerationError(status, `${message} (Code: ${code})`);
        if (error instanceof OpenAI.APIError) {
          if (error.status === 404)
            throw failure(
              503,
              "The configured image model is unavailable to this API project. Check image-model access.",
            );
          if (error.status === 402)
            throw failure(
              503,
              "OpenAI requires API billing for this image request. Check the API project’s billing.",
            );
          if (error.status && error.status >= 500)
            throw failure(
              502,
              "OpenAI returned a server error. Please try again later. Your previous images are safe.",
            );
          if (error.status === 401)
            throw failure(
              503,
              "The image API credential needs updating in server settings. Your previous images are safe.",
            );
          if (error.status === 403)
            throw failure(
              503,
              "Image generation access is unavailable. Check API model access and any organization verification requirements.",
            );
          if (error.status === 429)
            throw failure(
              429,
              "Image generation is busy or the API quota has been reached. Wait a moment or check your API billing before trying again.",
            );
          if (error.status === 400)
            throw failure(
              422,
              "The image service could not accept this scene or its references. Try a simpler description and valid reference photos.",
            );
        }
        if (signal.aborted || error instanceof OpenAI.APIConnectionTimeoutError)
          throw failure(
            504,
            "Image generation took too long. Your previous images are safe. Please try again.",
          );
        throw failure(
          502,
          "Could not reach the image service. Please try again. Your previous images are safe.",
        );
      }
    },
  };
}

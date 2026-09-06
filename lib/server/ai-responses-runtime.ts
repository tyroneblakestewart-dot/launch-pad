export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
export const VERCEL_AI_GATEWAY_RESPONSES_URL = "https://ai-gateway.vercel.sh/v1/responses";
export const VERCEL_OIDC_HEADER = "x-vercel-oidc-token";

export type AIResponsesRuntime = {
  apiKey: string;
  responsesUrl: string;
  model: string;
  source: "openai" | "vercel-ai-gateway";
};

type AIEnvironment = {
  [key: string]: string | undefined;
  OPENAI_API_KEY?: string;
  OPENAI_VISION_MODEL?: string;
  AI_GATEWAY_API_KEY?: string;
  AI_GATEWAY_MODEL?: string;
  OPENAI_BESPOKE_PAGE_MODEL?: string;
  VERCEL_OIDC_TOKEN?: string;
};

function value(input: string | undefined | null): string {
  return input?.trim() || "";
}

function directOpenAIModel(model: string): string {
  return model.startsWith("openai/") ? model.slice("openai/".length) : model;
}

function gatewayModel(model: string): string {
  return model.includes("/") ? model : `openai/${model}`;
}

/**
 * The model for the bespoke full-page stage only (owner decision, 6 Sep 2026:
 * full gpt-5 for the paid site, gpt-5-mini everywhere else). Artwork analysis,
 * inspiration inspection and every Social Studio call keep the runtime's model.
 */
export const DEFAULT_BESPOKE_PAGE_MODEL = "gpt-5";

export function resolveBespokePageModel(
  environment: AIEnvironment = process.env,
  runtime: Pick<AIResponsesRuntime, "source">,
): string {
  const configured = value(environment.OPENAI_BESPOKE_PAGE_MODEL) || DEFAULT_BESPOKE_PAGE_MODEL;
  return runtime.source === "openai" ? directOpenAIModel(configured) : gatewayModel(configured);
}

export function getVercelOidcToken(request: Request): string {
  return value(request.headers.get(VERCEL_OIDC_HEADER));
}

export function resolveAIResponsesRuntime(
  environment: AIEnvironment = process.env,
  requestOidcToken = "",
): AIResponsesRuntime | null {
  const configuredModel = value(environment.OPENAI_VISION_MODEL) || "gpt-5-mini";
  const openAIKey = value(environment.OPENAI_API_KEY);

  if (openAIKey) {
    return {
      apiKey: openAIKey,
      responsesUrl: OPENAI_RESPONSES_URL,
      model: directOpenAIModel(configuredModel),
      source: "openai",
    };
  }

  const gatewayKey =
    value(environment.AI_GATEWAY_API_KEY) ||
    value(environment.VERCEL_OIDC_TOKEN) ||
    value(requestOidcToken);
  if (!gatewayKey) return null;

  const configuredGatewayModel = value(environment.AI_GATEWAY_MODEL);
  return {
    apiKey: gatewayKey,
    responsesUrl: VERCEL_AI_GATEWAY_RESPONSES_URL,
    model: configuredGatewayModel || gatewayModel(configuredModel),
    source: "vercel-ai-gateway",
  };
}

export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
export const VERCEL_AI_GATEWAY_RESPONSES_URL = "https://ai-gateway.vercel.sh/v1/responses";

export type AIResponsesRuntime = {
  apiKey: string;
  responsesUrl: string;
  model: string;
  source: "openai" | "vercel-ai-gateway";
};

type AIEnvironment = Pick<
  NodeJS.ProcessEnv,
  | "OPENAI_API_KEY"
  | "OPENAI_VISION_MODEL"
  | "AI_GATEWAY_API_KEY"
  | "AI_GATEWAY_MODEL"
  | "VERCEL_OIDC_TOKEN"
>;

function value(input: string | undefined): string {
  return input?.trim() || "";
}

function directOpenAIModel(model: string): string {
  return model.startsWith("openai/") ? model.slice("openai/".length) : model;
}

function gatewayModel(model: string): string {
  return model.includes("/") ? model : `openai/${model}`;
}

export function resolveAIResponsesRuntime(
  environment: AIEnvironment = process.env,
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
    value(environment.AI_GATEWAY_API_KEY) || value(environment.VERCEL_OIDC_TOKEN);
  if (!gatewayKey) return null;

  const configuredGatewayModel = value(environment.AI_GATEWAY_MODEL);
  return {
    apiKey: gatewayKey,
    responsesUrl: VERCEL_AI_GATEWAY_RESPONSES_URL,
    model: configuredGatewayModel || gatewayModel(configuredModel),
    source: "vercel-ai-gateway",
  };
}

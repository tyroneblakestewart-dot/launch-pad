// Shared between the client studio component and the server-only OAuth
// route handlers (issue #246) — this file must stay free of server-only
// imports (crypto, env secrets) since it is bundled into the client.
export const OAUTH_RESULT_MESSAGE_TYPE = "hoodlums:oauth-result";

export type TwitterOAuthResultMessage =
  | { type: typeof OAUTH_RESULT_MESSAGE_TYPE; provider: "twitter"; ok: true; handle: string }
  | { type: typeof OAUTH_RESULT_MESSAGE_TYPE; provider: "twitter"; ok: false; error: string };

export type TelegramWidgetUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

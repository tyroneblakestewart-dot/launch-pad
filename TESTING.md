# Hoodlums.dev testing policy

Run the complete automated suite with:

```bash
npm test
```

## Current backend coverage

The Vitest suite covers every current server endpoint and its extracted server helpers:

- `POST /api/generate-site-style`
- `POST /api/social/telegram`
- `GET /api/dexscreener-pair`

External OpenAI, Telegram and Dexscreener requests are mocked. Tests do not use production credentials, publish real messages, spend funds, call wallets or alter real data. The project currently has no database; browser storage and blockchain flows are outside this server test suite.

## Required definition of done

For every feature or bug fix:

1. Add or update tests for the changed behaviour.
2. Cover the valid path, invalid or missing input, expected status/error responses and relevant edge cases.
3. Test authorization failures whenever a route is protected.
4. Run `npm test` and keep the entire existing suite green.
5. Never merge or report work as complete while any test is failing.

GitHub Actions enforces this policy through `.github/workflows/test.yml` on every push and pull request.

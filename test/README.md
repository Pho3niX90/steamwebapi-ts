# Tests

## Unit tests (default)

```bash
npm test
```

Mocked unit tests in `steam.unit.test.ts` run without a Steam API key and enforce 100% coverage on `src/`.

## Live integration tests

Requires `STEAM_API_KEY` in the environment (or a `.env` file). When the key is missing, `api.test.ts` is skipped automatically.

```bash
STEAM_API_KEY=your_key npm test
```

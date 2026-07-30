# AGENTS.md

## 1. Core Behaviors & Patterns
- **Contract-first typing**: Contracts live in `src/contracts` and are defined through helpers such as `defineApiContract(...)`. Consumers derive response types from the contract instead of duplicating them.
- **Schema pairing**: Each shared contract pairs with a Zod schema in `src/schemas`, then exports typed outputs such as `HealthResponse`. Keep schemas and contract types aligned so server and client code validate against the same shape.
- **Framework-agnostic boundary**: Keep this package free of transport code, UI code, and content-loading behavior. It should remain pure TypeScript and Zod so any workspace can consume it.

## 2. Conventions
- **Naming**: Use `*Schema` for Zod schemas, `*Contract` for contract definitions, and descriptive `Api*` prefixes for shared HTTP abstractions.
- **Structure**: Add new shared concerns under `src/contracts` or `src/schemas` with barrel exports, rather than flattening everything into `src/index.ts`.


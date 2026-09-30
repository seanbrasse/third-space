# Supabase provider roadmap

The local build runs without Supabase credentials. `schema-blueprint.sql` is an unexecuted target schema, not a validated migration. No cloud resource was provisioned. Google sign-in remains unavailable until its provider is configured and an authenticated production repository replaces the local provider.

When proceeding:

1. Discover installed CLI commands using `supabase --help` and the specific command's `--help`; start a local Supabase stack.
2. Run `supabase migration new third_space_initial`, copy and review the blueprint into the CLI-generated migration, and replay it against an empty database.
3. Implement verified Supabase identity cookies and Google OAuth with exact redirect origins; anonymous sign-in supplies guests, whose auth role alone grants no home access. Room creation requires a verified account.
4. Replace LocalStore with a PostgreSQL repository. Serialize invite redemption, quota update, grant insertion, ticket consumption, board revision checks, and the enforcement outbox transactionally. Replace local scrypt PIN hashing with Argon2id as the spec requires.
5. Validate RLS as anonymous, member, unrelated member, owner, and service worker. Run advisors; check ordinary users cannot call credential administration or change membership/ownership. The private helper accepts only a home locator and obtains its subject from verified `auth.uid()`.
6. Implement durable enforcement outbox delivery and independent media revocation before claiming production removal. Keep service credentials server-only. Set explicit Data API grants separately from RLS.

Current Supabase [RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security) and [changelog](https://supabase.com/changelog) were checked on September 30, 2026. Recent changes include explicit Data API table exposure; the blueprint explicitly grants only required public read access and leaves all writes on the server. The September [PostgreSQL update](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes) concerns extension/operator changes; this schema uses neither affected extension features nor Realtime schema changes.

The blueprint is intentionally not represented as a completed migration: PostgreSQL execution, advisors, and production auth integration still require an actual local Supabase stack.

/**
 * Test-only module augmentation.
 *
 * Demonstrates (and enables) the pattern consumers use to register a
 * custom provider id with the type system: augment `ProviderIdRegistry`
 * so `ProviderId` includes it. Without this, `register()`/
 * `getProviderInstance()` would reject these fixture ids at compile time.
 *
 * Imported for side effects only — see tests/registry.test.ts,
 * tests/factory.test.ts, tests/integration.test.ts.
 */
declare module "../../src/providerType" {
  interface ProviderIdRegistry {
    "my-custom-llm": true;
    "my-instance-llm": true;
    "no-auth-llm": true;
    "auth-llm": true;
    "auth-llm-missing-key": true;
    "async-auth-llm": true;
    "integration-dummy": true;
    "overwrite-llm": true;
    "auth-required-llm": true;
    "local-only-llm": true;
    "convenience-fn-llm": true;
  }
}

export {};

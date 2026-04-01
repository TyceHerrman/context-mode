# Test-Driven Development

<tdd_enforcement>
THIS FILE IS MANDATORY. Every agent, every Staff Engineer, every Architect MUST follow this.
If you skip TDD, your work will be REJECTED. There are no exceptions.
Do NOT write implementation code before you have a failing test.
</tdd_enforcement>

> Source: [mattpocock/skills/tdd](https://github.com/mattpocock/skills/tree/main/tdd) — embedded with context-mode enforcement.

## Philosophy

**Core principle**: Tests should verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't.

**Good tests** are integration-style: they exercise real code paths through public APIs. They describe _what_ the system does, not _how_ it does it. A good test reads like a specification — "user can checkout with valid cart" tells you exactly what capability exists. These tests survive refactors because they don't care about internal structure.

**Bad tests** are coupled to implementation. They mock internal collaborators, test private methods, or verify through external means (like querying a database directly instead of using the interface). The warning sign: your test breaks when you refactor, but behavior hasn't changed. If you rename an internal function and tests fail, those tests were testing implementation, not behavior.

## Anti-Pattern: Horizontal Slices

**DO NOT write all tests first, then all implementation.** This is "horizontal slicing" — treating RED as "write all tests" and GREEN as "write all code."

This produces **crap tests**:

- Tests written in bulk test _imagined_ behavior, not _actual_ behavior
- You end up testing the _shape_ of things (data structures, function signatures) rather than user-facing behavior
- Tests become insensitive to real changes — they pass when behavior breaks, fail when behavior is fine
- You outrun your headlights, committing to test structure before understanding the implementation

**Correct approach**: Vertical slices via tracer bullets. One test → one implementation → repeat. Each test responds to what you learned from the previous cycle. Because you just wrote the code, you know exactly what behavior matters and how to verify it.

```
WRONG (horizontal):
  RED:   test1, test2, test3, test4, test5
  GREEN: impl1, impl2, impl3, impl4, impl5

RIGHT (vertical):
  RED→GREEN: test1→impl1
  RED→GREEN: test2→impl2
  RED→GREEN: test3→impl3
  ...
```

## Workflow

### 1. Planning

Before writing any code:

- [ ] Identify what behaviors need to change or be added
- [ ] List the behaviors to test (not implementation steps)
- [ ] Identify opportunities for deep modules (small interface, deep implementation)
- [ ] Design interfaces for testability

**You can't test everything.** Focus testing effort on critical paths and complex logic, not every possible edge case.

### 2. Tracer Bullet

For the first behavior:

```
RED:   Write test for first behavior → test fails
GREEN: Write minimal code to pass → test passes
```

Then refactor:

- [ ] Extract duplication
- [ ] Deepen modules (move complexity behind simple interfaces)
- [ ] Apply SOLID principles where natural
- [ ] Consider what new code reveals about existing code
- [ ] Run tests after each refactor step

**Never refactor while RED.** Get to GREEN first.

### 3. Next Behavior

```
RED:   Write next test → fails
GREEN: Minimal code to pass → passes
```

Refactor again. Repeat until all behaviors are covered.

---

## Good and Bad Tests

### Good Tests (Integration-Style)

```typescript
// GOOD: Tests observable behavior
test("user can checkout with valid cart", async () => {
  const cart = createCart();
  cart.add(product);
  const result = await checkout(cart, paymentMethod);
  expect(result.status).toBe("confirmed");
});
```

Characteristics:

- Tests behavior users/callers care about
- Uses public API only
- Survives internal refactors
- Describes WHAT, not HOW
- One logical assertion per test

### Bad Tests (Implementation-Coupled)

```typescript
// BAD: Tests implementation details
test("checkout calls paymentService.process", async () => {
  const mockPayment = jest.mock(paymentService);
  await checkout(cart, payment);
  expect(mockPayment.process).toHaveBeenCalledWith(cart.total);
});
```

Red flags:

- Mocking internal collaborators
- Testing private methods
- Asserting on call counts/order
- Test breaks when refactoring without behavior change
- Test name describes HOW not WHAT
- Verifying through external means instead of interface

```typescript
// BAD: Bypasses interface to verify
test("createUser saves to database", async () => {
  await createUser({ name: "Alice" });
  const row = await db.query("SELECT * FROM users WHERE name = ?", ["Alice"]);
  expect(row).toBeDefined();
});

// GOOD: Verifies through interface
test("createUser makes user retrievable", async () => {
  const user = await createUser({ name: "Alice" });
  const retrieved = await getUser(user.id);
  expect(retrieved.name).toBe("Alice");
});
```

---

## When to Mock

Mock at **system boundaries** only:

- External APIs (payment, email, etc.)
- Databases (sometimes — prefer test DB)
- Time/randomness
- File system (sometimes)

Don't mock:

- Your own classes/modules
- Internal collaborators
- Anything you control

### Designing for Mockability

**1. Use dependency injection**

Pass external dependencies in rather than creating them internally:

```typescript
// Easy to mock
function processPayment(order, paymentClient) {
  return paymentClient.charge(order.total);
}

// Hard to mock
function processPayment(order) {
  const client = new StripeClient(process.env.STRIPE_KEY);
  return client.charge(order.total);
}
```

**2. Prefer SDK-style interfaces over generic fetchers**

Create specific functions for each external operation instead of one generic function with conditional logic:

```typescript
// GOOD: Each function is independently mockable
const api = {
  getUser: (id) => fetch(`/users/${id}`),
  getOrders: (userId) => fetch(`/users/${userId}/orders`),
  createOrder: (data) => fetch('/orders', { method: 'POST', body: data }),
};

// BAD: Mocking requires conditional logic inside the mock
const api = {
  fetch: (endpoint, options) => fetch(endpoint, options),
};
```

The SDK approach means:
- Each mock returns one specific shape
- No conditional logic in test setup
- Easier to see which endpoints a test exercises
- Type safety per endpoint

---

## Interface Design for Testability

Good interfaces make testing natural:

1. **Accept dependencies, don't create them**

   ```typescript
   // Testable
   function processOrder(order, paymentGateway) {}

   // Hard to test
   function processOrder(order) {
     const gateway = new StripeGateway();
   }
   ```

2. **Return results, don't produce side effects**

   ```typescript
   // Testable
   function calculateDiscount(cart): Discount {}

   // Hard to test
   function applyDiscount(cart): void {
     cart.total -= discount;
   }
   ```

3. **Small surface area**
   - Fewer methods = fewer tests needed
   - Fewer params = simpler test setup

---

## Deep Modules

From "A Philosophy of Software Design":

**Deep module** = small interface + lots of implementation

```
┌─────────────────────┐
│   Small Interface   │  ← Few methods, simple params
├─────────────────────┤
│                     │
│                     │
│  Deep Implementation│  ← Complex logic hidden
│                     │
│                     │
└─────────────────────┘
```

**Shallow module** = large interface + little implementation (avoid)

```
┌─────────────────────────────────┐
│       Large Interface           │  ← Many methods, complex params
├─────────────────────────────────┤
│  Thin Implementation            │  ← Just passes through
└─────────────────────────────────┘
```

When designing interfaces, ask:

- Can I reduce the number of methods?
- Can I simplify the parameters?
- Can I hide more complexity inside?

---

## Refactor Candidates

After TDD cycle, look for:

- **Duplication** → Extract function/class
- **Long methods** → Break into private helpers (keep tests on public interface)
- **Shallow modules** → Combine or deepen
- **Feature envy** → Move logic to where data lives
- **Primitive obsession** → Introduce value objects
- **Existing code** the new code reveals as problematic

---

## context-mode Specific Rules

### CI Builds Bundles — You Don't

**Do NOT run `npm run build` or `npm run bundle`.** Bundle files (`server.bundle.mjs`, `cli.bundle.mjs`) are generated by GitHub CI automatically. Never create, modify, or push bundle files. You only run:

```bash
npm test              # vitest — validates behavior
npm run typecheck     # tsc --noEmit — validates types
```

That's it. No build. No bundle. CI handles the rest.

### Test Runner

```bash
# Full suite
npm test                    # vitest run

# Watch mode (during development)
npm run test:watch          # vitest

# Specific adapter
npx vitest run tests/adapters/opencode.test.ts

# Core modules
npx vitest run tests/core/

# Pattern matching
npx vitest run -t "detectPlatform"
```

### Test File Organization

**Do NOT create new test files.** Add tests to existing files covering the same domain:

| Area | Test Location | What to Test |
|------|-------------|--------------|
| Adapters | `tests/adapters/{platform}.test.ts` | Hook format, config paths, env detection |
| Detection | `tests/adapters/detect.test.ts` | Platform detection from env vars |
| Client map | `tests/adapters/client-map.test.ts` | MCP clientInfo → platform mapping |
| Routing | `tests/core/routing.test.ts` | Tool routing decisions |
| Search | `tests/core/search.test.ts` | FTS5 search, BM25 ranking |
| Server | `tests/core/server.test.ts` | MCP protocol, tool handlers |
| CLI | `tests/core/cli.test.ts` | CLI commands (setup, doctor) |
| Store | `tests/store.test.ts` | FTS5 indexing, chunking |
| Executor | `tests/executor.test.ts` | Polyglot execution, truncation |
| Security | `tests/security.test.ts` | Sandbox boundaries |
| Hooks | `tests/hooks/*.test.ts` | Hook lifecycle, formatting |
| Session | `tests/session/*.test.ts` | SessionDB, extract, snapshot |
| Plugins | `tests/plugins/*.test.ts` | Platform-specific plugin behavior |

### Test Isolation

Tests must NOT pollute the real home directory:

```typescript
// tests/setup-home.ts is auto-loaded by vitest
// It sets HOME to a temp dir — all tests run in isolation
```

### TDD Enforcement in Subagents

Every Staff Engineer agent MUST include this in their prompt:

```
MANDATORY TDD — your work will be REJECTED without this:
1. Write a failing test FIRST in tests/{dir}/{name}.test.ts
2. Run: npx vitest run tests/{file} — MUST FAIL
3. Write minimal code to pass
4. Run: npx vitest run tests/{file} — MUST PASS
5. Refactor if needed, tests stay green
6. Report RED→GREEN evidence:
   "RED:  test 'detects opencode via env var' — FAIL (expected)"
   "GREEN: added env check in detect.ts — PASS"
   Without this evidence, your PR is auto-rejected.
```

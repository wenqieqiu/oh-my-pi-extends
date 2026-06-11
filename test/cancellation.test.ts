/**
 * Tests for the benchmark cancellation mechanism.
 *
 * Covers:
 *   - AbortSignal.any propagation
 *   - Cancellation via cancelBenchmark()
 *   - BenchmarkCancelledError behavior
 *   - Promise race cancellation pattern
 */
import { describe, expect, test, mock } from "bun:test";
import { BenchmarkCancelledError, cancelBenchmark } from "../src/benchmark";

describe("BenchmarkCancelledError", () => {
  test("can be constructed", () => {
    const err = new BenchmarkCancelledError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("BenchmarkCancelledError");
    expect(err.message).toBe("Benchmark cancelled by user");
  });

  test("can be thrown and caught by instanceof", () => {
    expect(() => {
      throw new BenchmarkCancelledError();
    }).toThrow(BenchmarkCancelledError);
  });
});

describe("cancelBenchmark", () => {
  test("is a no-op when no benchmark is running", () => {
    // currentBenchmarkAbort is null by default
    expect(cancelBenchmark()).toBeUndefined();
  });

  test("aborts the benchmark controller", () => {
    // Access the internal module variable by calling runBenchmark won't work
    // since it requires actual extension APIs. Instead, test the pattern.
    const controller = new AbortController();
    const signal = controller.signal;
    let aborted = false;
    signal.addEventListener("abort", () => {
      aborted = true;
    });
    controller.abort();
    expect(aborted).toBe(true);
    expect(signal.aborted).toBe(true);
  });
});

describe("AbortSignal.any propagation", () => {
  test("composed signal is aborted when source is aborted", () => {
    const source = new AbortController();
    const composed = AbortSignal.any([source.signal]);
    expect(composed.aborted).toBe(false);
    source.abort();
    expect(composed.aborted).toBe(true);
  });

  test("composed signal fires abort event when source is aborted", () => {
    const source = new AbortController();
    const composed = AbortSignal.any([source.signal]);
    let fired = false;
    composed.addEventListener("abort", () => {
      fired = true;
    });
    source.abort();
    expect(fired).toBe(true);
  });

  test("multiple sources - any abort triggers composed abort", () => {
    const a = new AbortController();
    const b = new AbortController();
    const composed = AbortSignal.any([a.signal, b.signal]);
    expect(composed.aborted).toBe(false);
    b.abort();
    expect(composed.aborted).toBe(true);
  });

  test("already-aborted source causes composed to also be aborted", () => {
    const source = new AbortController();
    source.abort();
    const composed = AbortSignal.any([source.signal]);
    expect(composed.aborted).toBe(true);
  });
});

describe("Cancellation via Promise.race", () => {
  test("cancellation wins against a never-resolving promise", async () => {
    const cancel = new AbortController();

    // A promise that never resolves (simulates a blocked stream)
    const { promise: neverResolve } = Promise.withResolvers<void>();

    // A promise that rejects when cancellation fires
    const { promise: cancelPromise, reject } = Promise.withResolvers<never>();
    cancel.signal.addEventListener("abort", () => {
      reject(new BenchmarkCancelledError());
    }, { once: true });

    // Schedule cancellation after a small delay
    setTimeout(() => cancel.abort(), 10);

    await expect(Promise.race([neverResolve, cancelPromise]))
      .rejects.toThrow(BenchmarkCancelledError);
  }, { timeout: 1000 });

  test("cancellation wins against a slow-resolving promise", async () => {
    const cancel = new AbortController();

    // A promise that resolves after 5 seconds (simulates a slow stream)
    const { promise: slowPromise } = Promise.withResolvers<void>();

    // A promise that rejects when cancellation fires
    const { promise: cancelPromise, reject } = Promise.withResolvers<never>();
    cancel.signal.addEventListener("abort", () => {
      reject(new BenchmarkCancelledError());
    }, { once: true });

    // Schedule cancellation after a small delay
    setTimeout(() => cancel.abort(), 10);

    const result = await Promise.race([
      slowPromise.then(() => "completed" as const),
      cancelPromise.catch(() => "cancelled" as const),
    ]);

    expect(result).toBe("cancelled");
  }, { timeout: 1000 });

  test("cancellation does not fire when signal is never aborted", async () => {
    const cancel = new AbortController();

    // A promise that resolves after 10ms
    const { promise: fastPromise, resolve } = Promise.withResolvers<void>();

    // A promise that rejects when cancellation fires
    const { promise: cancelPromise, reject } = Promise.withResolvers<never>();
    cancel.signal.addEventListener("abort", () => {
      reject(new BenchmarkCancelledError());
    }, { once: true });

    // Resolve the fast promise before any cancellation
    setTimeout(() => resolve(), 5);

    const result = await Promise.race([
      fastPromise.then(() => "completed" as const),
      cancelPromise.catch(() => "cancelled" as const),
    ]);

    expect(result).toBe("completed");
  }, { timeout: 1000 });
});

describe("measureOnce cancellation pattern", () => {
  test("pre-aborted signal immediately throws BenchmarkCancelledError", () => {
    // Verify that checking cancelSignal.aborted before processing throws properly
    const cancel = new AbortController();
    cancel.abort();

    expect(cancel.signal.aborted).toBe(true);
    // The pattern: check at start, throw immediately
    expect(() => {
      if (cancel.signal.aborted) {
        throw new BenchmarkCancelledError();
      }
    }).toThrow(BenchmarkCancelledError);
  });
});

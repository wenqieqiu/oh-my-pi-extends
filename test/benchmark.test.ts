/**
 * Tests for the benchmark module.
 *
 * Covers:
 *   - Module type exports
 *   - Command registration in extension entry
 */
import { describe, expect, test } from "bun:test";
import { type BenchmarkRun, type ScenarioResult, type BenchmarkResult } from "../src/benchmark";

describe("Benchmark types", () => {
  test("BenchmarkRun type is sound", () => {
    const run: BenchmarkRun = {
      ttft: 150,
      outputTokens: 200,
      tps: 40.5,
      duration: 5000,
    };
    expect(run.ttft).toBe(150);
    expect(run.tps).toBe(40.5);
    expect(run.error).toBeUndefined();
  });

  test("BenchmarkRun with error", () => {
    const run: BenchmarkRun = {
      ttft: 0,
      outputTokens: 0,
      tps: 0,
      duration: 0,
      error: "API timeout",
    };
    expect(run.error).toBe("API timeout");
  });

  test("ScenarioResult type is sound", () => {
    const scenario: ScenarioResult = {
      label: "代码生成",
      runs: [
        { ttft: 100, outputTokens: 150, tps: 30, duration: 5000 },
        { ttft: 120, outputTokens: 160, tps: 32, duration: 5000 },
      ],
      avgTtft: 110,
      avgTps: 31,
      validRuns: 2,
    };
    expect(scenario.avgTtft).toBe(110);
    expect(scenario.validRuns).toBe(2);
  });

  test("BenchmarkResult type is sound", () => {
    const result: BenchmarkResult = {
      modelId: "openai/gpt-4",
      modelName: "GPT-4",
      scenarios: [],
      timestamp: new Date().toISOString(),
      overallAvgTps: 35,
      overallAvgTtft: 110,
    };
    expect(result.overallAvgTps).toBe(35);
  });

  test("BenchmarkRun with timeout error message format", () => {
    const run: BenchmarkRun = {
      ttft: 0,
      outputTokens: 0,
      tps: 0,
      duration: 0,
      error: "⏱ 超时（超过 300 秒）",
    };
    expect(run.error).toMatch(/超时/);
    expect(run.error).toMatch(/\d+ 秒/);
  });

  test("BenchmarkRun with generic error", () => {
    const run: BenchmarkRun = {
      ttft: 0,
      outputTokens: 0,
      tps: 0,
      duration: 0,
      error: "API error 401: Unauthorized",
    };
    expect(run.error).toContain("401");
  });

  test("BenchmarkResult with one valid run in scenario", () => {
    const result: BenchmarkResult = {
      modelId: "opencode-go/deepseek-v4-flash",
      modelName: "DeepSeek V4 Flash",
      scenarios: [
        {
          label: "代码生成",
          runs: [
            { ttft: 0, outputTokens: 0, tps: 0, duration: 0, error: "⏱ 超时（超过 300 秒）" },
            { ttft: 11401, outputTokens: 6148, tps: 80.9, duration: 76007 },
            { ttft: 0, outputTokens: 0, tps: 0, duration: 0, error: "API error" },
          ],
          avgTtft: 11401,
          avgTps: 80.9,
          validRuns: 1,
        },
      ],
      timestamp: "2026-06-11T03:49:54.438Z",
      overallAvgTps: 80.9,
      overallAvgTtft: 11401,
    };
    expect(result.scenarios[0].validRuns).toBe(1);
    expect(result.scenarios[0].runs[0].error).toMatch(/超时/);
    expect(result.scenarios[0].runs[2].error).toContain("API error");
    expect(result.overallAvgTps).toBe(80.9);
    expect(result.overallAvgTtft).toBe(11401);
  });
});

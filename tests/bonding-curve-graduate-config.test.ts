import { describe, expect, it } from "vitest";
import {
  BUY_STEP_ETHER_ENV_VAR,
  CURVE_ADDRESS_ENV_VAR,
  resolveBondingCurveGraduateConfig,
} from "../lib/bonding-curve-graduate-config";

const CURVE_ADDRESS = "0x1234567890123456789012345678901234567890";

describe("resolveBondingCurveGraduateConfig", () => {
  it("resolves the curve address and applies the documented default buy step", () => {
    const config = resolveBondingCurveGraduateConfig({ [CURVE_ADDRESS_ENV_VAR]: CURVE_ADDRESS });
    expect(config.curveAddress).toBe(CURVE_ADDRESS);
    expect(config.buyStepWei).toBe(1_000_000_000_000_000_000n);
  });

  it("throws when the curve address is missing", () => {
    expect(() => resolveBondingCurveGraduateConfig({})).toThrow(
      `Missing required environment variable: ${CURVE_ADDRESS_ENV_VAR}`,
    );
  });

  it("throws when the curve address is not a valid 0x address", () => {
    expect(() =>
      resolveBondingCurveGraduateConfig({ [CURVE_ADDRESS_ENV_VAR]: "not-an-address" }),
    ).toThrow(`${CURVE_ADDRESS_ENV_VAR} must be a valid 0x address`);
  });

  it("respects an overridden buy step", () => {
    const config = resolveBondingCurveGraduateConfig({
      [CURVE_ADDRESS_ENV_VAR]: CURVE_ADDRESS,
      [BUY_STEP_ETHER_ENV_VAR]: "0.25",
    });
    expect(config.buyStepWei).toBe(250_000_000_000_000_000n);
  });

  it("rejects a zero or malformed buy step", () => {
    expect(() =>
      resolveBondingCurveGraduateConfig({
        [CURVE_ADDRESS_ENV_VAR]: CURVE_ADDRESS,
        [BUY_STEP_ETHER_ENV_VAR]: "0",
      }),
    ).toThrow(`${BUY_STEP_ETHER_ENV_VAR} must be greater than zero`);
    expect(() =>
      resolveBondingCurveGraduateConfig({
        [CURVE_ADDRESS_ENV_VAR]: CURVE_ADDRESS,
        [BUY_STEP_ETHER_ENV_VAR]: "not-a-number",
      }),
    ).toThrow(`${BUY_STEP_ETHER_ENV_VAR} must be a decimal amount`);
  });
});

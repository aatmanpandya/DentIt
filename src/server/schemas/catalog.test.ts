import { describe, it, expect } from "vitest";
import { listProcedureCodesQuerySchema } from "./catalog";

// docs/bug-log.md entry 25: z.coerce.boolean() turns the string "false" into true.
describe("listProcedureCodesQuerySchema", () => {
  it("parses active=false as false", () => {
    expect(listProcedureCodesQuerySchema.parse({ active: "false" }).active).toBe(false);
    expect(listProcedureCodesQuerySchema.parse({ active: "true" }).active).toBe(true);
    expect(listProcedureCodesQuerySchema.parse({}).active).toBeUndefined();
  });

  it("rejects anything else", () => {
    expect(listProcedureCodesQuerySchema.safeParse({ active: "yes" }).success).toBe(false);
  });
});

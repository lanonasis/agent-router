import { assertEquals } from "jsr:@std/assert@1";
import { simulatedResult, toStrictSchema } from "./core.ts";

const tool = (approval: "auto" | "notify" | "approve" | "critical") => ({
  name: "write_file",
  description: "Write a file",
  approval,
  parameters: {},
});

Deno.test("tools.md 'approve' and 'critical' tools stop at the approval gate instead of running", () => {
  assertEquals(simulatedResult(tool("approve")).status, "approval_required");
  assertEquals(simulatedResult(tool("critical")).status, "approval_required");
});

Deno.test("tools.md 'auto' and 'notify' tools return a simulated (not executed) result", () => {
  assertEquals(simulatedResult(tool("auto")).status, "simulated");
  assertEquals(simulatedResult(tool("notify")).status, "simulated");
});

Deno.test("optional tool fields become required-but-nullable, defaults are dropped, objects are closed", () => {
  const strict = toStrictSchema({
    type: "object",
    properties: {
      path: { type: "string" },
      overwrite: { type: "boolean", default: false },
      lines: { type: "object", properties: { start: { type: "integer" } } },
    },
    required: ["path"],
  });
  assertEquals(strict.required, ["path", "overwrite", "lines"]);
  assertEquals(strict.additionalProperties, false);
  const props = strict.properties as Record<string, Record<string, unknown>>;
  assertEquals(props.path.type, "string");
  assertEquals(props.overwrite, { type: ["boolean", "null"] });
  assertEquals(props.lines.type, ["object", "null"]);
  assertEquals(props.lines.additionalProperties, false);
  assertEquals(props.lines.required, ["start"]);
});

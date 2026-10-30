import { Effect, Schema } from "effect"
import {
  LLM,
  LLMRequest,
  ToolFailure,
  ToolRuntime,
  toDefinitions,
  tool,
  type ExecutableTool,
  type Tool,
} from "../src/effect.js"
import * as OpenAIChat from "../src/protocols/openai-chat.js"
import { Auth } from "../src/route.js"
import { AI } from "../src/index.js"

const request = LLM.request({
  model: OpenAIChat.route.with({ auth: Auth.bearer("fixture") }).model({ id: "gpt-4o-mini" }),
  prompt: "Use the tool.",
})

const executable = tool({
  description: "Get weather.",
  parameters: Schema.Struct({ city: Schema.String }),
  success: Schema.Struct({ forecast: Schema.String }),
  execute: (input) => Effect.succeed({ forecast: input.city }),
})

const schemaOnly = tool({
  description: "Get weather.",
  parameters: Schema.Struct({ city: Schema.String }),
  success: Schema.Struct({ forecast: Schema.String }),
})

tool({
  description: "Encode success before projection.",
  parameters: Schema.Struct({ city: Schema.String }),
  success: Schema.Struct({ forecast: Schema.NumberFromString }),
  execute: () => Effect.succeed({ forecast: 1 }),
  toModelOutput: ({ id, parameters, output }) => [
    { type: "text", text: `${id}:${parameters.city}:${output.forecast}` },
  ],
})

LLM.stream(request)
LLM.generate(LLMRequest.update(request, { tools: toDefinitions({ schemaOnly }) }))
ToolRuntime.dispatch({ executable }, { type: "tool-call", id: "call_1", name: "executable", input: { city: "Paris" } })

// @ts-expect-error High-level tool orchestration overloads are intentionally not supported.
LLM.stream({ request, tools: { schemaOnly } })

const code = Schema.Struct({ code: Schema.String })

tool({
  description: "Run JavaScript.",
  parameters: code,
  success: Schema.String,
  freeform: { type: "lark", grammar: 'start: "ZZ" /[0-9]{3}/' },
  execute: (input) => Effect.succeed(input.code),
})

AI.tool({
  description: "Run JavaScript.",
  parameters: code,
  freeform: { type: "regex", pattern: "ZZ[0-9]{3}" },
  execute: (input) => input.code,
})

tool({
  description: "Run JavaScript.",
  parameters: Schema.Struct({ code: Schema.Number }),
  success: Schema.String,
  // @ts-expect-error A freeform tool's only parameter must be a string.
  freeform: { type: "text" },
})

AI.tool({
  description: "Run JavaScript.",
  parameters: Schema.Struct({ code: Schema.String, language: Schema.String }),
  // @ts-expect-error A freeform tool takes exactly one parameter.
  freeform: { type: "text" },
  execute: () => undefined,
})

AI.tool({
  description: "Run JavaScript.",
  parameters: Schema.Struct({ code: Schema.optional(Schema.String) }),
  // @ts-expect-error A freeform tool's parameter must be required.
  freeform: { type: "text" },
  execute: () => undefined,
})

const sum = {
  description: "Add two numbers.",
  parameters: Schema.Struct({ a: Schema.Number, b: Schema.Number }),
  success: Schema.Number,
  toModelOutput: ({ output }: { readonly output: number }) => [{ type: "text" as const, text: String(output) }],
  toStructuredOutput: (output: number) => ({ sum: output }),
}

const effectSum: ExecutableTool<typeof sum.parameters, typeof Schema.Number> = tool({
  ...sum,
  execute: ({ a, b }) => Effect.succeed(a + b),
})
const promiseSum: AI.ExecutableTool<typeof sum.parameters, typeof Schema.Number> = AI.tool({
  ...sum,
  execute: async ({ a, b }, { signal }) => (signal.aborted ? 0 : a + b),
})
const effectDeclared: Tool<typeof sum.parameters, typeof Schema.Number> = tool(sum)
const promiseDeclared: AI.Tool<typeof sum.parameters, typeof Schema.Number> = AI.tool(sum)
toDefinitions({ effectSum, promiseSum, effectDeclared, promiseDeclared })

tool({ ...sum, execute: () => new ToolFailure({ message: "No sum." }) })
AI.tool({ ...sum, execute: () => 1 })

// @ts-expect-error The Effect tool's execute returns an Effect.
tool({ ...sum, execute: ({ a, b }) => a + b })
// @ts-expect-error The execute result must match `success`.
tool({ ...sum, execute: () => Effect.succeed("3") })
// @ts-expect-error The execute result must match `success`.
AI.tool({ ...sum, execute: async () => "3" })

const options: AI.ToolOptions<typeof sum.parameters, typeof Schema.Number> = sum
AI.tool({ ...options, execute: ({ a, b }) => a + b })
tool({ ...options, execute: ({ a, b }) => Effect.succeed(a + b) })

const unvalidated = {
  description: "Echo.",
  parameters: Schema.Struct({ text: Schema.String }),
  toModelOutput: ({ output }: { readonly output: unknown }) => [{ type: "text" as const, text: String(output) }],
}
tool({ ...unvalidated, execute: ({ text }) => Effect.succeed({ text }) })
AI.tool({ ...unvalidated, execute: ({ text }) => ({ text }) })

const dynamic = {
  description: "Look something up.",
  jsonSchema: { type: "object" },
  outputSchema: { type: "string" },
}
const effectDynamic: ExecutableTool = tool({ ...dynamic, execute: (params) => Effect.succeed(params) })
const promiseDynamic: AI.ExecutableTool = AI.tool({ ...dynamic, execute: async (params) => params })
const effectDynamicDeclared: Tool = tool(dynamic)
const promiseDynamicDeclared: AI.Tool = AI.tool(dynamic)
toDefinitions({ effectDynamic, promiseDynamic, effectDynamicDeclared, promiseDynamicDeclared })

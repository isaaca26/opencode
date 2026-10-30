import { describe, expect, test } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { LanguageModel, LLM, LLMEvent, toDefinitions, tool } from "../src/effect.js"
import { AI } from "../src/index.js"
import { OpenAIChat } from "../src/protocols/openai-chat.js"
import { TestLLM } from "../src/testing.js"
import { testEffect } from "./lib/effect.js"

const model = LanguageModel.make({ id: "fictional-model", provider: "fixture", route: OpenAIChat.route })
const it = testEffect(TestLLM.testLayer())
const sum = {
  description: "Add two numbers.",
  parameters: Schema.Struct({ a: Schema.Number, b: Schema.Number }),
  success: Schema.Number,
  toModelOutput: ({ output }: { readonly output: number }) => [{ type: "text" as const, text: `sum=${output}` }],
}
const script = [
  TestLLM.toolCalls(
    LLMEvent.toolCall({ id: "call-1", name: "add", input: { a: 2, b: 3 } }),
    LLMEvent.toolCall({ id: "call-2", name: "add", input: { a: -1, b: 0 } }),
  ),
  TestLLM.text("Done.", "text-1"),
]
const expectedResults = [
  expect.objectContaining({ id: "call-1", result: { type: "text", value: "sum=5" } }),
  expect.objectContaining({
    id: "call-2",
    result: {
      type: "error",
      value: expect.stringContaining("Tool returned an invalid value for its success schema"),
    },
  }),
]

describe("tool", () => {
  test("the Promise tool runs in ai.llm.loop with success validation and toModelOutput", async () => {
    const add = AI.tool({ ...sum, execute: async ({ a, b }) => (a < 0 ? "negative" : a + b) as number })
    const ai = AI.make({ clients: TestLLM.testLayer() })
    await ai.run(Effect.flatMap(TestLLM.Test, (client) => client.push(...script)))

    const events = await Array.fromAsync(ai.llm.loop({ model, prompt: "Add.", tools: { add } }))

    expect(events.filter(LLMEvent.is.toolResult)).toEqual(expectedResults)
    await ai.dispose()
  })

  it.effect("the Effect tool runs in LLM.loop with success validation and toModelOutput", () =>
    Effect.gen(function* () {
      const add = tool({ ...sum, execute: ({ a, b }) => Effect.succeed((a < 0 ? "negative" : a + b) as number) })
      const client = yield* TestLLM.Test
      yield* client.push(...script)

      const events = yield* LLM.loop({ model, prompt: "Add.", tools: { add } }).pipe(Stream.runCollect)

      expect(Array.from(events).filter(LLMEvent.is.toolResult)).toEqual(expectedResults)
    }),
  )

  test("both clients declare the same tool without execute", () => {
    const unvalidated = { description: "Echo.", parameters: Schema.Struct({ text: Schema.String }) }
    const dynamic = { description: "Look up.", jsonSchema: { type: "object" }, outputSchema: { type: "string" } }
    const effect = toDefinitions({ sum: tool(sum), echo: tool(unvalidated), dynamic: tool(dynamic) })
    const promise = toDefinitions({ sum: AI.tool(sum), echo: AI.tool(unvalidated), dynamic: AI.tool(dynamic) })

    expect(promise).toEqual(effect)
    expect(effect.map((definition) => definition.outputSchema)).toEqual([
      expect.anything(),
      undefined,
      { type: "string" },
    ])
  })
})

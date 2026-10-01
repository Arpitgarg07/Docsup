# AI architecture

AI is an optional enhancement layer. Core upload, storage, viewing, metadata search, family management, and authorization do not require a provider.

`apps/web/lib/ai.ts` exposes `AIProvider` and routes tasks to Gemini or Groq using server-only keys. The router has a configurable preferred provider and a fallback. Provider prompts include immutable safety instructions and treat output as untrusted. No provider key is sent to browsers or mobile clients.

Before enabling document image processing in production, send only the minimum temporary input required, use a provider configuration with appropriate no-training/privacy controls, delete temporary payloads, record provider/model/task/latency/token usage rather than document contents, and publish the exact retention behavior in the privacy policy.

### New

- Plugins can give Textus AI tools of its own to use - a word count, a look-up in your reference manager, a conversion - once you allow it, as the plugin's permissions say. The tools are offered from the plugin's manifest, so the plugin starts only when Textus AI first calls one, and each call shows in the conversation, one at a time, as an MCP server's do. Plugins name them in `contributes.aiTools` and run them with `textus.ai.registerTool`.

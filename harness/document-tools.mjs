import { defineTool } from "@deepseek-ai/dsh-tools";
export const name = "textus-document-tools";
export const inject = ["tools"];
export function apply(ctx, config) {
  const output = {
    schema: { type: "string" },
    render: (_args, value) => [{ type: "text", text: value }],
  };
  ctx.tools.register(
    defineTool({
      name: "read_document",
      description: "Read the current Textus document snapshot.",
      parameters: {},
      output,
      async execute() {
        return process.env.TEXTUS_DOCUMENT ?? "";
      },
    }),
  );
  if (config.images && config.writable)
    ctx.tools.register(
      defineTool({
        name: "generate_image",
        description:
          "Start a background illustration job for explicit user review. Maximum two per authorized task. Write a polished visual prompt of 1–1500 characters, not a copied long passage. Use an exact unique paragraph anchor from the document or proposed draft (accept draft before inserting its images). Do not insert temporary URLs.",
        parameters: {
          prompt: { type: "string", required: true },
          anchor: { type: "string", required: true },
          alt: { type: "string", required: true },
          caption: { type: "string" },
          size: { type: "string" },
          quality: { type: "string" },
        },
        output,
        async execute(args) {
          if (
            typeof args.prompt !== "string" ||
            !args.prompt.trim() ||
            [...args.prompt].length > 1500
          )
            throw new Error(
              "Refine the image prompt to 1–1500 characters before requesting an image.",
            );
          const response = await fetch(process.env.TEXTUS_TOOL_URL, {
            method: "POST",
            headers: {
              authorization: "Bearer " + process.env.TEXTUS_TOOL_TOKEN,
              "content-type": "application/json",
            },
            body: JSON.stringify(args),
          });
          if (!response.ok) throw new Error("Image bridge failed");
          return (await response.json()).output;
        },
      }),
    );

  if (config.writable)
    ctx.tools.register(
      defineTool({
        name: "propose_edit",
        description:
          "Propose a Markdown edit for user review. Does not change the document. For replace/delete use a verbatim unique anchor.",
        parameters: {
          action: {
            type: "string",
            required: true,
            enum: [
              "append",
              "replace",
              "insert_before",
              "insert_after",
              "delete",
            ],
          },
          anchor: { type: "string" },
          text: { type: "string" },
          reason: { type: "string" },
        },
        output,
        async execute(args) {
          if (
            ![
              "append",
              "replace",
              "insert_before",
              "insert_after",
              "delete",
            ].includes(args.action)
          )
            throw new Error("Invalid action");
          if (
            args.action !== "append" &&
            (!args.anchor ||
              !(process.env.TEXTUS_DOCUMENT ?? "").includes(args.anchor))
          )
            throw new Error("Anchor not found");
          return "Edit proposed for user review; not applied to the document.";
        },
      }),
    );
}

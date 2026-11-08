import { expect, it } from "vitest";
import { checkWrittenPlugin } from "./check-written-plugin";

const manifest = (more: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: "local.count",
    name: "Count",
    version: "0.1.0",
    publisher: "local",
    description: "Counts.",
    engines: { textus: ">=1.3.10" },
    main: "host.js",
    permissions: [],
    contributes: { commands: [{ command: "local.count.run", title: "Count" }] },
    ...more,
  });
const host = `exports.activate = () => textus.commands.register("local.count.run", () => {});`;

it("passes a plugin that installs and asks for what it uses", () => {
  expect(
    checkWrittenPlugin(
      [
        { path: "textus-plugin.json", text: manifest() },
        { path: "host.js", text: host },
      ],
      "1.3.10",
    ),
  ).toMatch(/^No problems found.*Textus 1\.3\.10/);
});

it("names what install refuses or what would silently do nothing", () => {
  const out = checkWrittenPlugin(
    [
      {
        path: "textus-plugin.json",
        text: manifest({
          id: "jane.count",
          engines: { textus: ">=2.0.0" },
          contributes: {
            commands: [{ command: "jane.count.run", title: "Count" }],
          },
        }),
      },
      {
        path: "host.js",
        text: `${host.replace("local.", "jane.")} textus.editor.getText();`,
      },
    ],
    "1.3.10",
  );
  expect(out).toContain('must start with "local."');
  expect(out).toContain(
    'engines.textus ">=2.0.0" leaves out this Textus (1.3.10)',
  );
  expect(out).toContain('"editor.read"');
  expect(
    checkWrittenPlugin([{ path: "host.js", text: host }], "1.3.10"),
  ).toMatch(/No textus-plugin\.json/);
});

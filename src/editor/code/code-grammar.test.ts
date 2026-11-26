import { describe, expect, it } from "vitest";
import {
  LINE_LIMIT,
  compileGrammar,
  tokenizeBlock,
  tokenizeLine,
} from "./code-grammar";
import { unsafePattern } from "./pattern-safety";

/** catvinci.cisco-ios's cisco.json, its rules' patterns verbatim. */
const CISCO = [
  "^\\s*!.*",
  "\\b(?:description|remark)\\s.*",
  '"[^"]*"',
  "\\b(?:GigabitEthernet|FastEthernet|TenGigabitEthernet|TwentyFiveGigE|FortyGigabitEthernet|HundredGigE|Ethernet|Serial|Loopback|Tunnel|Vlan|Port-channel|Dialer|Virtual-Template|BVI|Null|Management|mgmt|Gi|Fa|Te|Twe|Fo|Hu|Eth|Et|Se|Lo|Tu|Po|Vl)\\d+(?:/\\d+){0,3}(?:\\.\\d+)?(?::\\d+)?\\b",
  "\\b\\d{1,3}(?:\\.\\d{1,3}){3}(?:/\\d{1,2})?\\b",
  "\\b[0-9a-f]{4}\\.[0-9a-f]{4}\\.[0-9a-f]{4}\\b",
  "\\b[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){2,7}(?:/\\d{1,3})?",
  "\\b(?:access-list|access-group|access-class|remote-as|router-id|passive-interface|default-gateway|default-router|default-information|excluded-address|domain-name|name-server|helper-address|snmp-server|tacacs-server|radius-server|spanning-tree|channel-group|port-security|storm-control|class-map|policy-map|service-policy|route-map|prefix-list|mac-address|exec-timeout|new-model|running-config|startup-config|config-register|ip-address|key-string)\\b",
  "\\b(?:interface|ip|ipv6|address|router|ospf|ospfv3|eigrp|bgp|rip|isis|network|area|neighbor|redistribute|summary-address|permit|deny|any|host|eq|neq|gt|lt|range|established|log|shutdown|no|hostname|vlan|name|switchport|mode|access|trunk|allowed|native|encapsulation|dot1q|enable|secret|password|service|line|con|vty|aux|login|local|transport|input|output|username|privilege|portfast|bpduguard|standby|vrrp|preempt|priority|track|nat|inside|outside|overload|pool|route|dhcp|ntp|server|logging|community|crypto|key|generate|rsa|isakmp|ipsec|policy|match|set|version|exit|end|write|memory|copy|duplex|speed|auto|full|half|mtu|bandwidth|clock|rate|banner|motd|aaa|authentication|authorization|accounting|extended|standard|cdp|lldp|run|tunnel|source|destination|keepalive|maximum|violation|sticky|arp|boot|system|vrf|forwarding|unicast-routing|routing|negotiation|description|remark)\\b",
  "\\b(?:tcp|udp|icmp|esp|gre|ahp|pim|www|http|https|ftp|ftp-data|telnet|ssh|domain|bootps|bootpc|tftp|snmp|smtp|pop3|echo|echo-reply|unreachable)\\b",
  "\\b\\d+\\b",
];

const grammar = (rules: unknown[], extra = {}) =>
  compileGrammar({ rules, ...extra }).grammar;

const shown = (g: ReturnType<typeof grammar>, line: string) =>
  tokenizeLine(g, line).map((t) => [line.slice(t.from, t.to), t.type]);

describe("a plugin's code grammar", () => {
  it("takes at each place the first rule matching there", () => {
    const g = grammar([
      { token: "string", match: '"[^"]*"' },
      { token: "comment", match: "!.*" },
      { token: "keyword", match: "\\b(?:permit|deny)\\b" },
    ]);
    // The ! inside the string is the string's; the one after is a comment.
    expect(shown(g, 'permit "a!b" ! note')).toEqual([
      ["permit", "keyword"],
      ['"a!b"', "string"],
      ["! note", "comment"],
    ]);
  });

  it("keeps ^ for the line's start and \\b for a word's edge", () => {
    const g = grammar([
      { token: "comment", match: "^\\s*!.*" },
      { token: "keyword", match: "\\bip\\b" },
    ]);
    expect(shown(g, "  ! a")).toEqual([["  ! a", "comment"]]);
    expect(shown(g, "x ! a")).toEqual([]);
    expect(shown(g, "ship ip")).toEqual([["ip", "keyword"]]);
  });

  it("reads case as the file's flags say, a rule's own flags first", () => {
    const g = grammar(
      [
        { token: "keyword", match: "interface" },
        { token: "number", match: "x", flags: "" },
      ],
      { flags: "i" },
    );
    expect(shown(g, "INTERFACE X x")).toEqual([
      ["INTERFACE", "keyword"],
      ["x", "number"],
    ]);
  });

  it("moves past a rule that matches nothing", () => {
    const g = grammar([
      { token: "keyword", match: "a*" },
      { token: "number", match: "\\d+" },
    ]);
    expect(shown(g, "b12a")).toEqual([
      ["12", "number"],
      ["a", "keyword"],
    ]);
  });

  it("leaves out a rule it can't use and says why, keeping the others", () => {
    const { grammar: g, problems } = compileGrammar({
      rules: [
        { token: "keyword", match: "(a+)+$" },
        { token: "weird", match: "x" },
        { token: "string", match: "(" },
        { token: "number", match: "\\d+" },
      ],
    });
    expect(g.rules).toHaveLength(1);
    expect(problems).toHaveLength(3);
    expect(compileGrammar({}).problems).toEqual(["rules isn't a list"]);
  });

  it("refuses patterns that can backtrack without end", () => {
    for (const bad of [
      "(a+)+$",
      "(?:a|ab)*c",
      "(x(?:y*))+",
      "(\\d{1,3}\\.)+",
      "(?:a?a?)+$",
      "(a)\\1",
      "(?<=a)b",
      // Bounded, but each time over shares the run out again.
      "(a+){1,60}",
      "(\\w+\\s?){2,40}$",
      "(\\d{1,3}){1,10}$",
      // Three repeats taking the same characters in turn.
      "\\s*\\s*\\s*$",
      "\\w+\\s?\\w+\\s?\\w+$",
      ".*a.*a.*$",
      "\\s*x?\\s*y?\\s*$",
      // Choices that can match the same text.
      "(?:a|a)*$",
      "(?:\\w|\\d)+",
      "(?:a|ab)(?:a|ab)(?:a|ab)$",
      "(?:a|a){1,30}$",
      "a?".repeat(17),
      // Characters the probes don't hold still overlap.
      "ü*ü*ü*$",
      "[а-я]+[а-я]+[а-я]+$",
      // A lookahead is tried again as what comes before gives way.
      "a*(?=a*a*!)",
      "(?:(?=a*a*$)a)*",
    ])
      expect(unsafePattern(bad), bad).not.toBeNull();
    for (const good of [
      "\\b(?:interface|vlan)\\b",
      "(?:\\d{1,3}\\.){3}\\d{1,3}",
      "[(+*)]+",
      "(?:ab)+",
      "\\(a+\\)+",
      "(?:a+?b)",
      "(?::\\d+)?",
      // The usual string with escapes: each time over, one way only.
      '"(?:\\\\.|[^"\\\\])*"',
      "(?:a|b)*c",
      "\\w+\\s?\\w+$",
      "^\\s*interface\\s+\\S+\\s+\\d+",
      "\\w+(?=\\s*\\()",
    ])
      expect(unsafePattern(good), good).toBeNull();
    // The official Cisco grammar, as it is published.
    for (const good of CISCO) expect(unsafePattern(good, "i"), good).toBeNull();
  });

  it("leaves a line past the limit plain, and gives up on a slow line or block", () => {
    const g = grammar([{ token: "keyword", match: "a" }]);
    expect(tokenizeLine(g, "a".repeat(LINE_LIMIT + 1))).toEqual([]);
    expect(tokenizeBlock(g, "a\na")).toEqual([
      { from: 0, to: 1, type: "keyword" },
      { from: 2, to: 3, type: "keyword" },
    ]);
    // Each line's reading timed: one slow line is enough.
    let clock = 0;
    expect(tokenizeBlock(g, "a\na", () => (clock += 30))).toBeNull();
    // Quick lines, but too many of them.
    clock = 0;
    const lines = Array(60).fill("a").join("\n");
    expect(tokenizeBlock(g, lines, () => (clock += 10))).toBeNull();
    clock = 0;
    expect(tokenizeBlock(g, "a\na", () => (clock += 10))).toHaveLength(2);
  });
});

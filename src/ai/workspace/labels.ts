export function workspaceLabels(language: string) {
  return language === "zh" || language === "zh-Hant"
    ? {
        title: "Agent 创作工作台",
        open: "与 AI 一起创作",
        editor: "进入编辑器",
        task: "当前任务",
        preview: "草稿预览 · 待采纳",
        empty:
          "描述你想创作的文档，Agent 会将内容写入右侧草稿。采纳后即可在编辑器中精修。",
        ready: "等待审阅",
        running: "正在创作",
        idle: "准备就绪",
        accept: "全部采纳",
        reject: "全部拒绝",
        take: "采纳",
        skip: "跳过",
        conflict:
          "文档已更改或提案位置存在冲突。草稿已保留，请拒绝旧提案后基于最新正文重新生成。",
        changes: "章节与变更",
        current: "当前文档",
        stop: "停止",
        newTask: "新建任务",
        resolve: "请先采纳或拒绝待处理草稿。",
        saved: "正文与编辑器共享；未采纳草稿不会保存为正文。",
      }
    : {
        title: "Agent Workspace",
        open: "Create with AI",
        editor: "Open editor",
        task: "Current task",
        preview: "Draft preview · Not accepted",
        empty:
          "Describe the document you want to create. Review the draft here, then accept it to refine it in the editor.",
        ready: "Ready for review",
        running: "Creating",
        idle: "Ready",
        accept: "Accept all",
        reject: "Reject all",
        take: "Accept",
        skip: "Skip",
        conflict:
          "The document changed or proposal targets conflict. Your draft is preserved. Reject old proposals and regenerate against the current document.",
        changes: "Sections and changes",
        current: "Current document",
        stop: "Stop",
        newTask: "New task",
        resolve: "Accept or reject the pending draft first.",
        saved:
          "Shares the editor document. Unaccepted drafts are not saved as document content.",
      };
}

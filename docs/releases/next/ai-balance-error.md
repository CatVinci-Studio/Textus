### Fixed

- When an AI service's balance or quota runs out (DeepSeek's "Insufficient Balance", OpenAI's "exceeded your current quota", Anthropic's "credit balance is too low" and the like), Textus now says so in your language and tells you where to top up or switch services, instead of only showing the raw message or calling it a rate limit. Errors from AI completion and grammar checks get the same explanation as the chat.

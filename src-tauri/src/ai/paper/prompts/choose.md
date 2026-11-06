The step that reads a writing request and decides which genre it calls for
and how long it is, before any research (choose.rs). It replies with JSON.

## instructions

You decide what kind of piece a writing request calls for, before it is researched and written. The kinds:
{{genres}}

Choose by what the user asked for and who will read it; when the request names a kind or a length, follow it. A thread is only for a request that asks for social-network posts; news, a press release or a briefing is a brief, or a report when it asks for depth. A review of the literature is a review, not a paper; a report for decision-makers, with data and recommendations, is an analysis, and a long read for the public a report. {{length}} Reply with a JSON object {"genre": …, "chars": …} and nothing else.

## genre

- "{{name}}": {{when}}; {{least}}-{{most}} characters

## length.asked

The user picked about {{asked}} characters: keep that if it suits the kind, else choose a length within the kind's.

## length.open

Choose a length within the kind's that the topic needs.

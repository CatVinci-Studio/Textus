The research stage (research.rs): the step that splits the topic into
questions, and the helpers that research one question each. The genre's
`research_angles` and `research_sources` come from its profile in genre.rs.

## plan

You plan the research for a {{genre}} of about {{chars}} characters, written in the language tagged "{{language}}". Split its topic into {{least}}-{{most}} research questions that together cover it in breadth and depth: {{angles}} - as fits the topic. Each question is one sentence, specific enough to search for, and none repeats another. Reply with a JSON array of the questions as strings and nothing else.

## helper

You are one of several researchers gathering material for a {{genre}} on "{{topic}}", written in the language tagged "{{language}}". Your part is one question. {{sources}} Aim for four to eight notes, written in the {{genre}}'s language. Note pictures and data sets a figure could use as leads. When the question is covered, or the searches run out, reply with one short line.{{material}}

## material.attached

The user attached files of their own for this piece - {{files}}: read what bears on your question with read_file before searching, and cite a file by its path in add_note's sources - it is the material the user chose.

## material.library

The user has a reference library of their own papers, books and notes: search it first with search_references, read around a passage with read_file, and cite a file from it by its path (references/...) in add_note's sources - it is the material the user chose.

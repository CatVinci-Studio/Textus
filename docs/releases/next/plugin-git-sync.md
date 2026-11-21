### New

- For plugin authors: `textus.git.fetch()`, `push()` and `pull()` reach the folder's remote with the user's own Git and saved credentials, under a new `git.sync` permission asked for apart from committing; `git.status()` also gives the remote branch and how many commits are ahead and behind. A pull that would leave conflicts is undone and says so, so no document is left with conflict markers. (#763)

### Improved

- Picks a custom endpoint's model from the list the endpoint serves, in Settings and in the chat's model menu, instead of typing its name. (#702)

### Fixed

- Fails the custom endpoint's connection test when the endpoint doesn't serve the chosen model, instead of passing and then failing in the chat. (#700, #701)

export const enum InteractionType {
  Ping = 1,
  ApplicationCommand = 2,
  MessageComponent = 3,
  ApplicationCommandAutocomplete = 4,
  ModalSubmit = 5,
}

export const enum InteractionResponseType {
  Pong = 1,
  ChannelMessageWithSource = 4,
  DeferredChannelMessageWithSource = 5,
  DeferredUpdateMessage = 6,
  /**
   * Sync twin of `DeferredUpdateMessage` — updates the component's message
   * atomically with the interaction response (no defer). Unused: all current
   * component handlers do async work and prefer the deferred variant.
   * @lintignore
   */
  UpdateMessage = 7,
  ApplicationCommandAutocompleteResult = 8,
  /**
   * Returned to show a modal form in response to a command or component.
   * Unused: no commands currently collect multi-field input via modals.
   * @lintignore
   */
  Modal = 9,
}

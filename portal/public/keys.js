/* Cmd+Enter on macOS, Ctrl+Enter elsewhere. Both modifiers are accepted on
   every platform: neither combination is bound to anything else in the portal,
   so there is nothing to gain from sniffing the platform here.

   The exclusions matter. Alt and Shift keep neighbouring chords such as
   Cmd+Shift+Enter from submitting; repeat stops a held chord firing a burst of
   submissions; isComposing stops the shortcut hijacking the Enter that
   confirms an IME candidate. */
export function isSubmitChord(e) {
  return e.key === 'Enter' && (e.metaKey || e.ctrlKey)
    && !e.altKey && !e.shiftKey && !e.repeat && !e.isComposing;
}

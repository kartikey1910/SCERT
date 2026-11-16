/**
 * Style for a file/camera <input> that is triggered only via a visible
 * button's ref.click() - never shown directly.
 *
 * Not `display: none`: iOS Safari sometimes silently ignores a scripted
 * .click() on a display:none file input (most often the camera-capture
 * one), so the first tap does nothing and the user has to tap again or
 * reload before it responds. Taking the element off-screen with `position:
 * fixed` instead keeps it real enough for WebKit to honor the click while
 * staying invisible and out of the page's layout.
 */
export const HIDDEN_FILE_INPUT_STYLE = {
  position: 'fixed',
  top: '-1000px',
  left: '-1000px',
  width: '1px',
  height: '1px',
  opacity: 0,
  overflow: 'hidden',
  pointerEvents: 'none',
};

// The pieces the screens of the mod are drawn with, in the colors of Herdr's theme: buttons,
// chips, rows, a field with options under it, cards and lines. They hold no state: main.js
// passes what they show and what a press does.
import { div } from 'gpui-kit'
import { h_flex, Input, v_flex } from 'gpui-base'
import { home } from 'herdr'
import { refusalLine } from './refusals.js'

/** @import { ClickEvent, Color, Context, Element } from 'gpui-kit' */
/** @import { InputState } from 'gpui-base' */
/** @import { Refusal } from './refusals.js' */

/**
 * The colors of Herdr's theme by name: `theme()` answers each as a `#rrggbb` string.
 * @typedef {Record<string, Color>} Theme
 */

/**
 * What a press of a piece does.
 * @typedef {(event: ClickEvent, cx: Context) => void} ClickHandler
 */

/**
 * The pieces the screens are drawn with.
 * @typedef {ReturnType<typeof parts>} Parts
 */

/**
 * The pieces the screens are drawn with, in the colors of the theme.
 * @param {Theme} t
 */
export function parts(t) {
  const userHome = home()
  /**
   * @param {string} id
   * @param {string} label
   * @param {{primary?: boolean, quiet?: boolean, disabled?: boolean, onClick?: ClickHandler}} [options]
   */
  const button = (id, label, { primary = false, quiet = false, disabled = false, onClick } = {}) =>
    h_flex()
      .id(id)
      .flex_none()
      .h(26)
      .px(10)
      .items_center()
      .justify_center()
      .rounded(6)
      .border_1()
      .border_color(primary ? t.solid : quiet ? t.surface : t.input)
      .bg(primary ? t.solid : quiet ? t.surface : t.raised)
      .text_size(12)
      .text_color(primary ? t.solid_foreground : t.foreground)
      .when(disabled, (el) => el.opacity(0.45))
      .when(!disabled && typeof onClick === 'function', (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click(onClick))
      .child(label)
  /**
   * @param {string} id
   * @param {string} label
   * @param {{selected?: boolean, disabled?: boolean, onClick?: ClickHandler}} [options]
   */
  const chip = (id, label, { selected = false, disabled = false, onClick } = {}) =>
    h_flex()
      .id(id)
      .flex_none()
      .h(24)
      .px(8)
      .items_center()
      .rounded(6)
      .border_1()
      .border_color(selected ? t.accent : t.border)
      .bg(selected ? t.selected : t.surface)
      .text_size(12)
      .text_color(disabled ? t.dim : selected ? t.foreground : t.muted)
      .when(!disabled && typeof onClick === 'function', (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(onClick))
      .child(label)
  /**
   * @param {string} id
   * @param {{title: string, line?: string | null, lineColor?: Color, current?: boolean, muted?: boolean, lead?: Element | null, action?: Element | null, onClick?: ClickHandler}} options
   */
  const row = (id, { title, line, lineColor, current = false, muted = false, lead = null, action = null, onClick }) =>
    h_flex()
      .id(id)
      .gap(8)
      .px(8)
      .py(5)
      .items_center()
      .rounded(6)
      .when(current, (el) => el.bg(t.selected))
      .when(typeof onClick === 'function', (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(onClick))
      .when(lead !== null, (el) => el.child(lead))
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .child(div().truncate().text_color(muted ? t.dim : t.foreground).child(title))
          .when(Boolean(line), (el) => el.child(div().truncate().text_size(11).text_color(lineColor ?? t.dim).child(line)))
      )
      .when(action !== null, (el) => el.child(action))
  /**
   * A field whose options open under it, its title above it and a note under it.
   * @param {string} id
   * @param {{label: string, value: string, options: string[], enabled: boolean, open: boolean, note?: string | null, onToggle: ClickHandler, onPick: (option: string, cx: Context) => void}} options
   */
  const select = (id, { label, value, options, enabled, open, note = null, onToggle, onPick }) =>
    v_flex()
      .gap(2)
      .child(div().text_size(11).text_color(t.dim).child(label))
      .child(
        h_flex()
          .id(id)
          .h(26)
          .px(8)
          .items_center()
          .rounded(6)
          .border_1()
          .border_color(open ? t.accent : t.input)
          .bg(t.background)
          .text_color(enabled ? t.foreground : t.muted)
          .when(enabled, (el) => el.cursor_pointer().on_click(onToggle))
          .child(div().flex_1().min_w(0).truncate().child(value))
          .when(enabled, (el) => el.child(div().text_color(t.dim).child(open ? '▴' : '▾')))
      )
      .when(note !== null, (el) => el.child(div().text_size(11).text_color(t.blocked).child(note)))
      .when(open, (el) =>
        el.child(
          v_flex()
            .p(4)
            .rounded(6)
            .border_1()
            .border_color(t.border)
            .bg(t.popover)
            .children(
              options.map((option) =>
                h_flex()
                  .id(`${id}-${option}`)
                  .px(6)
                  .py(3)
                  .rounded(4)
                  .cursor_pointer()
                  .when(option === value, (row) => row.bg(t.selected))
                  .hover((s) => s.bg(t.hover))
                  .on_click((_event, cx) => onPick(option, cx))
                  .child(div().truncate().child(option))
              )
            )
        )
      )
  /**
   * A small round mark: filled with `color`, or a ring of it when `hollow`.
   * @param {Color} color
   * @param {{hollow?: boolean}} [options]
   */
  const dot = (color, { hollow = false } = {}) =>
    div()
      .flex_none()
      .w(8)
      .h(8)
      .rounded(4)
      .when(hollow, (el) => el.border_1().border_color(color))
      .when(!hollow, (el) => el.bg(color))
  /** Numbered steps. */
  const steps = (/** @type {string[]} */ list) =>
    v_flex()
      .gap(4)
      .children(
        list.map((step, index) =>
          h_flex()
            .gap(8)
            .items_start()
            .child(div().flex_none().w(18).text_color(t.accent).child(`${index + 1}.`))
            .child(div().flex_1().min_w(0).child(step))
        )
      )
  return {
    t,
    button,
    chip,
    row,
    dot,
    select,
    steps,
    rule: () => div().h(1).flex_none().bg(t.border),
    title: (/** @type {string} */ text) => div().font_semibold().child(text),
    label: (/** @type {string} */ text) => div().text_size(11).font_semibold().text_color(t.muted).child(text),
    text: (/** @type {string} */ text) => div().child(text),
    dim: (/** @type {string} */ text) => div().text_size(12).text_color(t.dim).child(text),
    badge: (/** @type {string} */ text) => div().px(6).py(1).rounded(4).bg(t.raised).text_size(11).text_color(t.muted).child(text),
    card: (/** @type {Element[]} */ children) => v_flex().gap(8).p(10).rounded(8).border_1().border_color(t.border).bg(t.background).children(children),
    notice: (/** @type {string} */ text) => div().p(8).rounded(6).border_1().border_color(t.accent).child(text),
    refusal: (/** @type {Refusal} */ error) => div().p(8).rounded(6).border_1().border_color(t.blocked).text_color(t.blocked).child(refusalLine(error)),
    input: (/** @type {InputState} */ state) =>
      Input.new(state).h(28).px(8).items_center().rounded(6).border_1().border_color(t.input).bg(t.background).text_color(t.foreground),
    tilde: (/** @type {string} */ path) => (userHome && path.startsWith(userHome) ? `~${path.slice(userHome.length)}` : path)
  }
}
